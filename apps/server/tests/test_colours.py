"""DEC-49 (#906): the player colour set, the allowed pairs, the clash rule, the profile field and
its API, the colours of a match in ``welcome`` and in the ``match_players`` rows."""

import sqlite3
from collections.abc import Iterator
from pathlib import Path
from typing import cast

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from gow_protocol.codec import decode_server, encode
from gow_protocol.messages import PROTOCOL_VERSION, HelloMsg, PlayerColour, WelcomeMsg
from gow_server.app import create_app
from gow_server.clock import ManualClock
from gow_server.colours import (
    DEFAULT_COLOUR,
    DEFAULT_PAIR,
    DISTANCES,
    HEX,
    allowed,
    colour_of,
    distances,
    farthest,
    resolve,
    resolve_sides,
)
from gow_server.matches import MatchManager, MatchRunner
from gow_server.models import MatchPlayer
from gow_server.settings import Settings

ALEMBIC_INI = Path(__file__).parents[1] / "alembic.ini"

LAPIS, MINIUM, GLACIER, SHELL, VIOLET, MADDER = tuple(PlayerColour)


# The set and its table (DEC-49, items 1 and 3) --------------------------------------------------


def test_the_set_is_engraved_six_with_the_values_of_dec_49() -> None:
    assert HEX == {
        LAPIS: "#86a6ea",
        MINIUM: "#e5785e",
        GLACIER: "#a6e0e8",
        SHELL: "#f4b4a4",
        VIOLET: "#966fd6",
        MADDER: "#c8587e",
    }
    assert DEFAULT_COLOUR is LAPIS  # today's own colour: a player who never chose sees no change


def test_the_table_has_every_pair_once() -> None:
    colours = list(PlayerColour)
    expected = {(a, b) for i, a in enumerate(colours) for b in colours[i + 1 :]}
    assert set(DISTANCES) == expected
    assert distances(VIOLET, LAPIS) == distances(LAPIS, VIOLET)
    with pytest.raises(ValueError):
        distances(LAPIS, LAPIS)


def test_fourteen_of_fifteen_pairs_are_open_and_lapis_violet_is_closed() -> None:
    """DEC-49, item 1: 14 of 15 open; closed Lapis/Violet in deuteranopia, distance 11."""
    closed = [pair for pair in DISTANCES if not allowed(*pair)]
    assert closed == [(LAPIS, VIOLET)]
    assert round(distances(LAPIS, VIOLET)[2] / 10) == 11
    # The issue's table: every pair at least 15 apart in normal vision, today's pair 40 apart.
    assert min(normal for normal, _, _ in DISTANCES.values()) >= 150
    assert round(distances(LAPIS, MINIUM)[0] / 10) == 40


def test_a_colour_is_never_allowed_with_itself() -> None:
    assert not any(allowed(c, c) for c in PlayerColour)


# The clash rule (DEC-49, item 2) ----------------------------------------------------------------


@pytest.mark.parametrize(
    ("keeper", "expected"),
    [
        (LAPIS, MINIUM),  # 40.0 (Madder 36.6): the default pair is today's pair
        (MINIUM, GLACIER),  # 44.4
        (GLACIER, MADDER),  # 49.8
        (SHELL, VIOLET),  # 37.5 (Glacier 36.6)
        (VIOLET, MINIUM),  # 37.7 (Shell 37.5)
        (MADDER, GLACIER),  # 49.8
    ],
)
def test_farthest_allowed_colour(keeper: PlayerColour, expected: PlayerColour) -> None:
    assert farthest(keeper) is expected
    assert allowed(keeper, expected)


@pytest.mark.parametrize(
    ("keeper", "wish", "expected"),
    [
        (SHELL, SHELL, VIOLET),  # the same colour: the farthest from the keeper's
        (LAPIS, VIOLET, MINIUM),  # a pair that is not allowed: the farthest, not the nearest
        (VIOLET, LAPIS, MINIUM),  # the same pair the other way round
        (LAPIS, GLACIER, GLACIER),  # an allowed pair: the wish stands, though it is not farthest
        (MINIUM, SHELL, SHELL),  # the closest allowed pair (15.4) still stands
        (MADDER, None, GLACIER),  # a bot: always the farthest
    ],
)
def test_resolve(keeper: PlayerColour, wish: PlayerColour | None, expected: PlayerColour) -> None:
    assert resolve(keeper, wish) is expected


def test_resolve_sides_by_player_id() -> None:
    # The keeper is side 1: side 1 keeps its wish, side 0 gets the farthest.
    assert resolve_sides((SHELL, SHELL), 1) == (VIOLET, SHELL)
    assert resolve_sides((SHELL, SHELL), 0) == (SHELL, VIOLET)
    assert resolve_sides((GLACIER, SHELL), 0) == (GLACIER, SHELL)  # allowed: nobody moves


def test_a_bot_side_never_keeps() -> None:
    """A bot match: the human keeps their colour, the bot gets the farthest (DEC-49)."""
    assert resolve_sides((None, GLACIER), 0) == (MADDER, GLACIER)
    assert resolve_sides((GLACIER, None), 0) == (GLACIER, MADDER)
    assert resolve_sides((LAPIS, None), 1) == (LAPIS, MINIUM)
    assert DEFAULT_PAIR == (LAPIS, MINIUM)  # no row: as the game was before DEC-49


def test_a_stored_value_outside_the_set_is_the_default() -> None:
    assert colour_of("madder") is MADDER
    assert colour_of(None) is DEFAULT_COLOUR
    assert colour_of("gold") is DEFAULT_COLOUR


# The profile API ---------------------------------------------------------------------------------


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


def set_colour(api: TestClient, headers: dict[str, str], colour: str) -> None:
    response = api.put("/api/me/colour", json={"colour": colour}, headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["colour"] == colour


def test_a_new_player_asks_for_lapis(api: TestClient) -> None:
    assert api.get("/api/me", headers=guest(api, "alice")).json()["colour"] == "lapis"


def test_the_colour_is_set_and_kept(api: TestClient) -> None:
    alice = guest(api, "alice")
    for colour in PlayerColour:
        set_colour(api, alice, colour.value)
        assert api.get("/api/me", headers=alice).json()["colour"] == colour.value


@pytest.mark.parametrize(
    "body",
    [
        {"colour": "gold"},  # not in the set
        {"colour": "Lapis"},  # the ids are lower case
        {"colour": "#86a6ea"},  # a hex value is not an id
        {"colour": None},
        {},
        {"colour": "lapis", "nick": "x"},  # extra fields are refused
    ],
)
def test_a_colour_outside_the_set_is_422(api: TestClient, body: dict[str, object]) -> None:
    alice = guest(api, "alice")
    response = api.put("/api/me/colour", json=body, headers=alice)
    assert response.status_code == 422
    assert api.get("/api/me", headers=alice).json()["colour"] == "lapis"


def test_the_colour_needs_a_token(api: TestClient) -> None:
    assert api.put("/api/me/colour", json={"colour": "shell"}).status_code == 401


# A match: welcome, reconnect, the rows ----------------------------------------------------------


def matches_of(api: TestClient) -> MatchManager:
    manager = api.app.state.matches  # type: ignore[attr-defined]
    assert isinstance(manager, MatchManager)
    return manager


def sessions_of(api: TestClient) -> "sessionmaker[Session]":
    return cast("sessionmaker[Session]", api.app.state.sessions)  # type: ignore[attr-defined]


def welcome_of(api: TestClient, match_id: str, headers: dict[str, str]) -> WelcomeMsg:
    with api.websocket_connect(
        f"/ws/match/{match_id}", headers={"Origin": "http://testserver"}
    ) as ws:
        token = headers["Authorization"].removeprefix("Bearer ")
        ws.send_text(encode(HelloMsg(protocol_version=PROTOCOL_VERSION, token=token)))
        welcome = decode_server(ws.receive_text())
    assert isinstance(welcome, WelcomeMsg)
    return welcome


def stored_colours(api: TestClient, match_id: str) -> list[tuple[int, str | None]]:
    with sessions_of(api)() as session:
        rows = session.execute(
            select(MatchPlayer.side, MatchPlayer.colour)
            .where(MatchPlayer.match_id == int(match_id))
            .order_by(MatchPlayer.side)
        ).all()
    return [(side, colour) for side, colour in rows]


def invite_match(api: TestClient, host: dict[str, str], guest_: dict[str, str]) -> MatchRunner:
    code = api.post("/api/matches", json={}, headers=host).json()["code"]
    assert api.post(f"/api/matches/{code}/join", headers=guest_).status_code == 200
    api.post(f"/api/matches/{code}/ready", headers=host)
    match_id = api.post(f"/api/matches/{code}/ready", headers=guest_).json()["match_id"]
    runner = matches_of(api).get(str(match_id))
    assert runner is not None
    return runner


def test_an_invite_clash_leaves_the_host_their_colour(api: TestClient) -> None:
    alice, bob = guest(api, "alice"), guest(api, "bob")
    set_colour(api, alice, "shell")
    set_colour(api, bob, "shell")
    runner = invite_match(api, alice, bob)
    host_side = runner.slot_of(1)  # alice is account 1
    assert host_side is not None
    expected = [SHELL, SHELL]
    expected[1 - host_side] = VIOLET  # the farthest allowed from Shell
    assert list(runner.colours) == expected
    # Both players get both colours by player id, and a reconnect gets the same.
    for headers in (alice, bob, alice):
        welcome = welcome_of(api, runner.match_id, headers)
        assert list(welcome.colours) == expected
    # Stored with the sides, for the replay.
    assert stored_colours(api, runner.match_id) == [(0, expected[0]), (1, expected[1])]
    # A later change of the profile does not change the running match.
    set_colour(api, bob, "glacier")
    assert list(welcome_of(api, runner.match_id, bob).colours) == expected


def test_an_allowed_pair_keeps_both_wishes(api: TestClient) -> None:
    alice, bob = guest(api, "alice"), guest(api, "bob")
    set_colour(api, alice, "madder")
    set_colour(api, bob, "glacier")
    runner = invite_match(api, alice, bob)
    by_account = {runner.players[side]: runner.colours[side] for side in (0, 1)}
    assert by_account == {1: MADDER, 2: GLACIER}


def test_two_players_who_never_chose_play_lapis_and_minium(api: TestClient) -> None:
    runner = invite_match(api, guest(api, "alice"), guest(api, "bob"))
    host_side = runner.slot_of(1)
    assert host_side is not None
    assert runner.colours[host_side] is LAPIS and runner.colours[1 - host_side] is MINIUM


def test_a_queue_clash_leaves_the_earlier_entry_its_colour(
    api: TestClient, clock: ManualClock
) -> None:
    alice, bob = guest(api, "alice"), guest(api, "bob")
    set_colour(api, alice, "lapis")
    set_colour(api, bob, "violet")  # a pair that is not allowed with Lapis
    assert api.post("/api/queue", headers=bob).status_code == 200  # bob first
    clock.advance(0.5)
    assert api.post("/api/queue", headers=alice).status_code == 200
    clock.advance(1)
    api.post("/api/queue/confirm", headers=alice)
    match_id = str(api.post("/api/queue/confirm", headers=bob).json()["match_id"])
    runner = matches_of(api).get(match_id)
    assert runner is not None
    by_account = {runner.players[side]: runner.colours[side] for side in (0, 1)}
    assert by_account == {2: VIOLET, 1: MINIUM}  # bob keeps Violet, alice the farthest


# Migration -------------------------------------------------------------------------------------


def test_migration_0008_gives_existing_players_lapis(tmp_path: Path) -> None:
    db_path = tmp_path / "old.db"
    config = Config(ALEMBIC_INI)
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    command.upgrade(config, "0007")
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            "INSERT INTO players (id, nick, nick_key, token_hash, created_at)"
            " VALUES (1, 'Alice', 'alice', ?, '2026-01-01')",
            (b"t" * 32,),
        )
        connection.execute(
            "INSERT INTO matches (id, map_id, ruleset_hash, rated, created_at)"
            " VALUES (1, 'line3', 'x', 0, '2026-01-01')"
        )
        connection.execute("INSERT INTO match_players (match_id, side, player_id) VALUES (1, 0, 1)")
        connection.execute(
            "INSERT INTO match_players (match_id, side, bot) VALUES (1, 1, 'turtle')"
        )
    command.upgrade(config, "0008")
    with sqlite3.connect(db_path) as connection:
        players = connection.execute("SELECT nick, colour FROM players").fetchall()
        sides = connection.execute(
            "SELECT side, colour FROM match_players ORDER BY side"
        ).fetchall()
    assert players == [("Alice", "lapis")]
    assert sides == [(0, None), (1, None)]  # a match from before #906 has no colours
    command.downgrade(config, "0007")
    with sqlite3.connect(db_path) as connection:
        for table in ("players", "match_players"):
            columns = {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}
            assert "colour" not in columns
