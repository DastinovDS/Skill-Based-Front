"""SRV-08: two scripted clients play a whole match by invite, over a real server and WebSocket.

Invite (``POST /api/matches``, ``join``, ``ready``) -> ``match_id`` -> two ``websockets`` clients
play ``test-short`` to its end with a ``ManualClock``. Checks (M3 exit criterion):

- no client ever gets an entity of a node it does not see (views carry only own entities, and
  those stand on ``EXACT`` nodes; fog and presence nodes carry no numbers);
- a player who reconnects in the middle gets the same view as the server has (``last_seq`` too);
- the final hash and outcome equal a headless re-simulation of the same commands (the command
  log of the match), and the replay file replays without a divergence.
"""

import asyncio
import random
import shutil
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import httpx2
import uvicorn
from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import ConnectionClosed
from websockets.typing import Origin

from gow_protocol import commands as wire
from gow_protocol.codec import decode_server, encode
from gow_protocol.convert import match_end_msg
from gow_protocol.messages import (
    PROTOCOL_VERSION,
    CommandMsg,
    HelloMsg,
    MatchEndMsg,
    SnapshotMsg,
    WelcomeMsg,
)
from gow_protocol.view import AtNodeLoc
from gow_server.app import create_app
from gow_server.cli import WS_MAX_SIZE
from gow_server.clock import ManualClock
from gow_server.matches import MatchManager, MatchRunner
from gow_server.settings import Settings
from gow_sim.maps import load_map
from gow_sim.match import Match
from gow_sim.replay import read_replay, replay_match, replay_run
from gow_sim.state import Detail

ROOT: Final = Path(__file__).parents[3]
DT: Final = 0.1
RECV_TIMEOUT_S: Final = 5.0
MAP_ID: Final = "web"


class Client:
    """A scripted client: every 25 ticks each idle group goes to a random neighbour node.

    The pace is slow on purpose: the server drops a connection that sends more than 20 messages
    a second or does not keep up reading.
    """

    def __init__(self, token: str, neighbours: dict[int, list[int]], seed: int) -> None:
        self.token = token
        self.neighbours = neighbours
        self.rng = random.Random(seed)
        self.seq = 0
        self.player = -1
        self.match_id = ""
        self.code: int | None = None
        self.snapshots = 0
        self.moves = 0
        self.end: MatchEndMsg | None = None

    async def open(self, host: str) -> tuple[ClientConnection, WelcomeMsg]:
        ws = await connect(
            f"ws://{host}/ws/match/{self.match_id}",
            origin=Origin(f"http://{host}"),
            open_timeout=RECV_TIMEOUT_S,
            close_timeout=0.5,
        )
        await ws.send(encode(HelloMsg(protocol_version=PROTOCOL_VERSION, token=self.token)))
        welcome = decode_server(await asyncio.wait_for(ws.recv(), RECV_TIMEOUT_S))
        assert isinstance(welcome, WelcomeMsg)
        self.player = welcome.player
        return ws, welcome

    async def play(self, ws: ClientConnection) -> None:
        try:
            async for raw in ws:
                msg = decode_server(raw)
                if isinstance(msg, SnapshotMsg):
                    self.snapshots += 1
                    check_only_visible(msg)
                    if msg.tick % 25 == 0:
                        await self.react(ws, msg)
                elif isinstance(msg, MatchEndMsg):
                    self.end = msg
        except ConnectionClosed:
            pass
        self.code = ws.close_code

    async def react(self, ws: ClientConnection, snapshot: SnapshotMsg) -> None:
        for group in snapshot.view.groups:
            if group.order is None and isinstance(group.location, AtNodeLoc):
                dest = self.rng.choice(self.neighbours[group.location.node])
                self.seq += 1
                self.moves += 1
                cmd = wire.MoveCmd(group=group.id, dest=dest, planned=False)
                await ws.send(encode(CommandMsg(seq=self.seq, cmd=cmd)))


def check_only_visible(snapshot: SnapshotMsg) -> None:
    """The view holds nothing from a node the player does not see."""
    view = snapshot.view
    for node in view.nodes:
        if node.detail is not Detail.EXACT:
            assert node.warehouse is None  # no numbers outside EXACT nodes
        if node.detail in (Detail.RANGE, Detail.PRESENCE):
            assert node.seen is not None
            assert node.seen.enemy_units is None  # numbers only at EXACT (DEC-21, item 3)
        if node.detail is Detail.FOG and node.seen is not None:
            assert node.seen.tick < snapshot.tick  # an old memory, not a current sighting
    for group in view.groups:  # own groups only, and they stand on seen nodes
        if isinstance(group.location, AtNodeLoc):
            assert view.nodes[group.location.node].detail is Detail.EXACT
    for edge in view.edges:  # DEC-21, item 5: halves of edges; DEC-33: figures only in sight
        for half in edge.halves:
            if half.detail is Detail.FOG and half.seen is not None:
                assert half.seen.tick < snapshot.tick
        visible = {half.detail for half in edge.halves if half.detail is not Detail.FOG}
        for figure in edge.enemy_groups:
            assert figure.detail in visible  # a half in fog shows no figure


@dataclass
class Live:
    app_manager: MatchManager
    clock: ManualClock
    host: str
    http: httpx2.AsyncClient


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
    manager = app.state.matches
    assert isinstance(manager, MatchManager)
    try:
        async with httpx2.AsyncClient(base_url=f"http://{host}") as http:
            yield Live(manager, clock, host, http)
    finally:
        server.should_exit = True
        await task


async def invite_to_match(live: Live) -> tuple[str, str, str]:
    """Host and guest play the invite flow; returns ``match_id`` and the two tokens."""
    tokens = [
        (await live.http.post("/api/guest", json={"nick": nick})).json()["token"]
        for nick in ("alice", "bob")
    ]
    alice, bob = ({"Authorization": f"Bearer {t}"} for t in tokens)
    created = await live.http.post("/api/matches", json={"map_id": MAP_ID}, headers=alice)
    assert created.status_code == 201, created.text
    code = created.json()["code"]
    for headers, action in ((bob, "join"), (alice, "ready"), (bob, "ready")):
        response = await live.http.post(f"/api/matches/{code}/{action}", headers=headers)
        assert response.status_code == 200, response.text
    match_id = response.json()["match_id"]
    assert response.json()["state"] == "started"
    return match_id, tokens[0], tokens[1]


def test_two_clients_play_a_match_by_invite(maps_dir: Path, tmp_path: Path) -> None:
    shutil.copy(ROOT / "maps" / "web.json", maps_dir)
    settings = Settings(
        maps_dir=maps_dir,
        database_url=f"sqlite:///{tmp_path / 'gow.db'}",
        ruleset_path=ROOT / "rulesets" / "test-short.toml",
        replays_dir=tmp_path / "replays",
        rulesets_dir=ROOT / "rulesets" / "archive",
    )
    mapdef = load_map(ROOT / "maps" / "web.json")
    neighbours: dict[int, list[int]] = {}
    for edge in mapdef.edges:
        neighbours.setdefault(edge.a, []).append(edge.b)
        neighbours.setdefault(edge.b, []).append(edge.a)

    async def scenario() -> tuple[MatchRunner, list[Client], str]:
        async with live_server(settings) as live:
            match_id, token_a, token_b = await invite_to_match(live)
            runner = live.app_manager.get(match_id)
            assert runner is not None
            clients = [Client(token_a, neighbours, seed=1), Client(token_b, neighbours, seed=2)]
            sockets: list[ClientConnection] = []
            tasks: list[asyncio.Task[None]] = []
            for client in clients:
                client.match_id = match_id
                ws, _ = await client.open(live.host)
                sockets.append(ws)
                tasks.append(asyncio.create_task(client.play(ws)))
            assert sorted(c.player for c in clients) == [0, 1]

            async def ticks(n: int) -> None:
                for _ in range(n):
                    if runner.finished:
                        return
                    live.clock.advance(DT)
                    await asyncio.sleep(0.01)

            await ticks(150)
            assert all(c.moves > 0 for c in clients)  # the clients really play

            # Reconnect: the second client drops, the match goes on, then it comes back.
            dropped = clients[1]
            await sockets[1].close()
            await tasks[1]
            await asyncio.sleep(0.05)
            assert not runner.connected(dropped.player)
            await ticks(30)
            ws, welcome = await dropped.open(live.host)
            assert welcome.last_seq == runner.last_seq(dropped.player)
            assert welcome.last_seq <= dropped.seq
            raw = decode_server(await asyncio.wait_for(ws.recv(), RECV_TIMEOUT_S))
            assert isinstance(raw, SnapshotMsg)
            assert raw.tick == runner.match.tick  # no tick passed since the reconnect
            assert raw.view == runner.snapshot(dropped.player).message().view
            sockets[1] = ws
            tasks[1] = asyncio.create_task(dropped.play(ws))

            await ticks(runner.match.rules.match_ticks)
            assert runner.finished
            await asyncio.wait_for(asyncio.gather(*tasks), RECV_TIMEOUT_S)
            for ws in sockets:
                with suppress(ConnectionClosed):
                    await ws.close()
        return runner, clients, match_id

    runner, clients, match_id = asyncio.run(scenario())

    outcome = runner.match.outcome
    assert outcome is not None
    vp = [runner.match.state.players[p].vp for p in (0, 1)]
    expected = match_end_msg(outcome, runner.match.tick, vp)
    for client in clients:  # both heard the same end
        assert client.end is not None, (
            client.player,
            client.code,
            client.snapshots,
            client.moves,
            runner.match.tick,
            outcome,
        )
        assert (client.end.winner, client.end.reason) == (expected.winner, expected.reason)
        assert client.snapshots > 100

    # The replay is written, complete, and replays to the same hash.
    log = settings.replays_dir / f"{match_id}.jsonl.gz"
    assert log.is_file()
    replay = read_replay(log)
    assert replay.final
    assert replay.commands, "the clients' commands are in the log"
    check = replay_run(log, settings.rulesets_dir, maps_dir)
    assert check.ok, check.divergence
    assert check.ticks == runner.match.tick

    # Headless: the same commands (the log) on a fresh Match give the same result.
    headless: Match = replay_match(log, settings.rulesets_dir, maps_dir)
    assert headless.state_hash() == runner.match.state_hash()
    assert headless.outcome == outcome
    assert headless.tick == runner.match.tick
