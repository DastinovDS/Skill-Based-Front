# ruff: noqa: RUF001  (look-alike letters are the subject of these tests)
"""MOD-01: nick policy over HTTP, nick change, per-player limits, blocking, ``gow-admin``."""

import sqlite3
from collections.abc import Iterator
from pathlib import Path
from typing import cast

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from httpx2 import Response
from sqlalchemy.orm import Session, sessionmaker

from gow_server import admin
from gow_server.abuse import Limits
from gow_server.app import create_app
from gow_server.clock import ManualClock
from gow_server.settings import Settings
from gow_server.ws import account_of

Headers = dict[str, str]
ALEMBIC_INI = Path(__file__).parents[1] / "alembic.ini"


def guest(client: TestClient, nick: str) -> tuple[Headers, int]:
    response = client.post("/api/guest", json={"nick": nick})
    assert response.status_code == 201, response.text
    body = response.json()
    return {"Authorization": f"Bearer {body['token']}"}, body["player_id"]


@pytest.fixture
def clock() -> ManualClock:
    return ManualClock()


@pytest.fixture
def api(settings: Settings, clock: ManualClock) -> Iterator[TestClient]:
    with TestClient(create_app(settings, clock)) as test_client:
        yield test_client


# Nick policy ------------------------------------------------------------------------------------


@pytest.mark.parametrize("nick", ["admin", "Администратор", "Moderator_2", "f_u_c_k", "Аdmin"])
def test_reserved_and_forbidden_nicks_are_422(api: TestClient, nick: str) -> None:
    assert api.post("/api/guest", json={"nick": nick}).status_code == 422


def test_homoglyph_of_a_taken_nick_is_taken(api: TestClient) -> None:
    guest(api, "Captain")
    for spoof in ("Сaptain", "Capta1n", "Cap_tain", "CAPTAIN"):
        # the Latin-with-one-Cyrillic spoof is a mixed script (422), the others collide (409)
        status = api.post("/api/guest", json={"nick": spoof}).status_code
        assert status in (409, 422), spoof
    assert api.post("/api/guest", json={"nick": "Сарtain"}).status_code == 422
    assert api.post("/api/guest", json={"nick": "Capta1n"}).status_code == 409
    # a whole-script spoof: Cyrillic Sa-a-er-ie... of a Latin nick
    guest(api, "Pop")
    assert api.post("/api/guest", json={"nick": "Рор"}).status_code == 409


def test_blocklist_file_setting(settings: Settings, tmp_path: Path) -> None:
    words = tmp_path / "words.txt"
    words.write_text("darnit\n", encoding="utf-8")
    custom = settings.model_copy(update={"nick_blocklist_file": words})
    with TestClient(create_app(custom)) as client:
        assert client.post("/api/guest", json={"nick": "Darnit42"}).status_code == 422
        assert client.post("/api/guest", json={"nick": "Fine42"}).status_code == 201


# Nick change ------------------------------------------------------------------------------------


def test_nick_change(api: TestClient) -> None:
    headers, _ = guest(api, "Alice")
    response = api.put("/api/me/nick", json={"nick": "Alicia"}, headers=headers)
    assert response.status_code == 200
    assert response.json()["nick"] == "Alicia"
    assert api.get("/api/me", headers=headers).json()["nick"] == "Alicia"
    guest(api, "Alice")  # the old nick is free again
    # the same player may change the spelling of their own nick
    assert api.put("/api/me/nick", json={"nick": "ALICIA"}, headers=headers).status_code == 200


def test_nick_change_follows_the_nick_rules(api: TestClient) -> None:
    headers, _ = guest(api, "Alice")
    guest(api, "Bobby")

    def put(nick: str) -> Response:
        return api.put("/api/me/nick", json={"nick": nick}, headers=headers)

    assert put("bobby").status_code == 409
    assert put("admin").status_code == 422
    assert put("a b").status_code == 422
    assert api.put("/api/me/nick", json={"nick": "Newnick"}).status_code == 401


def test_nick_change_rate_limited_per_player(settings: Settings, clock: ManualClock) -> None:
    limited = settings.model_copy(
        update={"nick_change_rate_limit": 2, "nick_change_rate_window_s": 100}
    )
    with TestClient(create_app(limited, clock)) as client:
        first, _ = guest(client, "Alice")
        other, _ = guest(client, "Bobby")
        for nick in ("Alice2", "Alice3"):
            assert client.put("/api/me/nick", json={"nick": nick}, headers=first).status_code == 200
        blocked = client.put("/api/me/nick", json={"nick": "Alice4"}, headers=first)
        assert blocked.status_code == 429
        assert int(blocked.headers["Retry-After"]) > 0
        # another player has their own budget
        assert client.put("/api/me/nick", json={"nick": "Bobby2"}, headers=other).status_code == 200
        assert client.get("/api/me", headers=first).json()["nick"] == "Alice3"


# Match creation limit ---------------------------------------------------------------------------


def test_match_creation_rate_limited_per_player(settings: Settings, clock: ManualClock) -> None:
    limited = settings.model_copy(
        update={"match_create_rate_limit": 2, "match_create_rate_window_s": 100}
    )
    with TestClient(create_app(limited, clock)) as client:
        host, _ = guest(client, "Hostie")
        other, _ = guest(client, "Other1")
        # An invite that is not started does not count as an active match: only the limit stops.
        for _ in range(2):
            assert client.post("/api/matches", json={}, headers=host).status_code == 201
        refused = client.post("/api/matches", json={}, headers=host)
        assert refused.status_code == 429
        assert 0 < int(refused.headers["Retry-After"]) <= 100
        assert client.post("/api/matches", json={}, headers=other).status_code == 201


def test_bot_match_creation_shares_the_match_limit(settings: Settings, clock: ManualClock) -> None:
    limited = settings.model_copy(
        update={"match_create_rate_limit": 1, "match_create_rate_window_s": 100}
    )
    with TestClient(create_app(limited, clock)) as client:
        headers, _ = guest(client, "Botter")
        assert client.post("/api/matches", json={}, headers=headers).status_code == 201
        refused = client.post("/api/bot-matches", json={"level": "easy"}, headers=headers)
        assert refused.status_code == 429


def test_queue_limiter_is_configured_from_settings(settings: Settings) -> None:
    clock = ManualClock()
    limits = Limits(
        settings.model_copy(update={"queue_rate_limit": 2, "queue_rate_window_s": 30}), clock
    )
    assert limits.queue.hit("7") is None
    assert limits.queue.hit("7") is None
    assert limits.queue.hit("7") == 30
    clock.advance(30)
    assert limits.queue.hit("7") is None


# Blocking and gow-admin -------------------------------------------------------------------------


def sessions_of(client: TestClient) -> sessionmaker[Session]:
    sessions = client.app.state.sessions  # type: ignore[attr-defined]
    assert isinstance(sessions, sessionmaker)
    return cast("sessionmaker[Session]", sessions)


def test_blocked_player_is_refused_and_unblocked_again(settings: Settings) -> None:
    with TestClient(create_app(settings)) as client:
        headers, player_id = guest(client, "Trouble")
        token = headers["Authorization"].removeprefix("Bearer ")
        sessions = sessions_of(client)
        assert account_of(sessions, token) == player_id

        assert "blocked" in admin.run(sessions, ["block", "trouble"])
        assert client.get("/api/me", headers=headers).status_code == 403
        assert client.post("/api/matches", json={}, headers=headers).status_code == 403
        assert account_of(sessions, token) is None  # the match WebSocket treats it as unknown

        assert "active" in admin.run(sessions, ["unblock", str(player_id)])
        assert client.get("/api/me", headers=headers).status_code == 200
        assert account_of(sessions, token) == player_id


def test_admin_rename_show_and_errors(settings: Settings) -> None:
    with TestClient(create_app(settings)) as client:
        headers, player_id = guest(client, "Oldnick")
        guest(client, "Taken1")
        sessions = sessions_of(client)

        assert admin.run(sessions, ["show", "OLDNICK"]) == f"id={player_id} nick=Oldnick active"
        # the operator may use a reserved nick, but format and uniqueness still apply
        assert "nick=Admin" in admin.run(sessions, ["rename", str(player_id), "Admin"])
        assert client.get("/api/me", headers=headers).json()["nick"] == "Admin"
        for args, message in (
            (["rename", "Admin", "taken1"], "nick is taken"),
            (["rename", "Admin", "a b"], "nick may contain"),
            (["block", "nobody"], "no such player"),
            (["show", "9999"], "no such player"),
        ):
            with pytest.raises(admin.AdminError, match=message):
                admin.run(sessions, args)


def test_admin_main_exits_with_a_message(
    settings: Settings, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("GOW_DATABASE_URL", settings.database_url)
    admin.main(["show", "1"]) if False else None
    with pytest.raises(SystemExit, match="gow-admin: no such player: 1"):
        admin.main(["show", "1"])


# Migration --------------------------------------------------------------------------------------


def test_migration_0004_rekeys_existing_nicks(tmp_path: Path) -> None:
    db_path = tmp_path / "old.db"
    config = Config(ALEMBIC_INI)
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    command.upgrade(config, "0003")
    with sqlite3.connect(db_path) as connection:
        for nick, key in (("Alice", "alice"), ("Аlice", "аlice"), ("Bobby", "bobby")):
            connection.execute(
                "INSERT INTO players (nick, nick_key, token_hash, created_at)"
                " VALUES (?, ?, ?, '2026-01-01')",
                (nick, key, key.encode().ljust(32, b"-")),
            )
    command.upgrade(config, "0004")
    with sqlite3.connect(db_path) as connection:
        keys = dict(connection.execute("SELECT nick, nick_key FROM players").fetchall())
    assert keys["Alice"] == "alice".translate(str.maketrans("il", "ll"))
    assert keys["Аlice"] == keys["Alice"] + "#2"  # a look-alike keeps working, keyed apart
    assert keys["Bobby"] == "bobby"
    command.downgrade(config, "0003")
    with sqlite3.connect(db_path) as connection:
        assert ("alice",) in connection.execute("SELECT nick_key FROM players").fetchall()
