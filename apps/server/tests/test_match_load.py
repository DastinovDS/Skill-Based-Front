"""SRV-02: the server budget of AGENTS.md, section 12: 30 matches in one process, tick lag < 10%.

Tick lag is a real-time property (how late a step starts after it was due while the other
matches hold the event loop), so this test runs the real loop, not a ``ManualClock``. To make the
result independent of the machine, the clock runs slower by the machine's ``speed_factor``
(as for the simulation benchmarks, ``docs/perf.md``): on a runner 2.5 times slower than the
reference, a tick lasts 2.5 times longer, so the load is the one of the reference machine.

30 matches start at random moments (their ticks are spread over the tick period, as for real
matches) and are played by two scripted clients each, over the wire messages: every 5 ticks each
idle group goes to a random neighbour node, so the steps carry movement, fights and the
projections of both players. The mean lag of all steps must stay under 10% of a tick
(``REGRESSION`` on top, as in the benchmarks), and no match may fall behind enough to reset.
"""

import asyncio
import random
import time
import timeit
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from gow_protocol import commands as wire
from gow_protocol.messages import SnapshotMsg
from gow_protocol.view import AtNodeLoc
from gow_server.matches import MatchRunner, Outbox
from gow_sim.maps import MapDef, load_map
from gow_sim.ruleset import load_ruleset

ROOT: Final = Path(__file__).parents[3]
MATCHES: Final = 30
PLAY_S: Final = 3.0
"""Reference seconds of play (30 ticks per match)."""
LAG_BUDGET: Final = 0.10
REGRESSION: Final = 1.5
REFERENCE_WORKLOAD_S: Final = 1.29e-3
"""``_workload()`` on the reference machine; equal to the one of the simulation benchmarks."""


@dataclass(slots=True)
class _Item:
    key: int
    value: int


def _workload() -> int:
    """Copy of ``_workload`` of the simulation benchmarks: keep the two equal."""
    items = {i: _Item(i, (i * 7919) % 1009) for i in range(5000)}
    order = sorted(items, key=lambda k: (items[k].value, k))
    total = 0
    for k in order:
        item = items[k]
        if item.value % 3 == 0:
            total += item.key
    return total


class _ScaledClock:
    """Real monotonic time, ``factor`` times slower."""

    def __init__(self, factor: float) -> None:
        self.factor = factor

    def now(self) -> float:
        return time.monotonic() / self.factor

    async def sleep(self, seconds: float) -> None:
        await asyncio.sleep(max(seconds, 0.0) * self.factor)


class _Wanderer:
    """A scripted client: every 5 ticks each idle group goes to a random neighbour node."""

    def __init__(self, mapdef: MapDef, runner: MatchRunner, player: int, seed: int) -> None:
        self.runner = runner
        self.player = player
        self.box: Outbox = runner.attach(player)
        self.rng = random.Random(seed)
        self.seq = 0
        self.neighbours: dict[int, list[int]] = {}
        for edge in mapdef.edges:
            self.neighbours.setdefault(edge.a, []).append(edge.b)
            self.neighbours.setdefault(edge.b, []).append(edge.a)

    async def play(self) -> None:
        while (msg := await self.box.get()) is not None:
            if isinstance(msg, SnapshotMsg) and msg.tick % 5 == 0:
                self.react(msg)

    def react(self, snapshot: SnapshotMsg) -> None:
        for group in snapshot.view.groups:
            if group.order is None and isinstance(group.location, AtNodeLoc):
                dest = self.rng.choice(self.neighbours[group.location.node])
                self.seq += 1
                cmd = wire.MoveCmd(group=group.id, dest=dest, planned=False)
                self.runner.submit(self.player, self.seq, cmd)


def test_thirty_matches_keep_tick_lag_under_ten_percent() -> None:
    mapdef = load_map(ROOT / "maps" / "pautina.json")
    rules = load_ruleset(ROOT / "rulesets" / "mvp-0.toml")
    dt = 1.0 / rules.tick_hz
    speed_factor = min(timeit.repeat(_workload, number=1, repeat=30)) / REFERENCE_WORKLOAD_S
    clock = _ScaledClock(speed_factor)
    rng = random.Random(0)

    async def scenario() -> list[MatchRunner]:
        runners: list[MatchRunner] = []
        tasks: list[asyncio.Task[None]] = []
        for i in range(MATCHES):
            await clock.sleep(rng.uniform(0, dt))
            runner = MatchRunner(f"m{i}", "pautina", mapdef, rules, (2 * i, 2 * i + 1), clock)
            clients = [_Wanderer(mapdef, runner, p, seed=2 * i + p) for p in (0, 1)]
            tasks += [asyncio.create_task(c.play()) for c in clients]
            tasks.append(asyncio.create_task(runner.run()))
            runners.append(runner)
        await clock.sleep(PLAY_S)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        return runners

    runners = asyncio.run(scenario())
    steps = sum(r.steps for r in runners)
    mean_lag = sum(r.lag_sum for r in runners) / steps
    assert steps >= MATCHES * PLAY_S / dt * 0.9
    assert all(r.resets == 0 for r in runners)
    assert mean_lag <= LAG_BUDGET * dt * REGRESSION, (
        f"mean tick lag {mean_lag / dt:.1%} of a tick (reference time, factor {speed_factor:.2f})"
    )
