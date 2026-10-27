"""SRV-02: the server budget of AGENTS.md, section 12: 30 matches in one process, tick lag < 10%.

Tick lag is a real-time property (how late a step starts after it was due while the other
matches hold the event loop), so this test runs the real loop, not a ``ManualClock``. To make the
result independent of the machine, the clock runs slower by the machine's ``speed_factor``
(as for the simulation benchmarks, ``docs/perf.md``): on a runner 2.5 times slower than the
reference, a tick lasts 2.5 times longer, so the load is the one of the reference machine.

30 matches start at random moments (their ticks are spread over the tick period, as for real
matches) and are played by two scripted clients each, over the wire messages: every 5 ticks each
idle group goes to a random neighbour node, so the steps carry movement, fights and the
projections of both players. The runners are the production ones (``validate_snapshots`` off).
The mean lag of all steps must stay under 10% of a tick (``REGRESSION`` on top, as in the
benchmarks), and no match may fall behind enough to reset.

A shared CI runner can slow down for a while (a busy neighbour), which a ``speed_factor`` measured
once before the run does not see (#155: 26.5% at factor 1.14). So the factor is measured before
and after the run and the larger one is taken, and the scenario gets ``ATTEMPTS`` tries: a real
regression fails all of them, a passing slowdown of the runner fails one.
"""

import asyncio
import json
import random
import time
import timeit
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

import pytest

from gow_protocol import commands as wire
from gow_protocol.codec import SnapshotFrame
from gow_server.matches import MatchRunner, Outbox
from gow_sim.maps import MapDef, load_map
from gow_sim.ruleset import Ruleset, load_ruleset

pytestmark = pytest.mark.perf  # real-time test: serial only, load from other tests skews the lag

ROOT: Final = Path(__file__).parents[3]
MATCHES: Final = 30
PLAY_S: Final = 3.0
"""Reference seconds of play (30 ticks per match)."""
LAG_BUDGET: Final = 0.10
REGRESSION: Final = 1.5
REFERENCE_WORKLOAD_S: Final = 1.29e-3
"""``_workload()`` on the reference machine; equal to the one of the simulation benchmarks."""
ATTEMPTS: Final = 2


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
            if isinstance(msg, SnapshotFrame) and msg.tick % 5 == 0:
                self.react(json.loads(msg.frame))

    def react(self, snapshot: dict[str, Any]) -> None:
        """Reads the frame as plain JSON: a real client decodes it in its own process."""
        for group in snapshot["view"]["groups"]:
            location = group["location"]
            if group["order"] is None and location["kind"] == "node":
                dest = self.rng.choice(self.neighbours[location["node"]])
                self.seq += 1
                cmd = wire.MoveCmd(group=group["id"], dest=dest, planned=False)
                self.runner.submit(self.player, self.seq, cmd)


def _speed_factor() -> float:
    return min(timeit.repeat(_workload, number=1, repeat=30)) / REFERENCE_WORKLOAD_S


def _play(mapdef: MapDef, rules: Ruleset) -> tuple[float, float, list[MatchRunner]]:
    """One run of the scenario: mean lag in seconds, the speed factor, the runners."""
    dt = 1.0 / rules.tick_hz
    before = _speed_factor()
    clock = _ScaledClock(before)
    rng = random.Random(0)

    async def scenario() -> list[MatchRunner]:
        runners: list[MatchRunner] = []
        tasks: list[asyncio.Task[None]] = []
        for i in range(MATCHES):
            await clock.sleep(rng.uniform(0, dt))
            runner = MatchRunner(f"m{i}", "web", mapdef, rules, (2 * i, 2 * i + 1), clock)
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
    factor = max(before, _speed_factor())
    # Lag was measured in reference time of the factor ``before``; rescale to the larger one.
    mean_lag = sum(r.lag_sum for r in runners) / sum(r.steps for r in runners) * before / factor
    return mean_lag, factor, runners


def test_thirty_matches_keep_tick_lag_under_ten_percent() -> None:
    mapdef = load_map(ROOT / "maps" / "fixtures" / "web.json")
    rules = load_ruleset(ROOT / "rulesets" / "mvp-0.toml")
    dt = 1.0 / rules.tick_hz
    failures: list[str] = []
    for _ in range(ATTEMPTS):
        mean_lag, factor, runners = _play(mapdef, rules)
        assert sum(r.steps for r in runners) >= MATCHES * PLAY_S / dt * 0.9
        resets = sum(r.resets for r in runners)
        if resets == 0 and mean_lag <= LAG_BUDGET * dt * REGRESSION:
            return
        failures.append(f"mean tick lag {mean_lag / dt:.1%}, {resets} resets, factor {factor:.2f}")
    raise AssertionError(f"every attempt over budget (reference time): {'; '.join(failures)}")
