"""LOB-01: public lobby (list, join from the list, abandoned entries, rate limit), via HTTP."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

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


def create(api: TestClient, headers: dict[str, str], **body: object) -> Json:
    response = api.post("/api/matches", json=body, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def lobby(api: TestClient, headers: dict[str, str]) -> list[Json]:
    response = api.get("/api/lobby", headers=headers)
    assert response.status_code == 200, response.text
    assert response.headers["Cache-Control"] == "no-store"
    return response.json()["matches"]


def post(api: TestClient, headers: dict[str, str], code: str, action: str) -> Json:
    response = api.post(f"/api/matches/{code}/{action}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def is_private(api: TestClient, match_id: str) -> bool:
    manager = api.app.state.matches  # type: ignore[attr-defined]
    assert isinstance(manager, MatchManager)
    runner = manager.get(match_id)
    assert runner is not None
    return bool(runner.private)


def test_public_match_is_listed_joined_and_started(api: TestClient) -> None:
    alice, bob = guest(api, "alice"), guest(api, "bob")
    assert lobby(api, bob) == []
    invite = create(api, alice, public=True, map_id="diamond")
    assert invite["public"] is True
    code = str(invite["code"])

    entries = lobby(api, bob)
    assert len(entries) == 1
    assert (entries[0]["host_nick"], entries[0]["map_id"], entries[0]["code"]) == (
        "alice",
        "diamond",
        code,
    )
    assert lobby(api, alice) == []  # your own entry is not offered to you

    assert post(api, bob, code, "join")["state"] == "joined"
    assert lobby(api, guest(api, "carol")) == []  # taken: out of the list

    post(api, alice, code, "ready")
    started = post(api, bob, code, "ready")
    assert is_private(api, str(started["match_id"])) is False  # no pauses against a stranger


def test_private_invites_are_not_listed_and_stay_private(api: TestClient) -> None:
    alice, bob = guest(api, "alice"), guest(api, "bob")
    invite = create(api, alice)
    assert invite["public"] is False
    assert lobby(api, bob) == []
    code = str(invite["code"])
    post(api, bob, code, "join")
    post(api, alice, code, "ready")
    started = post(api, bob, code, "ready")
    assert is_private(api, str(started["match_id"])) is True


def test_lobby_needs_a_token(api: TestClient) -> None:
    assert api.get("/api/lobby").status_code == 401


def test_list_is_oldest_first(api: TestClient, clock: ManualClock) -> None:
    alice, bob, carol = guest(api, "alice"), guest(api, "bob"), guest(api, "carol")
    create(api, alice, public=True)
    clock.advance(3)
    create(api, bob, public=True)
    entries = lobby(api, carol)
    assert [e["host_nick"] for e in entries] == ["alice", "bob"]
    assert entries[0]["age_s"] == pytest.approx(3)


def test_abandoned_entry_is_removed_but_a_present_host_keeps_it(
    api: TestClient, clock: ManualClock
) -> None:
    alice, bob = guest(api, "alice"), guest(api, "bob")
    code = str(create(api, alice, public=True)["code"])
    clock.advance(10)
    assert api.get(f"/api/matches/{code}", headers=alice).status_code == 200  # heartbeat
    clock.advance(10)
    assert len(lobby(api, bob)) == 1
    clock.advance(10)  # silent for 20 s >= 15 s
    assert lobby(api, bob) == []
    assert api.post(f"/api/matches/{code}/join", headers=bob).status_code == 404
    # The host is free again: no stale "one active match" claim.
    assert create(api, alice, public=True)["state"] == "open"


def test_guest_polling_is_not_a_host_heartbeat(api: TestClient, clock: ManualClock) -> None:
    alice, bob = guest(api, "alice"), guest(api, "bob")
    code = str(create(api, alice, public=True)["code"])
    post(api, bob, code, "join")
    clock.advance(10)
    assert api.get(f"/api/matches/{code}", headers=bob).status_code == 200
    clock.advance(10)
    assert api.get(f"/api/matches/{code}", headers=bob).status_code == 404  # host gone


def test_cancel_removes_the_entry(api: TestClient) -> None:
    alice, bob = guest(api, "alice"), guest(api, "bob")
    code = str(create(api, alice, public=True)["code"])
    assert api.delete(f"/api/matches/{code}", headers=bob).status_code == 404  # not a member
    assert len(lobby(api, bob)) == 1
    assert api.delete(f"/api/matches/{code}", headers=alice).status_code == 204
    assert lobby(api, bob) == []
    assert api.get(f"/api/matches/{code}", headers=alice).status_code == 404
    assert api.delete(f"/api/matches/{code}", headers=alice).status_code == 404


def test_cancel_does_not_touch_a_started_match(api: TestClient) -> None:
    alice, bob = guest(api, "alice"), guest(api, "bob")
    code = str(create(api, alice, public=True)["code"])
    post(api, bob, code, "join")
    post(api, alice, code, "ready")
    match_id = post(api, bob, code, "ready")["match_id"]
    assert api.delete(f"/api/matches/{code}", headers=alice).status_code == 204
    assert api.get(f"/api/matches/{code}", headers=alice).json()["match_id"] == match_id


def test_busy_player_cannot_join_from_the_lobby(api: TestClient) -> None:
    alice, bob, carol = guest(api, "alice"), guest(api, "bob"), guest(api, "carol")
    first = str(create(api, alice, public=True)["code"])
    second = str(create(api, bob, public=True)["code"])
    post(api, carol, first, "join")
    response = api.post(f"/api/matches/{second}/join", headers=carol)
    assert response.status_code == 409


def test_creating_matches_is_rate_limited_per_account(
    maps_dir: Path, tmp_path: Path, clock: ManualClock
) -> None:
    settings = Settings(
        maps_dir=maps_dir,
        database_url=f"sqlite:///{tmp_path / 'gow.db'}",
        rulesets_dir=tmp_path / "rulesets",
        invite_rate_limit=3,
        invite_rate_window_s=60,
    )
    with TestClient(create_app(settings, clock)) as api:
        alice, bob = guest(api, "alice"), guest(api, "bob")
        for _ in range(3):
            create(api, alice, public=True)
        blocked = api.post("/api/matches", json={"public": True}, headers=alice)
        assert blocked.status_code == 429
        assert blocked.headers["Retry-After"] == "60"
        create(api, bob, public=True)  # the limit is per account
        clock.advance(60)
        create(api, alice, public=True)
