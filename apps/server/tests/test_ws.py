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
import sys
import time
from collections.abc import AsyncGenerator, Callable, Coroutine, Iterator
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
    CLOSE_REPLACED,
    PROTOCOL_VERSION,
    AckMsg,
    ClientMsg,
    CommandMsg,
    EndReason,
    ErrorMsg,
    HelloMsg,
    MatchEndMsg,
    PausedMsg,
    PauseMsg,
    PingMsg,
    PongMsg,
    ReachMsg,
    ReachQueryMsg,
    ResumeMsg,
    ResyncMsg,
    ServerMsg,
    SnapshotMsg,
    WelcomeMsg,
)
from gow_server.app import create_app
from gow_server.cli import WS_MAX_SIZE
from gow_server.clock import ManualClock
from gow_server.logs import configure_logging
from gow_server.matches import MatchManager, MatchRunner
from gow_server.settings import Settings
from gow_server.ws import CLOSE_NO_MATCH, CLOSE_POLICY
from gow_sim.commands import Forfeit
from gow_sim.replay import read_replay
from gow_sim.ruleset import Stance, load_ruleset

ROOT: Final = Path(__file__).parents[3]
DT: Final = 0.1
RECV_TIMEOUT_S: Final = 5.0
DRAIN_TIMEOUT_S: Final = 60.0
"""Wait for the next frame while a blocked client drains megabytes through a tiny socket buffer.

The server's own send timeout in that test is 60 s; on a loaded CI runner the pauses between
frames can exceed ``RECV_TIMEOUT_S`` (#188), so the drain waits as long as the server would."""


@dataclass
class Live:
    app: FastAPI
    clock: ManualClock
    host: str
    tokens: list[str]
    """Guest tokens of the two players of ``runner``, and of a third guest."""
    runner: MatchRunner
    server: Any = None

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
    settings: Settings, map_id: str = "line3", ruleset: str = "test-short", private: bool = False
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
        runner = manager.create(map_id, entry.definition, rules, players, private=private)
        yield Live(app, clock, host, [c["token"] for c in created], runner, server)
    finally:
        server.should_exit = True
        await task


def run(
    settings: Settings,
    scenario: Callable[[Live], Coroutine[None, None, None]],
    map_id: str = "line3",
    ruleset: str = "test-short",
    private: bool = False,
) -> None:
    async def main() -> None:
        async with live_server(settings, map_id, ruleset, private) as live:
            await scenario(live)

    asyncio.run(main())


async def send(ws: ClientConnection, msg: ClientMsg) -> None:
    await ws.send(encode(msg))


async def recv(ws: ClientConnection, timeout_s: float = RECV_TIMEOUT_S) -> ServerMsg:
    return decode_server(await asyncio.wait_for(ws.recv(), timeout_s))


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


@pytest.fixture
def production_logs(monkeypatch: pytest.MonkeyPatch) -> Iterator[io.StringIO]:
    """The server's logs as ``gow-server`` configures them (``configure_logging``), in a buffer."""
    stream = io.StringIO()
    monkeypatch.setattr(sys, "stderr", stream)
    root = logging.getLogger()
    saved_root = (root.level, root.handlers[:])
    names = ("uvicorn", "uvicorn.error", "uvicorn.access")
    saved = {
        name: (lg.handlers[:], lg.filters[:], lg.propagate, lg.disabled)
        for name in names
        for lg in [logging.getLogger(name)]
    }
    configure_logging("INFO")
    try:
        yield stream
    finally:
        root.setLevel(saved_root[0])
        root.handlers[:] = saved_root[1]
        for name, (handlers, filters, propagate, disabled) in saved.items():
            lg = logging.getLogger(name)
            lg.handlers[:], lg.filters[:] = handlers, filters
            lg.propagate, lg.disabled = propagate, disabled


def test_logs_have_no_client_address_and_no_query_string(
    ws_settings: Settings, production_logs: io.StringIO
) -> None:
    """#193: uvicorn's handshake lines (``<ip:port> - "WebSocket <path?query>"``) are dropped."""
    clients: list[str] = []

    async def scenario(live: Live) -> None:
        match_id = f"{live.runner.match_id}?probe=query-secret"
        async with live.connect(match_id=match_id) as ws:
            address, port = ws.local_address[:2]
            clients.append(f"{address}:{port}")
            await send(ws, hello(live.tokens[0]))
            assert isinstance(await recv(ws), WelcomeMsg)
        with pytest.raises(InvalidStatus):
            async with live.connect(match_id=match_id, origin="http://evil.example"):
                pass

    run(ws_settings, scenario)
    logs = production_logs.getvalue()
    assert "ws connected" in logs and "ws origin refused" in logs  # the logs were captured
    assert "query-secret" not in logs
    assert '"WebSocket ' not in logs
    assert clients and all(client not in logs for client in clients), "a client address in logs"


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


def test_reach_query_is_answered_by_the_server(ws_settings: Settings) -> None:
    """DEC-20, D5: the server computes where a group can go; an unknown id gets empty lists."""

    async def scenario(live: Live) -> None:
        async with live.connect() as ws:
            await send(ws, hello(live.tokens[0]))
            assert isinstance(await recv(ws), WelcomeMsg)
            snap = await recv_until(ws, SnapshotMsg)
            group = snap.view.groups[0].id
            await send(ws, ReachQueryMsg(group=group))
            reach = await recv_until(ws, ReachMsg)
            assert (reach.group, reach.tick) == (group, live.runner.match.tick)
            assert reach.nodes
            await send(ws, ReachQueryMsg(group="999"))
            unknown = await recv_until(ws, ReachMsg)
            assert (unknown.group, unknown.nodes, unknown.split) == ("999", (), ())

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


async def diag363(live: Live, ws: ClientConnection, acks: int, snaps: int) -> None:
    import subprocess

    out = [f"DIAG363 stall: acks={acks} snaps={snaps}"]
    for conn in live.server.server_state.connections:
        t = conn.transport
        out.append(
            f"server conn: writable={conn.writable.is_set()} read_paused={conn.read_paused} "
            f"wbuf={t.get_write_buffer_size()} limits={t.get_write_buffer_limits()} "
            f"closing={t.is_closing()} queue={conn.queue.qsize()} pending_ping={conn.pending_ping_payload}"
        )
    box = live.runner._outboxes.get(0)
    if box is not None:
        out.append(f"outbox backlog={box.backlog} snap={box._snapshot is not None} overflowed={box.overflowed}")
    ct = ws.transport
    out.append(
        f"client: wbuf={ct.get_write_buffer_size()} closing={ct.is_closing()} "
        f"proto_state={ws.protocol.state} queue={len(ws.recv_messages.frames.queue)} "
        f"paused={ws.recv_messages.paused}"
    )
    for task in asyncio.all_tasks():
        out.append(f"task {task.get_name()} {task.get_coro()!r} done={task.done()}")
    port = live.host.rsplit(":", 1)[1]
    out.append(subprocess.run(f"ss -tmin '( sport = :{port} or dport = :{port} )' 2>&1", shell=True, capture_output=True, text=True).stdout)
    out.append(subprocess.run("uname -r", shell=True, capture_output=True, text=True).stdout)
    out.append(subprocess.run("sysctl net.ipv4.tcp_rmem net.ipv4.tcp_wmem net.core.rmem_max net.core.wmem_max net.ipv4.tcp_moderate_rcvbuf 2>&1", shell=True, capture_output=True, text=True).stdout)
    out.append(subprocess.run("ip link show lo 2>&1 | head -2; nproc; uptime", shell=True, capture_output=True, text=True).stdout)
    print("\n".join(out), flush=True)


def test_slow_client_does_not_slow_the_tick_and_loses_no_ack(ws_settings: Settings) -> None:
    """The client does not read while 1000 ticks pass on the largest map, then reads everything.

    That is about 10 MB of snapshots: more than the kernel's socket buffers absorb (up to 4 MB
    each way with autotuning), so the server's sends do block.
    """
    ticks = 1000
    settings = ws_settings.model_copy(
        update={"ws_send_timeout_s": 60.0, "ws_msg_burst": 1000, "reconnect_window_s": 1e9}
    )  # the second player never comes: no technical defeat in this test

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
                try:
                    msg = await recv(ws, 8.0)
                except TimeoutError:
                    await diag363(live, ws, len(acks), snapshots)
                    msg = await recv(ws, DRAIN_TIMEOUT_S)
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
    settings = ws_settings.model_copy(update={"ws_send_timeout_s": 0.3, "reconnect_window_s": 1e9})

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


# Reconnect and disconnect policy (SRV-04, DEC-05) ------------------------------------------------


@pytest.fixture
def policy_settings(ws_settings: Settings, tmp_path: Path) -> Settings:
    return ws_settings.model_copy(update={"replays_dir": tmp_path / "replays"})


async def join(live: Live, player: int) -> tuple[ClientConnection, WelcomeMsg]:
    """Open a connection of ``player`` and read ``welcome``; the caller closes it."""
    ws = await live.connect()
    await send(ws, hello(live.tokens[player]))
    welcome = await recv(ws)
    assert isinstance(welcome, WelcomeMsg)
    return ws, welcome


def test_reconnect_after_10_s_restores_the_view(policy_settings: Settings) -> None:
    async def scenario(live: Live) -> None:
        a, _ = await join(live, 0)
        b, _ = await join(live, 1)
        await send(b, CommandMsg(seq=1, cmd=SetStanceCmd(stance=Stance.WAR)))
        await asyncio.sleep(0.05)  # the command reaches the server before the tick
        await live.ticks()
        await recv_until(b, AckMsg)
        await b.close()
        await asyncio.sleep(0.05)
        assert not live.runner.connected(1)
        await live.ticks(100)  # 10 s without the player: the match goes on
        assert live.runner.match.tick >= 100
        b, welcome = await join(live, 1)
        assert welcome.last_seq == 1
        snap = await recv_until(b, SnapshotMsg)
        assert snap.view.me.stance is Stance.WAR
        assert snap.tick == live.runner.match.tick
        await live.ticks(700)  # well past 60 s after the first drop: no technical defeat
        assert not live.runner.finished
        await a.close()
        await b.close()

    run(policy_settings, scenario, ruleset="mvp-0")


def test_reconnect_after_61_s_is_a_technical_defeat_in_the_command_log(
    policy_settings: Settings,
) -> None:
    async def scenario(live: Live) -> None:
        a, _ = await join(live, 0)
        b, _ = await join(live, 1)
        await b.close()
        await asyncio.sleep(0.05)
        await live.ticks(590)  # 59 s: the window is still open
        assert not live.runner.finished
        await live.ticks(20)  # 61 s
        end = await recv_until(a, MatchEndMsg)
        assert (end.reason, end.winner) == (EndReason.DISCONNECT, 0)
        assert await close_code(a) == 1000
        # too late to come back: the match is over
        late = await live.connect()
        await send(late, hello(live.tokens[1]))
        assert await close_code(late) == CLOSE_NO_MATCH
        log = read_replay(policy_settings.replays_dir / f"{live.runner.match_id}.jsonl.gz")
        forfeits = [(t, c.player) for t, c in log.commands if isinstance(c.cmd, Forfeit)]
        assert [p for _, p in forfeits] == [1], (
            "the technical defeat is a Forfeit of the gone player"
        )
        assert log.final

    run(policy_settings, scenario, ruleset="mvp-0")


def test_a_connection_that_replaces_another_does_not_start_a_window(
    policy_settings: Settings,
) -> None:
    async def scenario(live: Live) -> None:
        a, _ = await join(live, 0)
        old, _ = await join(live, 1)
        new, _ = await join(live, 1)  # a second tab
        assert await close_code(old) == CLOSE_REPLACED
        await live.ticks(700)
        assert not live.runner.finished
        await a.close()
        await new.close()

    run(policy_settings, scenario, ruleset="mvp-0")


def test_pause_in_a_private_match(policy_settings: Settings) -> None:
    async def scenario(live: Live) -> None:
        a, _ = await join(live, 0)
        b, _ = await join(live, 1)
        await send(a, PauseMsg())
        for ws in (a, b):
            msg = await recv_until(ws, PausedMsg)
            assert (msg.paused, msg.by, msg.ends_in_s) == (True, 0, 60)
        tick = live.runner.match.tick
        await live.ticks(50)
        assert live.runner.match.tick == tick
        await send(b, ResumeMsg())  # not their pause
        assert (await recv_until(b, ErrorMsg)).code == "PAUSE_DENIED"
        await send(a, ResumeMsg())
        for ws in (a, b):
            assert not (await recv_until(ws, PausedMsg)).paused
        await live.ticks(3)
        assert live.runner.match.tick > tick
        await send(a, PauseMsg())  # one pause per player
        assert (await recv_until(a, ErrorMsg)).code == "PAUSE_DENIED"
        await a.close()
        await b.close()

    run(policy_settings, scenario, ruleset="mvp-0", private=True)


def test_rated_match_refuses_a_pause(policy_settings: Settings) -> None:
    async def scenario(live: Live) -> None:
        a, _ = await join(live, 0)
        await send(a, PauseMsg())
        assert (await recv_until(a, ErrorMsg)).code == "PAUSE_DENIED"
        assert not live.runner.paused
        await a.close()

    run(policy_settings, scenario, ruleset="mvp-0")
