"""Performance budgets of the simulation (AGENTS.md, section 12; SIM-15), with pytest-benchmark.

Budgets are for the reference machine of ``docs/perf.md``. A benchmark fails when it is more
than 50% over its budget (``REGRESSION``), so a slower CI runner does not fail on noise while a
real regression does. ``--benchmark-disable`` runs each target once and skips the budget checks.

Step budget: 40 nodes and 40 groups (``grid40`` of ``conftest.py``: 10 garrisons and 10 extra
groups per player), both players driven by ``ExpandBot``; the controllers and projections run in
the untimed setup, so the timed part is ``Match.step`` alone.
"""

import copy
from collections.abc import Callable
from functools import partial
from pathlib import Path
from typing import Final, Protocol

from gow_sim.commands import PlayerCommand
from gow_sim.maps import PLAYERS, MapDef, load_map
from gow_sim.match import Controller, Match, MatchResult, run_headless
from gow_sim.ruleset import Ruleset
from gow_sim.state import AtNode, GameState, Group, Mode
from gow_sim.systems.supply import supply
from gow_sim.view import project

ROOT: Final = Path(__file__).resolve().parents[3]
MS: Final = 1e-3
REGRESSION: Final = 1.5
"""Fail above budget x 1.5: a regression of more than 50%."""
KEY: Final = bytes(range(32))
DECIDE_EVERY: Final = 5

type BotFactory = Callable[[MapDef, Ruleset], Controller]


class _Stats(Protocol):
    @property
    def mean(self) -> float: ...
    @property
    def data(self) -> list[float]: ...


class _Metadata(Protocol):
    @property
    def stats(self) -> _Stats: ...


class BenchmarkFixture(Protocol):
    """The part of pytest-benchmark's (untyped) ``benchmark`` fixture used here."""

    @property
    def disabled(self) -> bool: ...
    @property
    def stats(self) -> _Metadata: ...
    def pedantic(
        self,
        target: Callable[..., object],
        setup: Callable[[], tuple[tuple[object, ...], dict[str, object]]] | None = None,
        rounds: int = 1,
        iterations: int = 1,
    ) -> object: ...


def _check(
    benchmark: BenchmarkFixture, mean_budget: float, p99_budget: float | None = None
) -> None:
    if benchmark.disabled:
        return
    stats = benchmark.stats.stats
    assert stats.mean <= mean_budget * REGRESSION, f"mean {stats.mean / MS:.3f} ms"
    if p99_budget is not None:
        data = sorted(stats.data)
        p99 = data[min(len(data) - 1, len(data) * 99 // 100)]
        assert p99 <= p99_budget * REGRESSION, f"p99 {p99 / MS:.3f} ms"


class _Driver:
    """A match on grid40 with 40 groups, driven by two controllers; restarts when it ends."""

    def __init__(self, mapdef: MapDef, rules: Ruleset, bots: BotFactory) -> None:
        self.map, self.rules, self.bots = mapdef, rules, bots
        self.match = self._new()

    def _new(self) -> Match:
        match = Match(self.map, self.rules, KEY)
        self.controllers = [self.bots(self.map, self.rules) for _ in PLAYERS]
        self.seq = 0
        state = match.state
        for g in sorted(state.groups.values(), key=lambda g: g.id):
            if isinstance(g.location, AtNode):  # a second group in every garrisoned node
                gid = state.new_id()
                state.groups[gid] = Group(gid, g.owner, 2, 1, Mode.ATTACK, g.location)
        assert len(state.groups) == 40 and len(state.map.nodes) == 40
        return match

    def commands(self) -> list[PlayerCommand]:
        if self.match.finished:
            self.match = self._new()
        match = self.match
        if match.tick % DECIDE_EVERY:
            return []
        cmds: list[PlayerCommand] = []
        for p in PLAYERS:
            for cmd in self.controllers[p].decide(match.view(p), match.tick):
                cmds.append(PlayerCommand(p, self.seq, match.resolve(p, cmd)))
                self.seq += 1
        return cmds

    def step(self, cmds: list[PlayerCommand]) -> None:
        self.match.step(cmds)

    def warm(self, ticks: int) -> GameState:
        for _ in range(ticks):
            self.match.step(self.commands())
        return self.match.state


def _supply(state: GameState, rules: Ruleset) -> None:
    supply(state, rules)


def test_bench_step(
    benchmark: BenchmarkFixture, grid40_map: MapDef, mvp_rules: Ruleset, expand_bot: BotFactory
) -> None:
    driver = _Driver(grid40_map, mvp_rules, expand_bot)
    driver.warm(50)

    def setup() -> tuple[tuple[object, ...], dict[str, object]]:
        return (driver.commands(),), {}

    benchmark.pedantic(driver.step, setup=setup, rounds=2000)
    _check(benchmark, 0.3 * MS, 1.0 * MS)


def test_bench_supply(
    benchmark: BenchmarkFixture, grid40_map: MapDef, mvp_rules: Ruleset, expand_bot: BotFactory
) -> None:
    state = _Driver(grid40_map, mvp_rules, expand_bot).warm(300)
    assert state.packets, "the benchmark state has packets on the way"

    def setup() -> tuple[tuple[object, ...], dict[str, object]]:
        return (copy.deepcopy(state),), {}

    benchmark.pedantic(partial(_supply, rules=mvp_rules), setup=setup, rounds=500)
    _check(benchmark, 0.1 * MS)


def test_bench_project(
    benchmark: BenchmarkFixture, grid40_map: MapDef, mvp_rules: Ruleset, expand_bot: BotFactory
) -> None:
    state = _Driver(grid40_map, mvp_rules, expand_bot).warm(300)
    benchmark.pedantic(lambda: project(state, mvp_rules, 0, KEY), rounds=2000)
    _check(benchmark, 0.3 * MS)


def test_bench_full_headless_match(
    benchmark: BenchmarkFixture, mvp_rules: Ruleset, expand_bot: BotFactory
) -> None:
    mapdef = load_map(ROOT / "maps" / "pautina.json")  # the MVP map with the most edges

    def play() -> MatchResult:
        return run_headless(mapdef, mvp_rules, [expand_bot(mapdef, mvp_rules) for _ in PLAYERS])

    result = benchmark.pedantic(play, rounds=1, iterations=1)
    assert isinstance(result, MatchResult) and result.outcome is not None
    _check(benchmark, 8.0)
