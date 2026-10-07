"""SRV-05: private match by invite link, through ``TestClient`` (HTTP and the match WebSocket)."""

import io
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from gow_protocol.codec import decode_server, encode
from gow_protocol.messages import PROTOCOL_VERSION, HelloMsg, WelcomeMsg
from gow_server.app import create_app
from gow_server.clock import ManualClock
from gow_server.matches import MatchManager
from gow_server.settings import Settings

Json = dict[str, object]


@pytest.fixture
def clock() -> ManualClock:
    return ManualClock()


@pytest.fixture
def api(settings: Settings, clock: ManualClock) -> Iterator[TestClient]:
    with TestClient(create_app(settings, clock)) as test_client:
        yield test_client


def guest(api: TestClient, nick: str) -> dict[str, str]:
    token = api.post("/api/guest", json={"nick": nick}).json()["token"]
    return {"Authorization": f"Bearer {token}"}


def matches_of(api: TestClient) -> MatchManager:
    manager = api.app.state.matches  # type: ignore[attr-defined]
    assert isinstance(manager, MatchManager)
    return manager


def token_of(headers: dict[str, str]) -> str:
    return headers["Authorization"].removeprefix("Bearer ")


def create(api: TestClient, headers: dict[str, str], **body: str) -> Json:
    response = api.post("/api/matches", json=body, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def post(api: TestClient, headers: dict[str, str], code: str, action: str) -> Json:
    response = api.post(f"/api/matches/{code}/{action}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_create_join_ready_starts_the_match(api: TestClient) -> None:
    alice, bob = guest(api, "alice"), guest(api, "bob")
    invite = create(api, alice)
    code = str(invite["code"])
    assert invite["state"] == "open"
    assert invite["map_id"] in {"line3", "diamond"}
    assert invite["expires_in_s"] == 1800
    assert matches_of(api).active == 0

    joined = post(api, bob, code, "join")
    assert joined["state"] == "joined"
    assert (joined["host_nick"], joined["guest_nick"]) == ("alice", "bob")

    first = post(api, alice, code, "ready")
    assert first["state"] == "joined"
    assert (first["you_ready"], first["opponent_ready"], first["match_id"]) == (True, False, None)
    status_bob = api.get(f"/api/matches/{code}", headers=bob).json()
    assert (status_bob["you_ready"], status_bob["opponent_ready"]) == (False, True)

    started = post(api, bob, code, "ready")
    match_id = started["match_id"]
    assert started["state"] == "started"
    assert isinstance(match_id, str)
    manager = matches_of(api)
    runner = manager.get(match_id)
    assert runner is not None
    assert runner.map_id == invite["map_id"]
    assert sorted(runner.players) == sorted([1, 2])

    # The player who was ready first learns the match_id by polling.
    assert api.get(f"/api/matches/{code}", headers=alice).json()["match_id"] == match_id
    # A repeated ready does not start a second match.
    assert post(api, bob, code, "ready")["match_id"] == match_id
    assert manager.active == 1

    for headers in (alice, bob):  # both can connect to the started match
        with api.websocket_connect(
            f"/ws/match/{match_id}", headers={"Origin": "http://testserver"}
        ) as ws:
            hello = HelloMsg(protocol_version=PROTOCOL_VERSION, token=token_of(headers))
            ws.send_text(encode(hello))
            assert isinstance(decode_server(ws.receive_text()), WelcomeMsg)


def test_third_player_is_refused(api: TestClient) -> None:
    alice, bob, carol = guest(api, "alice"), guest(api, "bob"), guest(api, "carol")
    code = str(create(api, alice)["code"])
    post(api, bob, code, "join")
    response = api.post(f"/api/matches/{code}/join", headers=carol)
    assert response.status_code == 409
    assert api.get(f"/api/matches/{code}", headers=carol).status_code == 404
    assert api.post(f"/api/matches/{code}/ready", headers=carol).status_code == 404
    assert post(api, bob, code, "join")["state"] == "joined"  # the guest may re-join


def test_third_player_is_refused_after_start(api: TestClient) -> None:
    alice, bob, carol = guest(api, "alice"), guest(api, "bob"), guest(api, "carol")
    code = str(create(api, alice)["code"])
    post(api, bob, code, "join")
    post(api, alice, code, "ready")
    post(api, bob, code, "ready")
    assert api.post(f"/api/matches/{code}/join", headers=carol).status_code == 409


def test_host_cannot_join_own_invite_or_ready_alone(api: TestClient) -> None:
    alice = guest(api, "alice")
    code = str(create(api, alice)["code"])
    assert api.post(f"/api/matches/{code}/join", headers=alice).status_code == 409
    assert api.post(f"/api/matches/{code}/ready", headers=alice).status_code == 409


def test_unknown_code_is_404(api: TestClient) -> None:
    alice = guest(api, "alice")
    assert api.post("/api/matches/nope/join", headers=alice).status_code == 404
    assert api.get("/api/matches/nope", headers=alice).status_code == 404


def test_endpoints_need_a_token(api: TestClient) -> None:
    assert api.post("/api/matches", json={}).status_code in (401, 403)
    assert api.post("/api/matches/x/join").status_code in (401, 403)


def test_invite_expires_after_30_minutes(api: TestClient, clock: ManualClock) -> None:
    alice, bob = guest(api, "alice"), guest(api, "bob")
    code = str(create(api, alice)["code"])
    clock.advance(1799)
    assert api.get(f"/api/matches/{code}", headers=alice).json()["expires_in_s"] == pytest.approx(1)
    clock.advance(1)
    assert api.post(f"/api/matches/{code}/join", headers=bob).status_code == 404
    assert api.get(f"/api/matches/{code}", headers=alice).status_code == 404


def test_new_invite_replaces_the_old_one(api: TestClient) -> None:
    alice, bob = guest(api, "alice"), guest(api, "bob")
    old = str(create(api, alice)["code"])
    new = str(create(api, alice)["code"])
    assert old != new
    assert api.post(f"/api/matches/{old}/join", headers=bob).status_code == 404
    assert post(api, bob, new, "join")["state"] == "joined"


def test_choose_map_and_unknown_map(api: TestClient) -> None:
    alice = guest(api, "alice")
    assert create(api, alice, map_id="diamond")["map_id"] == "diamond"
    response = api.post("/api/matches", json={"map_id": "nope"}, headers=alice)
    assert response.status_code == 422
    assert api.post("/api/matches", json={"x": 1}, headers=alice).status_code == 422


def test_codes_are_unique_and_long(api: TestClient) -> None:
    codes = {str(create(api, guest(api, f"player{i}"))["code"]) for i in range(8)}
    assert len(codes) == 8
    assert all(len(code) >= 21 for code in codes)  # 16 random bytes in base64url


def test_draining_server_refuses_to_start(api: TestClient) -> None:
    alice, bob = guest(api, "alice"), guest(api, "bob")
    code = str(create(api, alice)["code"])
    post(api, bob, code, "join")
    post(api, alice, code, "ready")
    matches_of(api).drain()
    assert api.post(f"/api/matches/{code}/ready", headers=bob).status_code == 503
    matches_of(api).undrain()
    assert post(api, bob, code, "ready")["state"] == "started"


def test_invite_code_is_never_logged(api: TestClient, json_logs: io.StringIO) -> None:
    alice, bob = guest(api, "alice"), guest(api, "bob")
    code = str(create(api, alice)["code"])
    post(api, bob, code, "join")
    post(api, alice, code, "ready")
    post(api, bob, code, "ready")
    logs = json_logs.getvalue()
    assert "/api/matches/{code}/join" in logs
    assert code not in logs


def test_default_ttl_setting(maps_dir: Path, tmp_path: Path) -> None:
    assert Settings(maps_dir=maps_dir).invite_ttl_s == 1800


def test_active_match_endpoint_returns_the_running_match(api: TestClient) -> None:
    """#189: after a page reload the client asks where the player's match is."""
    alice, bob, carol = guest(api, "alice"), guest(api, "bob"), guest(api, "carol")
    assert api.get("/api/me/active-match", headers=alice).json() is None
    assert api.get("/api/me/active-match").status_code == 401

    invite = create(api, alice)
    code = str(invite["code"])
    post(api, bob, code, "join")
    # Paired but not started: nothing to reconnect to yet.
    assert api.get("/api/me/active-match", headers=alice).json() is None

    post(api, alice, code, "ready")
    match_id = post(api, bob, code, "ready")["match_id"]
    expected = {"match_id": match_id, "map_id": invite["map_id"]}
    for headers in (alice, bob):
        response = api.get("/api/me/active-match", headers=headers)
        assert response.json() == expected
        assert response.headers["Cache-Control"] == "no-store"
    assert api.get("/api/me/active-match", headers=carol).json() is None  # not a player there

    runner = matches_of(api).get(str(match_id))
    assert runner is not None
    runner.technical_defeat(0)
    runner.step()
    assert runner.finished
    assert (
        api.get("/api/me/active-match", headers=alice).json() is None
    )  # over: nothing to return to
