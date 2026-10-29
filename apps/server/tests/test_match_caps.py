"""#412: caps on running matches (503), and a bot match nobody connects to is dropped.

Expected behaviour comes from issue #412 (a global cap, a lower cap for bot matches, 503 when
full with a metric and a log line, a bot match without a WebSocket aborted as never started with
no replay), not from the output of the code.
"""

import asyncio
import logging
import shutil
from collections.abc import AsyncGenerator, Callable, Iterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Final, cast

import httpx2
import pytest
import uvicorn
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
from websockets.asyncio.client import connect
from websockets.typing import Origin

from gow_protocol.codec import decode_server, encode
from gow_protocol.messages import PROTOCOL_VERSION, HelloMsg, WelcomeMsg
from gow_server.app import create_app
from gow_server.cli import WS_MAX_SIZE
from gow_server.clock import ManualClock
from gow_server.identity import hash_token
from gow_server.matches import MatchManager
from gow_server.models import Match, Player, Rating
from gow_server.settings import Settings

ROOT: Final = Path(__file__).parents[3]
Headers = dict[str, str]
Json = dict[str, object]


@pytest.fixture
def web_settings(maps_dir: Path, tmp_path: Path) -> Settings:
    shutil.copy(ROOT / "maps" / "fixtures" / "web.json", maps_dir)
    return Settings(
        maps_dir=maps_dir,
        database_url=f"sqlite:///{tmp_path / 'gow.db'}",
        replays_dir=tmp_path / "replays",
        rulesets_dir=ROOT / "rulesets" / "archive",
        ruleset_path=ROOT / "rulesets" / "test-short.toml",
        bot_budget_s=60.0,  # real-time budget of a bot decision: not what is tested here
    )


# Caps over HTTP (TestClient: nothing here needs the match clock to move) ------------------------


@pytest.fixture
def capped(web_settings: Settings) -> Iterator[Callable[..., TestClient]]:
    """``capped(max_matches=2, ...)``: a client of a server with those settings (closed at exit)."""
    opened: list[TestClient] = []

    def make(**caps: int) -> TestClient:
        app = create_app(web_settings.model_copy(update=caps), ManualClock())
        client = TestClient(app, client=("127.0.0.1", 50000))  # /internal/metrics: loopback only
        client.__enter__()
        opened.append(client)
        return client

    yield make
    for client in opened:
        client.__exit__(None, None, None)


def guest(api: TestClient, nick: str) -> Headers:
    token = api.post("/api/guest", json={"nick": nick}).json()["token"]
    return {"Authorization": f"Bearer {token}"}


def manager_of(api: TestClient) -> MatchManager:
    manager = api.app.state.matches  # type: ignore[attr-defined]
    assert isinstance(manager, MatchManager)
    return manager


def sessions_of(api: TestClient) -> "sessionmaker[Session]":
    return cast("sessionmaker[Session]", api.app.state.sessions)  # type: ignore[attr-defined]


def account(api: TestClient, nick: str) -> Headers:
    """A calibrated password account (DEC-34): the only kind that may join the rated queue."""
    headers = guest(api, nick)
    token = headers["Authorization"].removeprefix("Bearer ")
    with sessions_of(api).begin() as session:
        player = session.execute(
            select(Player).where(Player.token_hash == hash_token(token))
        ).scalar_one()
        player.password_hash = "scrypt$not-a-real-hash"
        session.add(
            Rating(player_id=player.id, rating=1500.0, rd=350.0, volatility=0.06, rated_matches=5)
        )
    return headers


def start_bot(api: TestClient, headers: Headers) -> httpx2.Response:
    return api.post("/api/bot-matches", json={"level": "easy", "map_id": "web"}, headers=headers)


def match_rows(api: TestClient) -> list[Match]:
    with sessions_of(api)() as session:
        return list(session.execute(select(Match)).scalars())


def test_bot_matches_are_refused_past_the_global_cap(
    capped: Callable[..., TestClient], caplog: pytest.LogCaptureFixture
) -> None:
    api = capped(max_matches=2, max_bot_matches=2)
    alice, bob, carol = guest(api, "alice"), guest(api, "bob"), guest(api, "carol")
    assert start_bot(api, alice).status_code == 201
    assert start_bot(api, bob).status_code == 201
    with caplog.at_level(logging.WARNING, logger="gow_server.matches"):
        full = start_bot(api, carol)
    assert full.status_code == 503
    assert full.headers["Retry-After"] == "15"
    assert full.json() == {"detail": "server is full, try again in a moment"}
    assert manager_of(api).active == 2
    assert len(match_rows(api)) == 2, "a refused match leaves no row"
    # the refusal claimed nothing: carol can still open an invite
    assert api.post("/api/matches", json={}, headers=carol).status_code == 201
    assert any(
        "server full" in r.getMessage() and r.__dict__["cap"] == "matches_full"
        for r in caplog.records
    )
    metrics = api.get("/internal/metrics").text
    assert "gow_matches_refused_full_total 1" in metrics
    assert "gow_matches_refused_bot_full_total 0" in metrics
    assert "gow_matches_bot_active 2" in metrics


def test_bot_matches_have_a_lower_cap_and_do_not_block_human_matches(
    capped: Callable[..., TestClient],
) -> None:
    api = capped(max_matches=5, max_bot_matches=1)
    alice, bob, carol = guest(api, "alice"), guest(api, "bob"), guest(api, "carol")
    assert start_bot(api, alice).status_code == 201
    assert start_bot(api, bob).status_code == 503  # the bot cap, far below the global one
    assert manager_of(api).active == 1
    assert "gow_matches_refused_bot_full_total 1" in api.get("/internal/metrics").text
    # bob and carol still play each other
    code = api.post("/api/matches", json={}, headers=bob).json()["code"]
    assert api.post(f"/api/matches/{code}/join", headers=carol).status_code == 200
    assert api.post(f"/api/matches/{code}/ready", headers=bob).status_code == 200
    started = api.post(f"/api/matches/{code}/ready", headers=carol)
    assert started.status_code == 200 and started.json()["state"] == "started"
    assert manager_of(api).active == 2


def test_zero_bot_cap_turns_bot_matches_off(capped: Callable[..., TestClient]) -> None:
    api = capped(max_bot_matches=0)
    assert start_bot(api, guest(api, "alice")).status_code == 503
    assert manager_of(api).active == 0


def test_invite_ready_is_refused_when_full_and_can_be_retried(
    capped: Callable[..., TestClient],
) -> None:
    api = capped(max_matches=1)
    alice, bob, carol = guest(api, "alice"), guest(api, "bob"), guest(api, "carol")
    assert start_bot(api, alice).status_code == 201
    code = api.post("/api/matches", json={}, headers=bob).json()["code"]
    api.post(f"/api/matches/{code}/join", headers=carol)
    api.post(f"/api/matches/{code}/ready", headers=bob)
    refused = api.post(f"/api/matches/{code}/ready", headers=carol)
    assert refused.status_code == 503
    assert refused.headers["Retry-After"] == "15"
    state = api.get(f"/api/matches/{code}", headers=bob).json()
    assert (state["state"], state["match_id"], state["you_ready"]) == ("joined", None, True)
    assert manager_of(api).active == 1


def test_queue_confirm_is_refused_when_full_and_the_pair_leaves_the_queue(
    capped: Callable[..., TestClient],
) -> None:
    api = capped(max_matches=1)
    carol = guest(api, "carol")
    assert start_bot(api, carol).status_code == 201
    alice, bob = account(api, "alice"), account(api, "bob")
    api.post("/api/queue", headers=alice)
    api.post("/api/queue", headers=bob)
    clock = cast("ManualClock", manager_of(api).clock)
    clock.advance(1)
    assert api.get("/api/queue", headers=alice).json()["state"] == "found"
    api.post("/api/queue/confirm", headers=alice)
    refused = api.post("/api/queue/confirm", headers=bob)
    assert refused.status_code == 503
    assert api.get("/api/queue", headers=alice).status_code == 404
    assert api.get("/api/queue", headers=bob).status_code == 404
    assert len(match_rows(api)) == 1, "only carol's bot match has a row"


# A bot match nobody connects to -----------------------------------------------------------------

TIMEOUT_S: Final = 5.0


@dataclass
class Live:
    app: FastAPI
    clock: ManualClock
    http: httpx2.AsyncClient
    host: str
    headers: Headers
    token: str

    @property
    def manager(self) -> MatchManager:
        manager = self.app.state.matches
        assert isinstance(manager, MatchManager)
        return manager

    async def start_bot(self) -> httpx2.Response:
        body = {"level": "easy", "map_id": "web"}
        return await self.http.post("/api/bot-matches", json=body, headers=self.headers)

    async def advance(self, seconds: float, step: float = 1.0) -> None:
        """Move match time in steps, letting the loops run between them."""
        for _ in range(round(seconds / step)):
            self.clock.advance(step)
            await asyncio.sleep(0.005)


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
            made = (await http.post("/api/guest", json={"nick": "solo"})).json()
            headers = {"Authorization": f"Bearer {made['token']}"}
            yield Live(app, clock, http, host, headers, made["token"])
    finally:
        server.should_exit = True
        await task


def row_of(live: Live, match_id: str) -> Match:
    sessions = cast("sessionmaker[Session]", live.app.state.sessions)
    with sessions() as session:
        match = session.get(Match, int(match_id))
        assert match is not None
        return match


def test_a_bot_match_nobody_connects_to_is_dropped_as_never_started(
    web_settings: Settings,
) -> None:
    async def scenario() -> None:
        async with live_server(
            web_settings.model_copy(update={"bot_connect_timeout_s": 15.0})
        ) as live:
            created = await live.start_bot()
            assert created.status_code == 201, created.text
            match_id = created.json()["match_id"]
            assert (await live.start_bot()).status_code == 409  # still running: the account is busy

            await live.advance(14)
            assert live.manager.active == 1, "the window has not run out yet"
            assert list(web_settings.replays_dir.glob(f"{match_id}.*")), "the log is being written"
            await live.advance(3)
            assert live.manager.active == 0
            await asyncio.sleep(0.1)  # the result is written in a thread

            row = row_of(live, match_id)
            assert (row.status, row.end_reason) == ("aborted", "never_started")
            replays = web_settings.replays_dir
            assert not list(replays.glob(f"{match_id}.*")), "no command log, no frames"
            assert (
                "gow_matches_never_started_total 1"
                in (await live.http.get("/internal/metrics")).text
            )
            # the player is free again
            assert (await live.start_bot()).status_code == 201

    asyncio.run(scenario())


def test_a_connected_bot_match_is_not_dropped(web_settings: Settings) -> None:
    async def scenario() -> None:
        async with live_server(
            web_settings.model_copy(update={"bot_connect_timeout_s": 15.0})
        ) as live:
            created = await live.start_bot()
            match_id = created.json()["match_id"]
            socket = connect(
                f"ws://{live.host}/ws/match/{match_id}",
                origin=Origin(f"http://{live.host}"),
                open_timeout=TIMEOUT_S,
                compression=None,
            )
            async with socket as ws:
                await ws.send(encode(HelloMsg(protocol_version=PROTOCOL_VERSION, token=live.token)))
                welcome = decode_server(await asyncio.wait_for(ws.recv(), TIMEOUT_S))
                assert isinstance(welcome, WelcomeMsg)
                await live.advance(20)  # well past the window
                assert live.manager.active == 1
                assert live.manager.metrics.matches_never_started == 0

    asyncio.run(scenario())


def test_the_connect_window_comes_from_the_settings(web_settings: Settings) -> None:
    async def scenario() -> None:
        async with live_server(
            web_settings.model_copy(update={"bot_connect_timeout_s": 3.0})
        ) as live:
            await live.start_bot()
            await live.advance(2)
            assert live.manager.active == 1
            await live.advance(2)
            assert live.manager.active == 0

    asyncio.run(scenario())
