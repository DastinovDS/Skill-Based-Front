"""Performance budgets of the simulation (AGENTS.md, section 12; SIM-15), with pytest-benchmark.

Budgets are for the reference machine of ``docs/perf.md``. On another machine they are scaled by
``speed_factor``: the time of a fixed pure-Python workload that does not use the simulation,
divided by its time on the reference machine (``REFERENCE_WORKLOAD_S``). A benchmark fails when it
is more than 50% over its scaled budget (``REGRESSION``). ``--benchmark-disable`` runs each target
once and skips the budget checks.

Step budget: 40 nodes and 40 groups (``grid40`` of ``conftest.py``: 10 garrisons and 10 extra
groups per player), both players driven by ``ExpandBot``; the controllers and projections run in
the untimed setup, so the timed part is ``Match.step`` alone. The maps of DEC-27 (45..55 nodes)
are checked against the same budgets on ``grid55`` (55 nodes, 56 groups; DEC-27, item 7).
"""

import copy
import timeit
from collections.abc import Callable
from dataclasses import dataclass
from functools import partial
from pathlib import Path
from typing import Final, Protocol

import pytest

from gow_sim.commands import PlayerCommand
from gow_sim.maps import PLAYERS, MapDef, load_map
from gow_sim.match import Controller, Match, MatchResult, run_headless
from gow_sim.ruleset import Ruleset
from gow_sim.state import AtNode, Detail, GameState, Group, Mode, OnEdge, Packet
from gow_sim.systems.supply import supply
from gow_sim.systems.vision import compute_vision
from gow_sim.view import project

pytestmark = pytest.mark.perf  # serial only: timings are meaningless under xdist

ROOT: Final = Path(__file__).resolve().parents[3]
MS: Final = 1e-3
REGRESSION: Final = 1.5
"""Fail above budget x 1.5: a regression of more than 50%."""
REFERENCE_WORKLOAD_S: Final = 1.29e-3
"""``_workload()`` on the reference machine (Apple M4, CPython 3.12): best of 30 runs."""
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


@dataclass(slots=True)
class _Item:
    key: int
    value: int


def _workload() -> int:
    """Dicts, slotted objects, sorting with a key and a loop: the mix of the simulation."""
    items = {i: _Item(i, (i * 7919) % 1009) for i in range(5000)}
    order = sorted(items, key=lambda k: (items[k].value, k))
    total = 0
    for k in order:
        item = items[k]
        if item.value % 3 == 0:
            total += item.key
    return total


@pytest.fixture(scope="module")
def speed_factor() -> float:
    """How much slower this machine is than the reference one (below 1: faster)."""
    return min(timeit.repeat(_workload, number=1, repeat=30)) / REFERENCE_WORKLOAD_S


def _check(
    benchmark: BenchmarkFixture,
    factor: float,
    mean_budget: float,
    p99_budget: float | None = None,
) -> None:
    if benchmark.disabled:
        return
    stats = benchmark.stats.stats
    limit = factor * REGRESSION
    assert stats.mean <= mean_budget * limit, f"mean {stats.mean / MS:.3f} ms, x{factor:.2f}"
    if p99_budget is not None:
        data = sorted(stats.data)
        p99 = data[min(len(data) - 1, len(data) * 99 // 100)]
        assert p99 <= p99_budget * limit, f"p99 {p99 / MS:.3f} ms, x{factor:.2f}"


class _Driver:
    """A match on a grid map, driven by two controllers; restarts when it ends.

    Every garrison gets a second group: 40 groups on ``grid40``, 56 on ``grid55``.
    """

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
        garrisons = sum(1 for n in state.map.nodes if n.start_units)
        assert len(state.groups) == 2 * garrisons
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


@pytest.fixture(params=["grid40", "grid55"])
def grid_map(request: pytest.FixtureRequest) -> MapDef:
    """The budgets of section 12 on 40 nodes and, by DEC-27, item 7, on 55 nodes."""
    mapdef: MapDef = request.getfixturevalue(f"{request.param}_map")
    return mapdef


def _project_budget(mapdef: MapDef) -> float:
    """0.3 ms (section 12) on 40 nodes; 0.45 ms on the 45..55 node maps of DEC-27 (``grid55``):
    ``project()`` does not fit 0.3 ms there (about 0.42 ms on the reference machine), and the
    owner accepted 0.45 ms on 2026-10-22 (#371)."""
    return (0.45 if len(mapdef.nodes) > 40 else 0.3) * MS


def test_bench_step(
    benchmark: BenchmarkFixture,
    speed_factor: float,
    grid_map: MapDef,
    mvp_rules: Ruleset,
    expand_bot: BotFactory,
) -> None:
    driver = _Driver(grid_map, mvp_rules, expand_bot)
    driver.warm(50)

    def setup() -> tuple[tuple[object, ...], dict[str, object]]:
        return (driver.commands(),), {}

    benchmark.pedantic(driver.step, setup=setup, rounds=2000)
    _check(benchmark, speed_factor, 0.3 * MS, 1.0 * MS)


def test_bench_supply(
    benchmark: BenchmarkFixture,
    speed_factor: float,
    grid_map: MapDef,
    mvp_rules: Ruleset,
    expand_bot: BotFactory,
) -> None:
    state = _Driver(grid_map, mvp_rules, expand_bot).warm(300)
    assert state.packets, "the benchmark state has packets on the way"

    def setup() -> tuple[tuple[object, ...], dict[str, object]]:
        return (copy.deepcopy(state),), {}

    benchmark.pedantic(partial(_supply, rules=mvp_rules), setup=setup, rounds=500)
    _check(benchmark, speed_factor, 0.1 * MS)


def _donor_state(mapdef: MapDef, rules: Ruleset) -> GameState:
    """A dispatch tick of a busy supply (DEC-28, #306): each player owns half of ``grid40`` (20
    cities), every other city is a donor (4 charges over a rear minimum of 2), the others lack 2,
    both markers sit on empty front cities, and transfer packets hold the roads next to the
    capital, so most sends hit a road with no throughput left and look for a detour (#309)."""
    state = Match(mapdef, rules, KEY).state
    cols = 20
    for n in range(2 * cols):
        state.nodes[n].owner = 0 if n % cols < cols // 2 else 1
    for pid in PLAYERS:
        state.players[pid].rear_min = 2
    for n in range(cols // 2):  # player 0 (the mirror half for player 1)
        for node in (n, cols + n):
            stock = 4 if (n + node // cols) % 2 else 0
            state.nodes[node].warehouse = stock
            state.nodes[2 * cols - 1 - node].warehouse = stock
    fronts = (cols // 2 - 1, cols + cols // 2 - 1)  # both front cities of player 0
    state.players[0].fronts = fronts
    state.players[1].fronts = tuple(2 * cols - 1 - f for f in fronts)
    for pid in PLAYERS:
        state.nodes[mapdef.capital(pid)].warehouse = 10
        for f in fronts:
            state.nodes[f if pid == 0 else 2 * cols - 1 - f].warehouse = 0
    for pid, (a, b) in ((0, (0, 1)), (0, (0, cols)), (1, (39, 38)), (1, (39, 19))):
        eid = next(e.id for e in mapdef.edges if {e.a, e.b} == {a, b})
        packet_id = state.new_id()
        state.packets[packet_id] = Packet(
            id=packet_id,
            owner=pid,
            edge=eid,
            from_node=a,
            charges=3,
            depart_tick=0,
            arrive_tick=1000,
            transfer=True,
            share=3,
        )
    state.groups.clear()
    state.tick = 1000  # a dispatch tick
    return state


def test_bench_supply_many_donors_busy_roads(
    benchmark: BenchmarkFixture, speed_factor: float, grid40_map: MapDef, mvp_rules: Ruleset
) -> None:
    """A dispatch tick at its worst (the risk noted in #292): 20 cities per player, ten deficits,
    ten donors, used-up roads and detours. The budget of section 12 (0.1 ms) is for the state of a
    bot match (``test_bench_supply``); this stress state has its own budget, 1 ms per dispatch
    tick (once in ``supply.dispatch_ticks``), ``docs/perf.md``."""
    state = _donor_state(grid40_map, mvp_rules)
    sent = [e for e in supply(copy.deepcopy(state), mvp_rules) if e.kind == "packet_sent"]
    assert len(sent) >= 10, "the benchmark state sends many packets"

    def setup() -> tuple[tuple[object, ...], dict[str, object]]:
        return (copy.deepcopy(state),), {}

    benchmark.pedantic(partial(_supply, rules=mvp_rules), setup=setup, rounds=500)
    _check(benchmark, speed_factor, 1.0 * MS)


def test_bench_project(
    benchmark: BenchmarkFixture,
    speed_factor: float,
    grid_map: MapDef,
    mvp_rules: Ruleset,
    expand_bot: BotFactory,
) -> None:
    state = _Driver(grid_map, mvp_rules, expand_bot).warm(300)
    benchmark.pedantic(lambda: project(state, mvp_rules, 0, KEY), rounds=2000)
    _check(benchmark, speed_factor, _project_budget(grid_map))


def test_bench_project_with_enemy_figures(
    benchmark: BenchmarkFixture,
    speed_factor: float,
    grid_map: MapDef,
    mvp_rules: Ruleset,
    expand_bot: BotFactory,
) -> None:
    """DEC-33, detail 12: ``project()`` with every enemy group out of a fight as a figure on a
    half of an edge in sight (the worst case of ``EdgeView.enemy_groups``)."""
    state = copy.deepcopy(_Driver(grid_map, mvp_rules, expand_bot).warm(300))
    mapdef = state.map
    levels = compute_vision(state, mvp_rules, 0)
    seen = [n for n, level in enumerate(levels.nodes) if level is not Detail.FOG]
    moved = 0
    for gid in sorted(state.groups):
        g = state.groups[gid]
        if g.owner != 1 or g.fight is not None:
            continue
        node = seen[moved % len(seen)]
        edge = mapdef.incident[node][moved % len(mapdef.incident[node])]
        g.location = OnEdge(edge, mapdef.edges[edge].other(node), 900)
        g.order = None
        moved += 1
    figures = sum(len(e.enemy_groups) for e in project(state, mvp_rules, 0, KEY).edges)
    assert figures == moved >= 10
    benchmark.pedantic(lambda: project(state, mvp_rules, 0, KEY), rounds=2000)
    _check(benchmark, speed_factor, _project_budget(grid_map))


def test_bench_full_headless_match(
    benchmark: BenchmarkFixture, speed_factor: float, mvp_rules: Ruleset, expand_bot: BotFactory
) -> None:
    mapdef = load_map(ROOT / "maps" / "fixtures" / "web.json")  # the MVP map with the most edges

    def play() -> MatchResult:
        return run_headless(mapdef, mvp_rules, [expand_bot(mapdef, mvp_rules) for _ in PLAYERS])

    result = benchmark.pedantic(play, rounds=1, iterations=1)
    assert isinstance(result, MatchResult) and result.outcome is not None
    _check(benchmark, speed_factor, 8.0)
