"""SRV-06: a match against a bot, through a real uvicorn server and a ``websockets`` client.

The server runs in the test's event loop with a ``ManualClock`` (as in ``test_ws``): the test
moves match time itself, the network is real.
"""

import asyncio
import shutil
import time
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import httpx2
import pytest
import uvicorn
from websockets.asyncio.client import ClientConnection, connect
from websockets.typing import Origin

from gow_bots.bots import BOTS, Controller
from gow_protocol.codec import decode_server, encode
from gow_protocol.commands import SetStanceCmd
from gow_protocol.messages import (
    PROTOCOL_VERSION,
    AckMsg,
    CommandMsg,
    EndReason,
    HelloMsg,
    MatchEndMsg,
    ServerMsg,
    WelcomeMsg,
)
from gow_server.app import create_app
from gow_server.cli import WS_MAX_SIZE
from gow_server.clock import ManualClock
from gow_server.matches import BOT_ACCOUNT, BotSeat, MatchManager, MatchRunner
from gow_server.settings import Settings
from gow_sim.commands import Command, Forfeit
from gow_sim.maps import load_map
from gow_sim.replay import read_replay
from gow_sim.ruleset import Stance, load_ruleset
from gow_sim.view import PlayerView

ROOT: Final = Path(__file__).parents[3]
DT: Final = 0.1
TIMEOUT_S: Final = 5.0


@pytest.fixture
def bot_settings(maps_dir: Path, tmp_path: Path) -> Settings:
    shutil.copy(ROOT / "maps" / "pautina.json", maps_dir)
    return Settings(
        maps_dir=maps_dir,
        database_url=f"sqlite:///{tmp_path / 'gow.db'}",
        replays_dir=tmp_path / "replays",
        rulesets_dir=ROOT / "rulesets" / "archive",
        ruleset_path=ROOT / "rulesets" / "test-short.toml",
        # The real-time budget of a decision (1 ms) depends on the machine load: with it a busy
        # runner makes the bot skip decisions. Overruns are tested below with bot_budget_s=0.001.
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

    def socket(self, match_id: str) -> connect:
        return connect(
            f"ws://{self.host}/ws/match/{match_id}",
            origin=Origin(f"http://{self.host}"),
            open_timeout=TIMEOUT_S,
            compression=None,
        )

    async def start(self, **body: str) -> httpx2.Response:
        return await self.http.post("/api/bot-matches", json=body, headers=self.headers)


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
            guest = (await http.post("/api/guest", json={"nick": "solo"})).json()
            headers = {"Authorization": f"Bearer {guest['token']}"}
            manager = app.state.matches
            assert isinstance(manager, MatchManager)
            yield Live(clock, manager, http, host, headers, guest["token"])
    finally:
        server.should_exit = True
        await task


async def recv(ws: ClientConnection) -> ServerMsg:
    return decode_server(await asyncio.wait_for(ws.recv(), TIMEOUT_S))


def test_scripted_client_plays_a_full_match_against_a_bot(bot_settings: Settings) -> None:
    async def scenario() -> None:
        async with live_server(bot_settings) as live:
            created = await live.start(level="expert", map_id="pautina")
            assert created.status_code == 201, created.text
            info = created.json()
            assert (info["level"], info["map_id"]) == ("expert", "pautina")
            runner = live.manager.get(info["match_id"])
            assert runner is not None
            assert runner.private and runner.bot is not None
            assert runner.bot.slot == 1 - info["player"]
            assert runner.players[runner.bot.slot] == BOT_ACCOUNT

            async with live.socket(info["match_id"]) as ws:
                await ws.send(encode(HelloMsg(protocol_version=PROTOCOL_VERSION, token=live.token)))
                welcome = await recv(ws)
                assert isinstance(welcome, WelcomeMsg) and welcome.player == info["player"]
                assert welcome.nicks[welcome.player] == "solo"
                assert welcome.nicks[1 - welcome.player] == "Bot"  # the bot slot
                await ws.send(encode(CommandMsg(seq=1, cmd=SetStanceCmd(stance=Stance.WAR))))
                await asyncio.sleep(0.05)
                acks: list[AckMsg] = []

                async def read_until_end() -> MatchEndMsg:
                    # Read while the ticks run. A client that reads only after the loop makes
                    # the server wait on a full socket buffer; on a loaded machine the loop
                    # outlasts ``ws_send_timeout_s`` (5 s) and the server drops the client (#378).
                    while True:
                        msg = decode_server(await ws.recv())
                        if isinstance(msg, AckMsg):
                            acks.append(msg)
                        elif isinstance(msg, MatchEndMsg):
                            return msg

                reader = asyncio.create_task(read_until_end())
                for _ in range(runner.match.rules.match_ticks + 10):  # 60 s of match time
                    live.clock.advance(DT)
                    await asyncio.sleep(0.001)
                    if runner.finished or reader.done():
                        break
                end = await asyncio.wait_for(reader, 6 * TIMEOUT_S)  # a hang guard only
            assert acks[0].seq == 1 and acks[0].reject_code is None
            assert end.reason is not EndReason.DISCONNECT
            assert runner.finished and runner.bot_decisions > 100
            assert runner.bot_commands > 0, "the expert bot acted"
            # the bot's commands went through the same log as the player's
            log = read_replay(bot_settings.replays_dir / f"{runner.match_id}.jsonl.gz")
            assert log.final
            players = {c.player for _, c in log.commands}
            assert players == {info["player"], runner.bot.slot}

    asyncio.run(scenario())


def test_one_running_bot_match_per_account_and_bad_requests(bot_settings: Settings) -> None:
    async def scenario() -> None:
        async with live_server(bot_settings) as live:
            assert (await live.start(level="easy")).status_code == 201
            assert (await live.start()).status_code == 409
            assert (await live.start(level="godlike")).status_code == 422
            anonymous = await live.http.post("/api/bot-matches", json={})
            assert anonymous.status_code in (401, 403)

    asyncio.run(scenario())


def test_unknown_map_is_422(bot_settings: Settings) -> None:
    async def scenario() -> None:
        async with live_server(bot_settings) as live:
            assert (await live.start(map_id="nope")).status_code == 422
            assert live.manager.active == 0

    asyncio.run(scenario())


class _Slow:
    """A bot that takes 3 ms per decision and records the ticks it was asked at."""

    def __init__(self) -> None:
        self.ticks: list[int] = []

    def decide(self, view: PlayerView, tick: int) -> list[Command]:
        self.ticks.append(tick)
        time.sleep(0.003)
        return [Forfeit()] if tick == 10 else []


def _runner(controller: Controller | None = None, **kwargs: object) -> MatchRunner:
    mapdef = load_map(ROOT / "maps" / "pautina.json")
    rules = load_ruleset(ROOT / "rulesets" / "test-short.toml")
    seat = BotSeat(1, controller or BOTS["idle"](mapdef, rules, seed=1, player=1))
    return MatchRunner(
        "m",
        "pautina",
        mapdef,
        rules,
        (7, BOT_ACCOUNT),
        ManualClock(),
        bot=seat,
        **kwargs,  # type: ignore[arg-type]
    )


def test_slow_bot_skips_the_next_call_and_it_is_counted() -> None:
    async def scenario() -> None:
        slow = _Slow()
        runner = _runner(slow, bot_budget_s=0.001)
        while not runner.finished:
            runner.step()
        assert slow.ticks == [0, 10]  # tick 5 was skipped after the slow decision at tick 0
        assert (runner.bot_overruns, runner.bot_skipped) == (2, 1)
        assert runner.finished, "the bot's Forfeit at tick 10 went through resolve like any command"
        assert runner.match.outcome is not None and runner.match.outcome.winner == 0

    asyncio.run(scenario())


def test_bot_that_raises_does_not_end_the_match() -> None:
    class Broken:
        def decide(self, view: PlayerView, tick: int) -> list[Command]:
            raise RuntimeError("boom")

    async def scenario() -> None:
        runner = _runner(Broken())
        for _ in range(11):
            runner.step()
        assert not runner.finished and runner.bot_decisions == 0

    asyncio.run(scenario())
