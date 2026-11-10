"""#924: the server start flags ``GOW_RATING_ENABLED`` and ``GOW_QUEUE_MAPS`` (owner, 2026-11-10).

Expected behaviour (mechanics.md, section 19, "Matchmaking queue", "Rating off"):

- rating off (the default): a queue match is unrated, changes no rating and bans nobody; the queue
  pairs first come, first served; no calibration, rating, rank or leaderboard entry is shown;
- rating on: the queue is rated as before (DEC-34; the other tests run with it on, ``conftest``);
- either way a queue match is not private: no pauses (DEC-05);
- ``GOW_QUEUE_MAPS=generated``: the queue match plays a map made for its pair, never rated
  (DEC-27, item 8), a pool map when it cannot be made; ``pool`` (the default): a pool map.
"""

import asyncio
import json
import shutil
import threading
import time
from collections.abc import AsyncGenerator, Callable, Generator, Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager, contextmanager
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import Any, Final, cast

import httpx2
import pytest
import uvicorn
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
from websockets.asyncio.client import ClientConnection, connect
from websockets.typing import Origin

from gow_protocol import commands as wire
from gow_protocol.codec import decode_server, encode
from gow_protocol.messages import (
    PROTOCOL_VERSION,
    CommandMsg,
    ErrorMsg,
    HelloMsg,
    MatchEndMsg,
    PauseMsg,
    WelcomeMsg,
)
from gow_server.app import create_app
from gow_server.cli import WS_MAX_SIZE
from gow_server.clock import ManualClock
from gow_server.identity import hash_token
from gow_server.mapgen import MapMaker, store_dir
from gow_server.mapworker import MapBuilt, MapJob
from gow_server.matches import MatchManager
from gow_server.models import Match, MatchPlayer, Player, Rating
from gow_server.settings import Settings

ROOT: Final = Path(__file__).parents[3]
GEN: Final = ROOT / "maps" / "gen"
SOURCE: Final = "gen1-17"
"""The stored generated map the stand-in job copies (``meta.symmetry = "none"``)."""
POOL: Final = {"diamond", "line3", "web"}
DT: Final = 0.1
TIMEOUT_S: Final = 30.0
RECV_TIMEOUT_S: Final = 5.0
Headers = dict[str, str]


def test_the_defaults_are_rating_off_and_pool_maps(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GOW_RATING_ENABLED")  # set on for the other tests by conftest.py
    settings = Settings()
    assert settings.rating_enabled is False
    assert settings.queue_maps == "pool"
    monkeypatch.setenv("GOW_RATING_ENABLED", "true")
    monkeypatch.setenv("GOW_QUEUE_MAPS", "generated")
    assert (Settings().rating_enabled, Settings().queue_maps) == (True, "generated")


# A queue match over a real server and WebSocket -------------------------------------------------


@pytest.fixture
def live_settings(maps_dir: Path, tmp_path: Path) -> Settings:
    shutil.copy(ROOT / "maps" / "fixtures" / "web.json", maps_dir)
    return Settings(
        maps_dir=maps_dir,
        database_url=f"sqlite:///{tmp_path / 'gow.db'}",
        replays_dir=tmp_path / "replays",
        rulesets_dir=tmp_path / "rulesets",
        rulesets_bundled_dir=ROOT / "rulesets" / "archive",
        ruleset_path=ROOT / "rulesets" / "test-short.toml",
        early_resign_s=0,  # a forfeit at the first tick is a plain resign, rated with the rating on
    )


@dataclass
class Live:
    clock: ManualClock
    host: str
    http: httpx2.AsyncClient
    sessions: sessionmaker[Session]
    manager: MatchManager

    async def member(
        self, nick: str, *, rating: float = 1500.0, played: int = 5
    ) -> tuple[Headers, int]:
        """A password account with ``played`` rating-changing matches (5: calibrated)."""
        token = (await self.http.post("/api/guest", json={"nick": nick})).json()["token"]
        with self.sessions.begin() as session:
            player = session.execute(
                select(Player).where(Player.token_hash == hash_token(token))
            ).scalar_one()
            player.password_hash = "scrypt$not-a-real-hash"
            session.add(
                Rating(
                    player_id=player.id,
                    rating=rating,
                    rd=350.0,
                    volatility=0.06,
                    rated_matches=played,
                )
            )
            account = player.id
        return {"Authorization": f"Bearer {token}"}, account

    async def pair(self, first: Headers, second: Headers) -> dict[str, Any]:
        """Both enter the queue, are paired and confirm; the started status of ``second``."""
        for headers in (first, second):
            assert (await self.http.post("/api/queue", headers=headers)).status_code == 200
        self.clock.advance(1)  # the next pass
        found = (await self.http.get("/api/queue", headers=first)).json()
        assert found["state"] == "found", found
        await self.http.post("/api/queue/confirm", headers=first)
        started = (await self.http.post("/api/queue/confirm", headers=second)).json()
        assert started["state"] == "started", started
        return started

    async def run_until(self, condition: Callable[[], bool]) -> None:
        for _ in range(int(TIMEOUT_S / 0.01)):
            if condition():
                return
            self.clock.advance(DT)
            await asyncio.sleep(0.01)
        raise AssertionError("condition not reached")

    def row(self, match_id: str) -> tuple[Match, list[MatchPlayer]]:
        with self.sessions() as session:
            match = session.get_one(Match, int(match_id))
            sides = list(
                session.execute(
                    select(MatchPlayer)
                    .where(MatchPlayer.match_id == match.id)
                    .order_by(MatchPlayer.side)
                ).scalars()
            )
            return match, sides

    def ratings(self, *accounts: int) -> list[tuple[float, float, int]]:
        with self.sessions() as session:
            rows = [session.get_one(Rating, a) for a in accounts]
            return [(r.rating, r.rd, r.rated_matches) for r in rows]

    async def open(self, match_id: str, headers: Headers) -> tuple[ClientConnection, WelcomeMsg]:
        ws = await connect(
            f"ws://{self.host}/ws/match/{match_id}",
            origin=Origin(f"http://{self.host}"),
            open_timeout=RECV_TIMEOUT_S,
            close_timeout=0.5,
        )
        token = headers["Authorization"].removeprefix("Bearer ")
        await ws.send(encode(HelloMsg(protocol_version=PROTOCOL_VERSION, token=token)))
        welcome = decode_server(await asyncio.wait_for(ws.recv(), RECV_TIMEOUT_S))
        assert isinstance(welcome, WelcomeMsg)
        return ws, welcome


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
            yield Live(clock, host, http, app.state.sessions, app.state.matches)
    finally:
        server.should_exit = True
        await task


async def _next_error(ws: ClientConnection) -> ErrorMsg:
    while True:
        msg = decode_server(await asyncio.wait_for(ws.recv(), RECV_TIMEOUT_S))
        if isinstance(msg, ErrorMsg):
            return msg


async def _match_end(ws: ClientConnection) -> MatchEndMsg:
    while True:
        msg = decode_server(await asyncio.wait_for(ws.recv(), RECV_TIMEOUT_S))
        if isinstance(msg, MatchEndMsg):
            return msg


@pytest.mark.parametrize("rating_enabled", [False, True], ids=["rating-off", "rating-on"])
def test_a_queue_match_is_rated_only_with_the_rating_on_and_never_pauses(
    live_settings: Settings, rating_enabled: bool
) -> None:
    settings = live_settings.model_copy(update={"rating_enabled": rating_enabled})

    async def scenario() -> None:
        async with live_server(settings) as live:
            alice, alice_id = await live.member("alice")
            bob, bob_id = await live.member("bob")
            before = live.ratings(alice_id, bob_id)
            started = await live.pair(alice, bob)
            match_id = str(started["match_id"])
            assert started["map_id"] in POOL
            ws_alice, welcome = await live.open(match_id, alice)
            ws_bob, _ = await live.open(match_id, bob)
            async with ws_alice, ws_bob:
                assert welcome.pause_available is False  # DEC-05: a queue match, rating or not
                assert welcome.rated is rating_enabled
                await ws_alice.send(encode(PauseMsg()))
                assert (await _next_error(ws_alice)).code == "PAUSE_DENIED"
                await ws_alice.send(encode(CommandMsg(seq=1, cmd=wire.ForfeitCmd())))
                ending = asyncio.ensure_future(_match_end(ws_bob))
                await live.run_until(ending.done)
                end = ending.result()
            assert end.rated is rating_enabled
            assert (end.rating is not None) is rating_enabled
            await live.run_until(lambda: live.row(match_id)[0].status == "saved")
            row, sides = live.row(match_id)
            assert [s.result for s in sides if s.player_id == bob_id] == ["win"]
            assert row.rated is rating_enabled
            assert row.rating_applied is rating_enabled
            assert [s.rating_mode for s in sides] == ["rated" if rating_enabled else "none"] * 2
            after = live.ratings(alice_id, bob_id)
            if rating_enabled:
                assert all(a != b for a, b in zip(after, before, strict=True))
            else:
                assert after == before

    asyncio.run(scenario())


def test_rating_off_the_queue_pairs_first_come_and_reads_no_ban(live_settings: Settings) -> None:
    """With the rating on, 1500 and 2400 never meet (window at most 400) and the ban refuses."""
    settings = live_settings.model_copy(update={"rating_enabled": False})

    async def scenario() -> None:
        async with live_server(settings) as live:
            low, _ = await live.member("low", rating=1500.0)
            high, high_id = await live.member("high", rating=2400.0)
            with live.sessions.begin() as session:
                session.get_one(Player, high_id).queue_banned_until = live.clock.wall() + timedelta(
                    hours=2
                )
            started = await live.pair(low, high)
            assert live.row(str(started["match_id"]))[0].rated is False

    asyncio.run(scenario())


def test_rating_off_shows_no_rating_calibration_or_leaderboard(live_settings: Settings) -> None:
    settings = live_settings.model_copy(update={"rating_enabled": False})

    async def scenario() -> None:
        async with live_server(settings) as live:
            veteran, veteran_id = await live.member("veteran")
            newbie, newbie_id = await live.member("newbie", played=2)
            for headers in (veteran, newbie):
                assert (await live.http.get("/api/me", headers=headers)).json()[
                    "calibration"
                ] is None
            for account in (veteran_id, newbie_id):
                profile = (await live.http.get(f"/api/players/{account}")).json()
                assert (profile["rating"], profile["rank"], profile["calibration"]) == (
                    None,
                    None,
                    None,
                )
            board = (await live.http.get("/api/leaderboard")).json()
            assert (board["entries"], board["total"]) == ([], 0)

    asyncio.run(scenario())


# The queue map source, with a stand-in map job -----------------------------------------------


class StandIn:
    """The job of a map worker in a thread: waits for ``go``, then stores a copy of ``SOURCE``
    under the id of the job (or fails). The real job has its own tests (``test_mapgen.py``)."""

    def __init__(self) -> None:
        self.go = threading.Event()
        self.fail = False
        self.calls = 0

    def __call__(self, job: MapJob) -> MapBuilt:
        self.calls += 1
        if not self.go.wait(20):
            raise TimeoutError("the test never let the map be made")
        if self.fail:
            raise ValueError("no map passed")
        data = json.loads((GEN / f"{SOURCE}.json").read_text())
        data["meta"]["name"] = job.map_id
        vectors = json.loads((GEN / "geo" / f"{SOURCE}.json").read_text())
        vectors["map"] = job.map_id
        (job.folder / "geo").mkdir(parents=True, exist_ok=True)
        (job.folder / "geo" / f"{job.map_id}.json").write_text(json.dumps(vectors))
        for suffix in (".bg.webp", ".thumb.webp"):
            shutil.copy(GEN / f"{SOURCE}{suffix}", job.folder / f"{job.map_id}{suffix}")
        (job.folder / f"{job.map_id}.json").write_text(json.dumps(data))  # the map file last
        return MapBuilt(job.map_id, job.seeds[0], 1, 1, 29, 0.1, 0.1, 0.1, 0.1, 0.4)


@pytest.fixture
def stand_in() -> Iterator[StandIn]:
    job = StandIn()
    yield job
    job.go.set()  # nothing waits for the event when the app shuts down


@contextmanager
def queue_api(settings: Settings, clock: ManualClock, stand_in: StandIn) -> Generator[TestClient]:
    """An app whose map maker runs ``stand_in`` in threads (the queue's maker is the app's)."""
    app = create_app(settings.model_copy(update={"mapgen_enabled": True}), clock)
    with TestClient(app) as client:
        state = app.state
        maker = MapMaker(
            store_dir(settings.replays_dir),
            state.maps,
            state.ruleset,
            max_pending=2,
            wait_s=10,
            metrics=state.matches.metrics,
            job=stand_in,
            executor=ThreadPoolExecutor(2),
        )
        state.mapmaker = maker
        state.invites.maker = maker
        if state.queue.maker is not None:  # GOW_QUEUE_MAPS=generated
            state.queue.maker = maker
        yield client


def app_of(api: TestClient) -> FastAPI:
    return cast(FastAPI, api.app)


def _guest(api: TestClient, nick: str) -> Headers:
    response = api.post("/api/guest", json={"nick": nick})
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['token']}"}


def _calibrated(api: TestClient, nick: str) -> Headers:
    headers = _guest(api, nick)
    token = headers["Authorization"].removeprefix("Bearer ")
    sessions: sessionmaker[Session] = app_of(api).state.sessions
    with sessions.begin() as session:
        player = session.execute(
            select(Player).where(Player.token_hash == hash_token(token))
        ).scalar_one()
        player.password_hash = "scrypt$not-a-real-hash"
        session.add(
            Rating(player_id=player.id, rating=1500.0, rd=350.0, volatility=0.06, rated_matches=5)
        )
    return headers


def _until(check: Callable[[], bool], timeout_s: float = 10.0) -> None:
    deadline = time.monotonic() + timeout_s
    while not check():
        assert time.monotonic() < deadline, "timed out"
        time.sleep(0.02)


def _pair(api: TestClient, clock: ManualClock, first: Headers, second: Headers) -> dict[str, Any]:
    for headers in (first, second):
        assert api.post("/api/queue", headers=headers).status_code == 200
    clock.advance(1)
    assert api.get("/api/queue", headers=first).json()["state"] == "found"
    api.post("/api/queue/confirm", headers=first)
    response = api.post("/api/queue/confirm", headers=second)
    assert response.status_code == 200, response.text
    started = response.json()
    assert started["state"] == "started", started
    return started


@pytest.fixture
def clock() -> ManualClock:
    return ManualClock()


def test_generated_queue_maps_play_a_map_made_for_the_pair_unrated(
    settings: Settings, clock: ManualClock, stand_in: StandIn
) -> None:
    """Rating on (``conftest``), two calibrated accounts: the made map keeps the match unrated."""
    generated = settings.model_copy(update={"queue_maps": "generated"})
    with queue_api(generated, clock, stand_in) as api:
        alice, bob = _calibrated(api, "alice"), _calibrated(api, "bob")
        for headers in (alice, bob):
            api.post("/api/queue", headers=headers)
        clock.advance(1)
        assert api.get("/api/queue", headers=alice).json()["state"] == "found"
        _until(lambda: stand_in.calls == 1)  # requested when the pair is found
        stand_in.go.set()
        api.post("/api/queue/confirm", headers=alice)
        started = api.post("/api/queue/confirm", headers=bob).json()
        map_id = str(started["map_id"])
        assert map_id.startswith("live-")
        assert api.get(f"/api/maps/{map_id}").json()["meta"]["name"] == map_id
        sessions: sessionmaker[Session] = app_of(api).state.sessions
        with sessions() as session:
            row = session.get_one(Match, int(started["match_id"]))
            assert (row.map_id, row.rated) == (map_id, False)  # DEC-27, item 8
        manager: MatchManager = app_of(api).state.matches
        runner = manager.get(str(started["match_id"]))
        assert runner is not None and runner.private is False


def test_generated_queue_maps_fall_back_to_the_pool(
    settings: Settings, clock: ManualClock, stand_in: StandIn
) -> None:
    generated = settings.model_copy(update={"queue_maps": "generated"})
    with queue_api(generated, clock, stand_in) as api:
        stand_in.fail = True
        stand_in.go.set()
        started = _pair(api, clock, _guest(api, "alice"), _guest(api, "bob"))
        assert started["map_id"] in POOL
        manager: MatchManager = app_of(api).state.matches
        assert manager.metrics.maps_fallback == 1


def test_a_declined_pair_drops_its_map(
    settings: Settings, clock: ManualClock, stand_in: StandIn
) -> None:
    generated = settings.model_copy(update={"queue_maps": "generated"})
    with queue_api(generated, clock, stand_in) as api:
        alice, bob = _guest(api, "alice"), _guest(api, "bob")
        for headers in (alice, bob):
            api.post("/api/queue", headers=headers)
        clock.advance(1)
        api.get("/api/queue", headers=alice)
        _until(lambda: stand_in.calls == 1)
        assert api.delete("/api/queue", headers=alice).status_code == 204
        maker: MapMaker = app_of(api).state.mapmaker
        stand_in.go.set()
        store = store_dir(settings.replays_dir)
        # Made after the pair was gone: its files are removed when the job ends.
        _until(lambda: maker.pending == 0 and not list(store.glob("live-*.json")))


def test_pool_queue_maps_are_the_default(
    settings: Settings, clock: ManualClock, stand_in: StandIn
) -> None:
    with queue_api(settings, clock, stand_in) as api:  # mapgen on, queue_maps at its default
        stand_in.go.set()
        started = _pair(api, clock, _guest(api, "alice"), _guest(api, "bob"))
        assert started["map_id"] in POOL
        assert stand_in.calls == 0
