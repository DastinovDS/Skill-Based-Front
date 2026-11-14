"""The tutorial on the server (#806): the runner's pauses on its loop, the endpoints, the match
row and the maps. The chapters themselves, played to their goals: ``test_tutorial_chapters.py``."""

import asyncio
import shutil
import sqlite3
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import httpx2
import pytest
import uvicorn
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import select
from websockets.asyncio.client import ClientConnection, connect
from websockets.typing import Origin

from gow_protocol import commands as wire
from gow_protocol.codec import decode_server, encode
from gow_protocol.convert import opaque_to_wire
from gow_protocol.messages import (
    PROTOCOL_VERSION,
    AckMsg,
    CommandMsg,
    ErrorMsg,
    HelloMsg,
    MatchEndMsg,
    PauseMsg,
    ResumeMsg,
    ServerMsg,
    SnapshotMsg,
    TutorialMsg,
    WelcomeMsg,
)
from gow_protocol.ruleset import RulesetPublic
from gow_protocol.tutorial import chapter_paths, load_chapter
from gow_server.app import create_app
from gow_server.cli import WS_MAX_SIZE
from gow_server.clock import ManualClock
from gow_server.maps import MapCatalog, choose_map
from gow_server.matches import BOT_ACCOUNT, MatchManager, MatchRunner
from gow_server.models import Match
from gow_server.settings import Settings
from gow_server.tutorial import ChapterBook, TutorialDirector, chapter_rules
from gow_server.tutorialmatch import opponent_seat
from gow_sim.maps import load_map
from gow_sim.ruleset import Stance, load_ruleset
from gow_sim.state import AtNode

ROOT: Final = Path(__file__).parents[3]
ALEMBIC_INI: Final = Path(__file__).parents[1] / "alembic.ini"
RULES: Final = load_ruleset(ROOT / "rulesets" / "mvp-7.toml")
CHAPTERS: Final = {c.id: c for c in map(load_chapter, chapter_paths(ROOT / "tutorial/chapters"))}
DT: Final = 0.1
TIMEOUT_S: Final = 5.0


def chapter_runner(chapter_id: str, clock: ManualClock, **kwargs: object) -> MatchRunner:
    chapter = CHAPTERS[chapter_id]
    mapdef = load_map(ROOT / "maps" / "tutorial" / f"{chapter.map}.json")
    return MatchRunner(
        "t",
        chapter.map,
        mapdef,
        chapter_rules(RULES, chapter),
        (7, BOT_ACCOUNT),
        clock,
        bot=opponent_seat(chapter, mapdef),
        tutorial=TutorialDirector(chapter, mapdef),
        **kwargs,  # type: ignore[arg-type]
    )


def group_in(runner: MatchRunner, node: int) -> str:
    view = runner.match.view(0)
    (group,) = [
        g for g in view.groups if isinstance(g.location, AtNode) and g.location.node == node
    ]
    return opaque_to_wire(group.id)


# The loop -----------------------------------------------------------------------------------


def test_no_tick_passes_while_a_card_waits() -> None:
    """Chapter I on its real loop: the first card waits for its order, the third for Continue;
    time runs on meanwhile and no tick passes."""

    async def scenario() -> None:
        clock = ManualClock()
        runner = chapter_runner("units", clock)
        task = asyncio.create_task(runner.run())
        box = runner.attach(0)
        ids = {n.name: n.id for n in runner.match.state.map.nodes}

        async def advance(seconds: float) -> None:
            for _ in range(round(seconds / DT)):
                clock.advance(DT)
                await asyncio.sleep(0)

        await advance(5.0)
        assert runner.paused and runner.match.tick == 0  # I.1: waits for the march
        assert not runner.request_resume(0)  # an action card has no Continue
        assert not runner.request_pause(0) and not runner.pause_available(0)
        while box.get_nowait() is not None:
            pass
        # a command the beat does not allow: answered at once, the card still waits
        assert runner.submit(0, 1, wire.SetStanceCmd(stance=Stance.WAR))
        refused = box.get_nowait()
        assert isinstance(refused, AckMsg) and refused.reject_code == "INVALID_ARGUMENT"
        assert runner.paused
        group = group_in(runner, ids["Highhold"])
        assert runner.submit(0, 2, wire.MoveCmd(group=group, dest=ids["Ashford"], planned=False))
        assert not runner.paused  # the asked order ends the pause
        await advance(0.15)
        assert runner.match.tick == 1 and runner.paused  # I.3 (capacity) waits for Continue
        await advance(5.0)
        assert runner.match.tick == 1
        assert runner.request_resume(0)
        await advance(1.0)
        assert runner.match.tick == 11 and not runner.paused
        runner.technical_defeat(0)
        await advance(0.2)
        await asyncio.wait_for(task, TIMEOUT_S)
        assert runner.finished

    asyncio.run(scenario())


def test_a_chapter_nobody_joins_is_dropped_while_its_first_card_waits() -> None:
    async def scenario() -> None:
        clock = ManualClock()
        runner = chapter_runner("units", clock, connect_timeout_s=15.0)
        task = asyncio.create_task(runner.run())
        for _ in range(200):
            clock.advance(DT)
            await asyncio.sleep(0)
        await asyncio.wait_for(task, TIMEOUT_S)
        assert runner.never_started and runner.match.tick == 0

    asyncio.run(scenario())


def test_a_refused_command_is_answered_at_once_and_never_applied() -> None:
    runner = chapter_runner("units", ManualClock())
    box = runner.attach(0)
    while box.get_nowait() is not None:
        pass
    before = runner.match.state_hash()
    assert runner.submit(0, 1, wire.BuildFactoryCmd(node=0))
    ack = box.get_nowait()
    assert isinstance(ack, AckMsg)
    assert (ack.seq, ack.reject_code, ack.applied_tick) == (1, "INVALID_ARGUMENT", 1)
    assert runner.match.state_hash() == before
    assert not runner.submit(0, 1, wire.BuildFactoryCmd(node=0))  # its seq is used up


# Over HTTP and the WebSocket ----------------------------------------------------------------


@pytest.fixture
def tutorial_settings(maps_dir: Path, tmp_path: Path) -> Settings:
    shutil.copytree(ROOT / "maps" / "tutorial", maps_dir / "tutorial")
    shutil.copy(ROOT / "maps" / "fixtures" / "web.json", maps_dir)
    return Settings(
        maps_dir=maps_dir,
        tutorial_dir=ROOT / "tutorial" / "chapters",
        database_url=f"sqlite:///{tmp_path / 'gow.db'}",
        replays_dir=tmp_path / "replays",
        rulesets_dir=tmp_path / "rulesets",
        ruleset_path=ROOT / "rulesets" / "mvp-7.toml",
        bot_budget_s=60.0,
    )


@dataclass
class Live:
    clock: ManualClock
    manager: MatchManager
    http: httpx2.AsyncClient
    host: str
    headers: dict[str, str]
    token: str
    player_id: int

    def socket(self, match_id: str) -> connect:
        return connect(
            f"ws://{self.host}/ws/match/{match_id}",
            origin=Origin(f"http://{self.host}"),
            open_timeout=TIMEOUT_S,
            compression=None,
        )

    async def start(self, chapter: str) -> httpx2.Response:
        return await self.http.post(
            "/api/tutorial-matches", json={"chapter": chapter}, headers=self.headers
        )

    async def advance(self, seconds: float) -> None:
        for _ in range(round(seconds / DT)):
            self.clock.advance(DT)
            await asyncio.sleep(0.001)


@asynccontextmanager
async def live_server(settings: Settings) -> AsyncGenerator[Live]:
    clock = ManualClock()
    app = create_app(settings, clock)
    config = uvicorn.Config(
        app, host="127.0.0.1", port=0, log_config=None, ws_max_size=WS_MAX_SIZE, lifespan="on"
    )
    server = uvicorn.Server(config)
    task = asyncio.create_task(server.serve())
    while not server.started:
        await asyncio.sleep(0.01)
    host = f"127.0.0.1:{server.servers[0].sockets[0].getsockname()[1]}"
    try:
        async with httpx2.AsyncClient(base_url=f"http://{host}") as http:
            guest = (await http.post("/api/guest", json={"nick": "pupil"})).json()
            headers = {"Authorization": f"Bearer {guest['token']}"}
            manager = app.state.matches
            assert isinstance(manager, MatchManager)
            yield Live(clock, manager, http, host, headers, guest["token"], guest["player_id"])
    finally:
        server.should_exit = True
        await task


async def recv(ws: ClientConnection) -> ServerMsg:
    return decode_server(await asyncio.wait_for(ws.recv(), TIMEOUT_S))


async def recv_until[T](ws: ClientConnection, kind: type[T]) -> T:
    while True:
        msg = await recv(ws)
        if isinstance(msg, kind):
            return msg


def test_a_chapter_over_http_and_the_websocket(tutorial_settings: Settings) -> None:
    async def scenario() -> None:
        async with live_server(tutorial_settings) as live:
            created = await live.start("units")
            assert created.status_code == 201, created.text
            info = created.json()
            assert (info["chapter"], info["map_id"], info["player"]) == ("units", "tut-move", 0)
            assert (await live.start("economy")).status_code == 409  # one active match
            active = await live.http.get("/api/me/active-match", headers=live.headers)
            assert active.json()["chapter"] == "units"
            runner = live.manager.get(info["match_id"])
            assert runner is not None and runner.tutorial is not None
            assert runner.replay is None  # a chapter keeps no replay
            ids = {n.name: n.id for n in runner.match.state.map.nodes}

            async with live.socket(info["match_id"]) as ws:
                hello = HelloMsg(protocol_version=PROTOCOL_VERSION, token=live.token)
                await ws.send(encode(hello))
                welcome = await recv(ws)
                assert isinstance(welcome, WelcomeMsg) and welcome.player == 0
                assert welcome.pause_available is False
                assert welcome.ruleset_public.cp.cap == RULES.cp.cap
                beat = await recv(ws)
                assert beat == TutorialMsg(
                    chapter="units", beat="1", paused=True, used=(0,), done=False, tick=0
                )
                snapshot = await recv(ws)
                assert isinstance(snapshot, SnapshotMsg)
                assert snapshot.view.me.cp == RULES.cp.cap  # cp_start = cap
                await ws.send(encode(PauseMsg()))
                assert await recv(ws) == ErrorMsg(code="PAUSE_DENIED")
                await ws.send(encode(ResumeMsg()))  # an action card has no Continue
                assert await recv(ws) == ErrorMsg(code="PAUSE_DENIED")
                await ws.send(encode(CommandMsg(seq=1, cmd=wire.SetStanceCmd(stance=Stance.WAR))))
                refused = await recv_until(ws, AckMsg)
                assert (refused.seq, refused.reject_code) == (1, "INVALID_ARGUMENT")
                group = group_in(runner, ids["Highhold"])
                move = wire.MoveCmd(group=group, dest=ids["Ashford"], planned=False)
                await ws.send(encode(CommandMsg(seq=2, cmd=move)))
                resumed = await recv_until(ws, TutorialMsg)
                assert (resumed.beat, resumed.paused) == ("1", False)
                await live.advance(0.2)
                ack = await recv_until(ws, AckMsg)
                assert (ack.seq, ack.applied_tick, ack.reject_code) == (2, 1, None)
                card = await recv_until(ws, TutorialMsg)
                assert (card.beat, card.paused) == ("3", True)
                await live.advance(2.0)
                assert runner.match.tick == 1  # paused
                await ws.send(encode(ResumeMsg()))  # Continue
                going = await recv_until(ws, TutorialMsg)
                assert (going.beat, going.paused) == ("3", False)
                await ws.send(encode(CommandMsg(seq=3, cmd=wire.ForfeitCmd())))  # leave
                await live.advance(0.3)
                end = await recv_until(ws, MatchEndMsg)
                assert end.winner == 1

            await asyncio.sleep(0.2)  # the result is written in a thread
            profile = await live.http.get(f"/api/players/{live.player_id}")
            assert profile.status_code == 200
            assert profile.json()["matches"] == []
            assert profile.json()["record"] == {"wins": 0, "losses": 0, "draws": 0}

    asyncio.run(scenario())
    engine_url = tutorial_settings.database_url
    from sqlalchemy import create_engine

    with create_engine(engine_url).connect() as connection:
        kinds = connection.execute(select(Match.kind, Match.rated)).all()
    assert kinds == [("tutorial", False)]


def test_unknown_chapter_and_anonymous(tutorial_settings: Settings) -> None:
    with TestClient(create_app(tutorial_settings)) as client:
        guest = client.post("/api/guest", json={"nick": "pupil"}).json()
        headers = {"Authorization": f"Bearer {guest['token']}"}
        unknown = client.post("/api/tutorial-matches", json={"chapter": "nope"}, headers=headers)
        assert unknown.status_code == 422
        anonymous = client.post("/api/tutorial-matches", json={"chapter": "units"})
        assert anonymous.status_code in (401, 403)


def test_without_the_tutorial_maps_the_tutorial_is_off(settings: Settings) -> None:
    with TestClient(create_app(settings)) as client:
        guest = client.post("/api/guest", json={"nick": "pupil"}).json()
        headers = {"Authorization": f"Bearer {guest['token']}"}
        answer = client.post("/api/tutorial-matches", json={"chapter": "units"}, headers=headers)
        assert answer.status_code == 503


def test_ruleset_endpoint(tutorial_settings: Settings) -> None:
    with TestClient(create_app(tutorial_settings)) as client:
        answer = client.get("/api/ruleset")
        assert answer.status_code == 200
        assert "public" in answer.headers["Cache-Control"]
        assert RulesetPublic.model_validate_json(answer.content) == RulesetPublic.from_ruleset(
            RULES
        )


def test_tutorial_maps_are_served_but_never_chosen(tutorial_settings: Settings) -> None:
    catalog = MapCatalog.load(tutorial_settings.maps_dir)
    tutorial = sorted(e.id for e in catalog.all() if e.tutorial)
    assert tutorial == sorted(c.map for c in CHAPTERS.values())
    assert not [e for e in catalog.pool() + catalog.generated() if e.tutorial]
    with pytest.raises(Exception, match="422"):
        choose_map(catalog, "tut-move")
    with TestClient(create_app(tutorial_settings)) as client:
        listed = {m["id"] for m in client.get("/api/maps").json()}
        assert listed == {"web", "line3", "diamond"}  # the pool, no tutorial map
        assert client.get("/api/maps/tut-move").status_code == 200
        summary = client.get("/api/maps/tut-move/summary").json()
        assert summary["background_url"] and summary["thumb_url"]
        guest = client.post("/api/guest", json={"nick": "pupil"}).json()
        headers = {"Authorization": f"Bearer {guest['token']}"}
        bot = client.post("/api/bot-matches", json={"map_id": "tut-move"}, headers=headers)
        assert bot.status_code == 422


def test_the_server_loads_the_real_chapters() -> None:
    """The layout of the repository (and of the image, ``deploy/app.Dockerfile``)."""
    book = ChapterBook.load(ROOT / "tutorial" / "chapters", MapCatalog.load(ROOT / "maps"), RULES)
    assert [c.id for c in book] == list(CHAPTERS)
    assert Settings().tutorial_dir == Path("tutorial/chapters")


# The migration ------------------------------------------------------------------------------


def test_migration_0009_marks_earlier_rows_as_matches(tmp_path: Path) -> None:
    db_path = tmp_path / "old.db"
    config = Config(ALEMBIC_INI)
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    command.upgrade(config, "0008")
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            "INSERT INTO matches (id, map_id, ruleset_hash, rated, created_at)"
            " VALUES (1, 'line3', 'x', 0, '2026-01-01')"
        )
    command.upgrade(config, "0009")
    with sqlite3.connect(db_path) as connection:
        assert connection.execute("SELECT kind FROM matches").fetchall() == [("match",)]
    command.downgrade(config, "0008")
    with sqlite3.connect(db_path) as connection:
        columns = {row[1] for row in connection.execute("PRAGMA table_info(matches)")}
    assert "kind" not in columns


# The progress of an account (section 7.8) ---------------------------------------------------

FLAGS: Final[dict[str, object]] = {
    "offer_off": False,
    "first_match": False,
    "first_match_id": None,
    "hints": [],
    "hints_off": False,
}
EMPTY: Final[dict[str, object]] = {
    "done": [],
    "offer_off": False,
    "first_match": False,
    "first_match_id": None,
    "hints": [],
    "hints_off": False,
}


def _guest(client: TestClient, nick: str) -> dict[str, str]:
    guest = client.post("/api/guest", json={"nick": nick}).json()
    return {"Authorization": f"Bearer {guest['token']}"}


def test_progress_is_empty_for_a_new_guest_and_needs_a_token(settings: Settings) -> None:
    with TestClient(create_app(settings)) as client:
        headers = _guest(client, "pupil")
        answer = client.get("/api/me/tutorial", headers=headers)
        assert answer.status_code == 200
        assert answer.json() == EMPTY
        assert answer.headers["Cache-Control"] == "no-store"
        assert client.get("/api/me/tutorial").status_code in (401, 403)
        assert client.put("/api/me/tutorial", json=FLAGS).status_code in (401, 403)


def test_progress_flags_are_saved_and_two_players_do_not_share(settings: Settings) -> None:
    with TestClient(create_app(settings)) as client:
        first, second = _guest(client, "pupil"), _guest(client, "other")
        flags = {
            **FLAGS,
            "offer_off": True,
            "first_match_id": "12",
            "hints": ["H3", "H1"],
            "hints_off": True,
        }
        put = client.put("/api/me/tutorial", json=flags, headers=first)
        assert put.status_code == 200, put.text
        saved = {**EMPTY, **flags, "hints": ["H1", "H3"]}  # in the order of the hints
        assert put.json() == saved
        assert client.get("/api/me/tutorial", headers=first).json() == saved
        assert client.get("/api/me/tutorial", headers=second).json() == EMPTY
    # Survives a restart of the server (the progress is in the database).
    with TestClient(create_app(settings)) as client:
        assert client.get("/api/me/tutorial", headers=first).json() == saved


@pytest.mark.parametrize(
    "patch",
    [
        {"hints": ["H9"]},
        {"hints": ["H1"] * 6},
        {"first_match_id": "not-a-number"},
        {"first_match_id": "1" * 40},
        {"import_done": ["units"]},  # the old browser import is gone
        {"done": ["units"]},  # a client cannot claim a chapter
        {"extra": 1},
        {"offer_off": "yes"},
    ],
)
def test_progress_rejects_bad_flags(settings: Settings, patch: dict[str, object]) -> None:
    with TestClient(create_app(settings)) as client:
        headers = _guest(client, "pupil")
        answer = client.put("/api/me/tutorial", json={**FLAGS, **patch}, headers=headers)
        assert answer.status_code == 422
        assert client.get("/api/me/tutorial", headers=headers).json() == EMPTY


def test_a_chapter_goal_marks_it_done_and_a_left_chapter_does_not(
    tutorial_settings: Settings,
) -> None:
    async def scenario() -> None:
        async with live_server(tutorial_settings) as live:

            async def progress() -> dict[str, object]:
                answer = await live.http.get("/api/me/tutorial", headers=live.headers)
                body: dict[str, object] = answer.json()
                return body

            async def leave(chapter: str, *, goal: bool) -> None:
                info = (await live.start(chapter)).json()
                runner = live.manager.get(info["match_id"])
                assert runner is not None and runner.tutorial is not None
                if goal:
                    runner.tutorial.done = True  # the director's goal, which the beats reach
                async with live.socket(info["match_id"]) as ws:
                    hello = HelloMsg(protocol_version=PROTOCOL_VERSION, token=live.token)
                    await ws.send(encode(hello))
                    await ws.send(encode(CommandMsg(seq=1, cmd=wire.ForfeitCmd())))
                    await live.advance(0.3)
                    await recv_until(ws, MatchEndMsg)
                await asyncio.sleep(0.3)  # the result is written in a thread

            await leave("units", goal=False)
            assert (await progress())["done"] == []
            await leave("economy", goal=True)
            assert (await progress())["done"] == ["economy"]
            await leave("units", goal=True)
            assert (await progress())["done"] == ["units", "economy"]
            other = (await live.http.post("/api/guest", json={"nick": "other"})).json()
            theirs = {"Authorization": f"Bearer {other['token']}"}
            assert (await live.http.get("/api/me/tutorial", headers=theirs)).json()["done"] == []

    asyncio.run(scenario())
