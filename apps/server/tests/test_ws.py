"""SRV-03: the match WebSocket, through a real uvicorn server and a ``websockets`` client.

The server runs in the test's event loop on a free port, with a ``ManualClock``: the test moves
match time itself, the network is real.
"""

import asyncio
import io
import json
import logging
import shutil
import socket
import time
from collections.abc import AsyncGenerator, Callable, Coroutine
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

import httpx2
import pytest
import uvicorn
from fastapi import FastAPI
from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import ConnectionClosed, InvalidStatus
from websockets.typing import Origin

from gow_protocol.codec import decode_server, encode
from gow_protocol.commands import ForfeitCmd, SetStanceCmd
from gow_protocol.messages import (
    CLOSE_PROTOCOL_VERSION,
    PROTOCOL_VERSION,
    AckMsg,
    ClientMsg,
    CommandMsg,
    ErrorMsg,
    HelloMsg,
    MatchEndMsg,
    PingMsg,
    PongMsg,
    ResyncMsg,
    ServerMsg,
    SnapshotMsg,
    WelcomeMsg,
)
from gow_server.app import create_app
from gow_server.cli import WS_MAX_SIZE
from gow_server.clock import ManualClock
from gow_server.matches import MatchManager, MatchRunner
from gow_server.settings import Settings
from gow_server.ws import CLOSE_NO_MATCH, CLOSE_POLICY, CLOSE_REPLACED
from gow_sim.ruleset import Stance, load_ruleset

ROOT: Final = Path(__file__).parents[3]
DT: Final = 0.1
RECV_TIMEOUT_S: Final = 5.0


@dataclass
class Live:
    app: FastAPI
    clock: ManualClock
    host: str
    tokens: list[str]
    """Guest tokens of the two players of ``runner``, and of a third guest."""
    runner: MatchRunner

    @property
    def manager(self) -> MatchManager:
        manager = self.app.state.matches
        assert isinstance(manager, MatchManager)
        return manager

    def url(self, match_id: str | None = None) -> str:
        return f"ws://{self.host}/ws/match/{match_id or self.runner.match_id}"

    def connect(self, *, origin: str | None = "", **kwargs: Any) -> connect:
        own = Origin(f"http://{self.host}")
        return connect(
            self.url(kwargs.pop("match_id", None)),
            origin=own if origin == "" else (Origin(origin) if origin else None),
            open_timeout=RECV_TIMEOUT_S,
            close_timeout=0.5,
            compression=None,  # uncompressed frames: the slow-client tests fill socket buffers
            **kwargs,
        )

    async def ticks(self, n: int = 1, pause_s: float = 0.002) -> None:
        for _ in range(n):
            self.clock.advance(DT)
            await asyncio.sleep(pause_s)


@asynccontextmanager
async def live_server(
    settings: Settings, map_id: str = "line3", ruleset: str = "test-short"
) -> AsyncGenerator[Live]:
    clock = ManualClock()
    app = create_app(settings, clock)
    config = uvicorn.Config(
        app, host="127.0.0.1", port=0, log_config=None, ws_max_size=WS_MAX_SIZE, lifespan="on"
    )
    server = uvicorn.Server(config)
    task = asyncio.create_task(server.serve())
    while not server.started:
        await asyncio.sleep(0.01)
    port = server.servers[0].sockets[0].getsockname()[1]
    host = f"127.0.0.1:{port}"
    try:
        async with httpx2.AsyncClient(base_url=f"http://{host}") as http:
            created = [
                (await http.post("/api/guest", json={"nick": f"player{i}"})).json()
                for i in range(3)
            ]
        manager = app.state.matches
        assert isinstance(manager, MatchManager)
        entry = app.state.maps.get(map_id)
        rules = load_ruleset(ROOT / "rulesets" / f"{ruleset}.toml")
        players = (created[0]["player_id"], created[1]["player_id"])
        runner = manager.create(map_id, entry.definition, rules, players)
        yield Live(app, clock, host, [c["token"] for c in created], runner)
    finally:
        server.should_exit = True
        await task


def run(
    settings: Settings,
    scenario: Callable[[Live], Coroutine[None, None, None]],
    map_id: str = "line3",
    ruleset: str = "test-short",
) -> None:
    async def main() -> None:
        async with live_server(settings, map_id, ruleset) as live:
            await scenario(live)

    asyncio.run(main())


async def send(ws: ClientConnection, msg: ClientMsg) -> None:
    await ws.send(encode(msg))


async def recv(ws: ClientConnection) -> ServerMsg:
    return decode_server(await asyncio.wait_for(ws.recv(), RECV_TIMEOUT_S))


async def recv_until[T: ServerMsg](ws: ClientConnection, kind: type[T]) -> T:
    while True:
        msg = await recv(ws)
        if isinstance(msg, kind):
            return msg


async def close_code(ws: ClientConnection) -> int | None:
    """Read until the server closes; the close code it sent."""
    with pytest.raises(ConnectionClosed) as info:
        while True:
            await asyncio.wait_for(ws.recv(), RECV_TIMEOUT_S)
    return info.value.rcvd.code if info.value.rcvd else None


def small_socket(host: str) -> socket.socket:
    """A connected client socket with a small receive buffer."""
    address, port = host.rsplit(":", 1)
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 65536)
    sock.connect((address, int(port)))
    sock.setblocking(False)
    return sock


def hello(token: str, version: int = PROTOCOL_VERSION) -> HelloMsg:
    return HelloMsg(protocol_version=version, token=token)


@pytest.fixture
def ws_settings(maps_dir: Path, tmp_path: Path) -> Settings:
    shutil.copy(ROOT / "maps" / "pautina.json", maps_dir)
    return Settings(
        maps_dir=maps_dir,
        database_url=f"sqlite:///{tmp_path / 'gow.db'}",
        ws_hello_timeout_s=0.3,
    )


# Handshake -----------------------------------------------------------------------------------


def test_wrong_or_missing_origin_is_refused(ws_settings: Settings) -> None:
    async def scenario(live: Live) -> None:
        for origin in ("http://evil.example", "http://127.0.0.1:1", None):
            with pytest.raises(InvalidStatus) as info:
                async with live.connect(origin=origin):
                    pass
            assert info.value.response.status_code == 403

    run(ws_settings, scenario)


def test_allowed_origin_from_settings(ws_settings: Settings) -> None:
    settings = ws_settings.model_copy(update={"ws_allowed_origins": ("http://localhost:5173",)})

    async def scenario(live: Live) -> None:
        async with live.connect(origin="http://localhost:5173") as ws:
            await send(ws, hello(live.tokens[0]))
            assert isinstance(await recv(ws), WelcomeMsg)

    run(settings, scenario)


def test_no_hello_closes(ws_settings: Settings) -> None:
    async def scenario(live: Live) -> None:
        async with live.connect() as ws:
            assert await close_code(ws) == CLOSE_POLICY

    run(ws_settings, scenario)


def test_first_message_must_be_hello(ws_settings: Settings) -> None:
    async def scenario(live: Live) -> None:
        async with live.connect() as ws:
            await send(ws, PingMsg(id=1))
            assert await close_code(ws) == CLOSE_POLICY

    run(ws_settings, scenario)


def test_old_protocol_version_closes_with_4001(ws_settings: Settings) -> None:
    async def scenario(live: Live) -> None:
        async with live.connect() as ws:
            await send(ws, hello(live.tokens[0], version=PROTOCOL_VERSION - 1))
            assert await close_code(ws) == CLOSE_PROTOCOL_VERSION
        # an old client whose hello no longer validates at all
        async with live.connect() as ws:
            await ws.send(json.dumps({"type": "hello", "protocol_version": 1, "auth": "x"}))
            assert await close_code(ws) == CLOSE_PROTOCOL_VERSION

    run(ws_settings, scenario)


def test_unknown_token_or_foreign_match_is_refused(
    ws_settings: Settings, json_logs: io.StringIO
) -> None:
    used: list[str] = []

    async def scenario(live: Live) -> None:
        cases = [
            ("A" * 43, None),  # unknown token
            (live.tokens[2], None),  # a guest who does not play this match
            (live.tokens[0], "no-such-match"),
        ]
        for token, match_id in cases:
            used.append(token)
            async with live.connect(match_id=match_id) as ws:
                await send(ws, hello(token))
                assert await close_code(ws) == CLOSE_NO_MATCH

    run(ws_settings, scenario)
    logs = json_logs.getvalue()
    assert "ws closed" in logs or "match_id" in logs
    assert all(token not in logs for token in used), "a token reached the logs"


# Match ---------------------------------------------------------------------------------------


def test_welcome_snapshot_ack_ping_resync_and_seq_dedup(ws_settings: Settings) -> None:
    async def scenario(live: Live) -> None:
        async with live.connect() as ws:
            await send(ws, hello(live.tokens[1]))
            welcome = await recv(ws)
            assert isinstance(welcome, WelcomeMsg)
            assert (welcome.player, welcome.map_id, welcome.last_seq) == (1, "line3", 0)
            first = await recv(ws)
            assert isinstance(first, SnapshotMsg)

            cmd = CommandMsg(seq=1, cmd=SetStanceCmd(stance=Stance.WAR))
            await send(ws, cmd)
            await send(ws, cmd)  # a resend of the same seq
            await send(ws, PingMsg(id=7))
            assert await recv_until(ws, PongMsg) == PongMsg(id=7)
            await live.ticks()
            ack = await recv_until(ws, AckMsg)
            assert (ack.seq, ack.reject_code) == (1, None)
            assert ack.applied_tick == live.runner.match.tick
            snap = await recv_until(ws, SnapshotMsg)
            assert snap.view.me.stance is Stance.WAR
            await send(ws, ResyncMsg())
            again = await recv_until(ws, SnapshotMsg)
            assert again.tick == live.runner.match.tick
            await live.ticks(3)
            await send(ws, PingMsg(id=8))
            rest: list[ServerMsg] = []
            while not isinstance(msg := await recv(ws), PongMsg):
                rest.append(msg)
            assert not [m for m in rest if isinstance(m, AckMsg)], "the repeated seq got no ack"

        # a reconnect gets last_seq
        async with live.connect() as ws:
            await send(ws, hello(live.tokens[1]))
            welcome = await recv(ws)
            assert isinstance(welcome, WelcomeMsg) and welcome.last_seq == 1

    run(ws_settings, scenario)


def test_bad_message_gets_error_and_connection_stays(ws_settings: Settings) -> None:
    async def scenario(live: Live) -> None:
        async with live.connect() as ws:
            await send(ws, hello(live.tokens[0]))
            await recv_until(ws, SnapshotMsg)
            await ws.send('{"type": "command", "seq": 0, "cmd": {"type": "nope"}}')
            err = await recv_until(ws, ErrorMsg)
            assert err.code == "BAD_MESSAGE"
            assert err.message is None
            await send(ws, PingMsg(id=1))
            assert await recv_until(ws, PongMsg) == PongMsg(id=1)

    run(ws_settings, scenario)


def test_flood_disconnects(ws_settings: Settings) -> None:
    settings = ws_settings.model_copy(update={"ws_msg_burst": 5, "ws_msg_rate": 1.0})

    async def scenario(live: Live) -> None:
        async with live.connect() as ws:
            await send(ws, hello(live.tokens[0]))
            await recv_until(ws, SnapshotMsg)
            for i in range(20):
                await send(ws, PingMsg(id=i))
            err = await recv_until(ws, ErrorMsg)
            assert err.code == "RATE_LIMITED"
            assert await close_code(ws) == CLOSE_POLICY

    run(settings, scenario)


def test_new_connection_replaces_old(ws_settings: Settings) -> None:
    async def scenario(live: Live) -> None:
        async with live.connect() as old:
            await send(old, hello(live.tokens[0]))
            await recv_until(old, SnapshotMsg)
            async with live.connect() as new:
                await send(new, hello(live.tokens[0]))
                await recv_until(new, SnapshotMsg)
                assert await close_code(old) == CLOSE_REPLACED

    run(ws_settings, scenario)


def test_match_end_reaches_both_and_closes_normally(ws_settings: Settings) -> None:
    async def scenario(live: Live) -> None:
        async with live.connect() as a, live.connect() as b:
            for ws, token in ((a, live.tokens[0]), (b, live.tokens[1])):
                await send(ws, hello(token))
                await recv_until(ws, SnapshotMsg)
            await send(b, CommandMsg(seq=1, cmd=ForfeitCmd()))
            await asyncio.sleep(0.05)
            await live.ticks()
            for ws in (a, b):
                end = await recv_until(ws, MatchEndMsg)
                assert end.winner == 0
                assert await close_code(ws) == 1000
            assert live.manager.get(live.runner.match_id) is None

    run(ws_settings, scenario)


# Slow clients ----------------------------------------------------------------------------------


def test_slow_client_does_not_slow_the_tick_and_loses_no_ack(ws_settings: Settings) -> None:
    """The client does not read while 1000 ticks pass on the largest map, then reads everything.

    That is about 10 MB of snapshots: more than the kernel's socket buffers absorb (up to 4 MB
    each way with autotuning), so the server's sends do block.
    """
    ticks = 1000
    settings = ws_settings.model_copy(update={"ws_send_timeout_s": 60.0, "ws_msg_burst": 1000})

    async def scenario(live: Live) -> None:
        # A tiny receive buffer and max_queue=1: the client buffers almost nothing, so TCP pushes
        # back on the server's sends after a few frames.
        async with live.connect(max_queue=1, sock=small_socket(live.host)) as ws:
            await send(ws, hello(live.tokens[0]))
            start = live.runner.match.tick
            for seq in range(1, ticks + 1):
                stance = Stance.WAR if seq % 2 else Stance.ECONOMY
                await send(ws, CommandMsg(seq=seq, cmd=SetStanceCmd(stance=stance)))
                await live.ticks(pause_s=0)
            await asyncio.sleep(0.05)  # the last command reaches the server, then one more tick
            await live.ticks()
            assert live.runner.match.tick == start + ticks + 1, "the tick did not wait"
            acks: list[int] = []
            snapshots = 0
            while len(acks) < ticks:
                msg = await recv(ws)
                if isinstance(msg, AckMsg):
                    acks.append(msg.seq)
                elif isinstance(msg, SnapshotMsg):
                    snapshots += 1
            assert acks == list(range(1, ticks + 1))
            assert snapshots < ticks, "stale snapshots were skipped"

    run(settings, scenario, map_id="pautina", ruleset="mvp-0")


def test_client_that_does_not_read_is_disconnected(
    ws_settings: Settings, caplog: pytest.LogCaptureFixture
) -> None:
    """Snapshots pile up beyond the socket buffers; a send then times out: disconnect."""
    settings = ws_settings.model_copy(update={"ws_send_timeout_s": 0.3})

    def closed() -> list[logging.LogRecord]:
        return [r for r in caplog.records if r.getMessage() == "ws closed"]

    async def scenario(live: Live) -> None:
        async with live.connect(max_queue=1, sock=small_socket(live.host)) as ws:
            await send(ws, hello(live.tokens[0]))
            deadline = time.monotonic() + 60
            while not closed() and time.monotonic() < deadline:
                await live.ticks(pause_s=0.001)
            assert closed(), f"the server never gave up on the client ({live.runner.match.tick})"
            assert not live.runner.finished
            tick = live.runner.match.tick
            await live.ticks(5)
            assert live.runner.match.tick == tick + 5, "the match goes on without the client"

    with caplog.at_level(logging.INFO, logger="gow_server.ws"):
        run(settings, scenario, map_id="pautina", ruleset="mvp-0")
    assert [r.__dict__["code"] for r in closed()] == [CLOSE_POLICY]
