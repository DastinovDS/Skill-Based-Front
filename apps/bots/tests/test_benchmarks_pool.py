"""Performance on what ships (#482, ARP-01): the pool maps ``maps/*.json`` under ``mvp-7``.

The budgets of AGENTS.md, section 12 are checked on synthetic grids by
``packages/sim/tests/test_benchmarks.py``. Here the same quantities are measured on the maps the
queue plays, with the rules a match plays (``Match.rules``: ``[map_tempo]`` applied) and two
smart bots (``smart_rusher`` against ``smart_expander``, hard) driving a seeded match to tick
``WARM_TICKS``, so the state has groups on the roads, fights, builds and a grown fog memory.

Every benchmark has two numbers:

- the section 12 budget (``_budget``: the 40-node figure for a map up to 40 nodes, the 45..55
  node one above it), written to ``extra_info`` so the report shows the ratio;
- ``CEILING_MS``: the most the benchmark may take on the reference machine (before
  ``speed_factor`` and ``REGRESSION``). It is a regression net around the measurement recorded in
  ``docs/perf.md``, **not** a claim that the budget holds: where the ceiling is above the budget the
  budget does not hold on that map, which ``docs/perf.md`` reports as a finding. Nothing here
  loosens a budget; the budget tests of ``packages/sim`` are unchanged.

Method and scaling are those of ``packages/sim/tests/test_benchmarks.py`` (``docs/perf.md``).
"""

import copy
import time
import timeit
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Protocol

import pytest

from gow_bots.bots import BOTS
from gow_protocol.convert import snapshot_frame
from gow_sim.commands import PlayerCommand
from gow_sim.maps import PLAYERS, MapDef, load_map
from gow_sim.match import DECIDE_EVERY, Controller, Match
from gow_sim.replay import read_replay
from gow_sim.ruleset import Ruleset, load_ruleset
from gow_sim.state import GameState
from gow_sim.systems.flow import supply_flow
from gow_sim.systems.vision import compute_vision
from gow_sim.view import project

pytestmark = pytest.mark.perf  # serial only: timings are meaningless under xdist

ROOT: Final = Path(__file__).resolve().parents[3]
LOGS: Final = Path(__file__).resolve().parent / "bench_pool"
RECORD: Final = "record them again with `mise run bench:record` (scripts/bench_pool_record.py)"
MS: Final = 1e-3
REGRESSION: Final = 1.5
REFERENCE_WORKLOAD_S: Final = 1.29e-3
"""``_workload()`` on the reference machine; equal to the one of the simulation benchmarks."""
KEY: Final = bytes(range(32))
WARM_TICKS: Final = 3000
RECORDED_TICKS: Final = 4500
"""The ticks of the logs: ``WARM_TICKS`` plus the 1500 steps of ``test_pool_step``."""
POOL: Final = sorted(p.stem for p in (ROOT / "maps").glob("*.json"))
BOT_NAMES: Final = ("smart_rusher", "smart_expander")
BOT_BUDGET_MS: Final = 1.0
"""``MatchRunner``'s bot budget (``Settings.bot_budget_s``) and the section 12 decision budget."""


class _Stats(Protocol):
    @property
    def mean(self) -> float: ...


class _Metadata(Protocol):
    @property
    def stats(self) -> _Stats: ...


class BenchmarkFixture(Protocol):
    @property
    def disabled(self) -> bool: ...
    @property
    def stats(self) -> _Metadata: ...
    @property
    def extra_info(self) -> dict[str, object]: ...
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
    """Copy of ``_workload`` of the simulation benchmarks: keep the two equal."""
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
    return min(timeit.repeat(_workload, number=1, repeat=30)) / REFERENCE_WORKLOAD_S


@pytest.fixture(scope="module")
def rules7() -> Ruleset:
    return load_ruleset(ROOT / "rulesets" / "mvp-7.toml")


class _Game:
    """The warmed match of a pool map: the recorded commands of ``bench_pool/<map>.jsonl.gz``
    replayed to tick ``WARM_TICKS``, with the bots deciding on the views of every
    ``DECIDE_EVERY``-th tick (timed for ``test_pool_decision``; their commands are not played).

    The simulation benchmarks measure a copy of ``match`` (``fresh()``), so neither the bots of
    the day nor the order or selection of the tests changes the state they measure (#1029)."""

    def __init__(self, name: str, mapdef: MapDef, rules: Ruleset) -> None:
        self.name, self.map = name, mapdef
        replay = read_replay(LOGS / f"{name}.jsonl.gz")
        self.log: dict[int, list[PlayerCommand]] = {}
        for tick, cmd in replay.commands:
            self.log.setdefault(tick, []).append(cmd)
        self.checkpoints = {c.tick: c.hash for c in replay.checkpoints}
        self.decisions: list[float] = []
        """Seconds of ``view`` plus ``decide`` per call, from tick 300 (the server's bot loop)."""
        self.match = Match(mapdef, rules, KEY)
        bots: list[Controller] = [
            BOTS[n](mapdef, self.match.rules, seed=7, player=p) for p, n in enumerate(BOT_NAMES)
        ]
        match = self.match
        while match.tick < WARM_TICKS:
            if match.tick % DECIDE_EVERY == 0:
                for p in PLAYERS:
                    t0 = time.perf_counter()
                    bots[p].decide(match.view(p, reuse=True), match.tick)
                    if match.tick >= 300:
                        self.decisions.append(time.perf_counter() - t0)
            match.step(self.log.get(match.tick + 1, ()))
        assert not match.finished
        assert match.state_hash() == self.checkpoints[WARM_TICKS], (
            f"{name}: the recorded commands no longer give the recorded state: {RECORD}"
        )

    def fresh(self) -> Match:
        """A copy of the warmed match (the memos and the vision of the last step travel with it)."""
        return copy.deepcopy(self.match)

    def commands(self, match: Match) -> list[PlayerCommand]:
        """The recorded commands of the next step of ``match``."""
        assert match.tick < RECORDED_TICKS, f"{self.name}: the log ends at tick {RECORDED_TICKS}"
        return self.log.get(match.tick + 1, [])


@pytest.fixture(scope="module", params=POOL)
def game(request: pytest.FixtureRequest, rules7: Ruleset) -> _Game:
    name: str = request.param
    return _Game(name, load_map(ROOT / "maps" / f"{name}.json"), rules7)


def _budget(mapdef: MapDef, kind: str) -> float:
    """Section 12, in ms. Step and supply keep the 40-node budgets on the 45..55 node maps, the
    projection has 0.45 ms there (DEC-27, owner 2026-10-22, #371); a snapshot has no budget of
    its own (the rule is: no dearer than ``project()``), the server tick none per match."""
    big = len(mapdef.nodes) > 40
    return {
        "step": 0.3,
        "project": 0.45 if big else 0.3,
        "supply": 0.1,
        "supply_replan": 0.1,
        "vision": 0.0,
        "snapshot": 0.45 if big else 0.3,
        "decision": BOT_BUDGET_MS,
        "server_tick": 0.0,
    }[kind]


CEILING_MS: Final[dict[tuple[str, str], float]] = {
    ("step", "crossroads"): 0.21,
    ("step", "highway"): 0.21,
    ("step", "narrows"): 0.16,
    ("step", "ridge"): 0.23,
    ("project", "crossroads"): 0.31,
    ("project", "highway"): 0.29,
    ("project", "narrows"): 0.19,
    ("project", "ridge"): 0.32,
    ("vision", "crossroads"): 0.04,
    ("vision", "highway"): 0.035,
    ("vision", "narrows"): 0.025,
    ("vision", "ridge"): 0.07,
    ("supply", "crossroads"): 0.029,
    ("supply", "highway"): 0.042,
    ("supply", "narrows"): 0.021,
    ("supply", "ridge"): 0.06,
    ("supply_replan", "crossroads"): 0.18,
    ("supply_replan", "highway"): 0.15,
    ("supply_replan", "narrows"): 0.065,
    ("supply_replan", "ridge"): 0.17,
    ("snapshot", "crossroads"): 0.4,
    ("snapshot", "highway"): 0.3,
    ("snapshot", "narrows"): 0.2,
    ("snapshot", "ridge"): 0.39,
    ("server_tick", "crossroads"): 1.7,
    ("server_tick", "highway"): 1.65,
    ("server_tick", "narrows"): 0.9,
    ("server_tick", "ridge"): 1.7,
    ("decision", "crossroads"): 0.85,
    ("decision", "highway"): 0.78,
    ("decision", "narrows"): 0.46,
    ("decision", "ridge"): 0.82,
}
"""Reference-machine means (3 runs, 2026-11-12; the supply rows after #482's flow work), rounded
up about 10%, by (kind, map): see the module docstring. A new pool map needs its row. The
``supply_replan`` rows are raised about 30% (#1022): the CI runners measured the replanned dispatch
1.5 to 1.8 times the reference after ``speed_factor`` on ``develop`` itself (runs 43248526758,
43301391850: crossroads, highway, narrows over the ceiling), so the job failed on noise; the cost
of the warm state did not change (``docs/perf.md``). The ``supply`` row of highway is raised about
30% too (#1027): ``develop`` 9f72adf itself failed it on CI (run 43313578489: 0.062 ms at x1.17
against the 0.032 ms ceiling), while the same benchmark measures 0.022 ms locally."""


def _check(benchmark_mean: float | None, factor: float, kind: str, game: _Game) -> None:
    if benchmark_mean is None:
        return
    ceiling = CEILING_MS.get((kind, game.name))
    assert ceiling is not None, (
        f"no ceiling for {kind} on {game.name}: {benchmark_mean / MS / factor:.3f} ms"
    )
    assert benchmark_mean <= ceiling * MS * factor * REGRESSION, (
        f"{kind} on {game.name}: mean {benchmark_mean / MS:.3f} ms, x{factor:.2f}, "
        f"ceiling {ceiling} ms"
    )


def _run(
    benchmark: BenchmarkFixture,
    factor: float,
    kind: str,
    game: _Game,
    target: Callable[..., object],
    setup: Callable[[], tuple[tuple[object, ...], dict[str, object]]] | None = None,
    rounds: int = 1500,
) -> None:
    benchmark.extra_info.update(
        map=game.name, nodes=len(game.map.nodes), budget_ms=_budget(game.map, kind)
    )
    benchmark.pedantic(target, setup=setup, rounds=rounds)
    if not benchmark.disabled:
        mean = benchmark.stats.stats.mean
        benchmark.extra_info["ref_mean_ms"] = round(mean / MS / factor, 3)
        _check(mean, factor, kind, game)


def test_pool_step(benchmark: BenchmarkFixture, speed_factor: float, game: _Game) -> None:
    """``Match.step`` alone, ticks ``WARM_TICKS + 1`` to ``RECORDED_TICKS`` of the log (the
    recorded commands are taken in the untimed setup)."""
    match = game.fresh()

    def setup() -> tuple[tuple[object, ...], dict[str, object]]:
        return (game.commands(match),), {}

    def step(cmds: list[PlayerCommand]) -> None:
        match.step(cmds)

    _run(benchmark, speed_factor, "step", game, step, setup, RECORDED_TICKS - WARM_TICKS)


def test_pool_project(benchmark: BenchmarkFixture, speed_factor: float, game: _Game) -> None:
    """One ``project()`` of the warmed state, vision not reused (like the section 12 budget)."""
    match = game.fresh()
    state, rules = match.state, match.rules
    _run(benchmark, speed_factor, "project", game, lambda: project(state, rules, 0, KEY))


def test_pool_vision_cold(benchmark: BenchmarkFixture, speed_factor: float, game: _Game) -> None:
    """``compute_vision`` for one player with an empty ``GameState.memo`` (ARP-02): the cost of a
    tick whose vision inputs changed. Warm, the memo answers in microseconds."""
    match = game.fresh()
    cold, rules = match.state, match.rules

    def setup() -> tuple[tuple[object, ...], dict[str, object]]:
        cold.memo.clear()
        return (), {}

    _run(benchmark, speed_factor, "vision", game, lambda: compute_vision(cold, rules, 0), setup)


def test_pool_supply_flow(benchmark: BenchmarkFixture, speed_factor: float, game: _Game) -> None:
    """The supply flow on a dispatch tick of the warmed match (the 0.1 ms supply budget); the
    state is copied in the untimed setup, the memos travel with the copy like in a match. The
    flow runs again on the state its step left, so the dispatch finds the plan of the same inputs
    and sends what it showed, like 90 to 97% of the dispatches of a match (#482); the other ones
    are ``test_pool_supply_flow_replanned``."""
    rules, state = game.match.rules, game.match.state
    assert state.tick % rules.supply.dispatch_ticks == 0

    def setup() -> tuple[tuple[object, ...], dict[str, object]]:
        return (copy.deepcopy(state),), {}

    def flow(s: GameState) -> None:
        supply_flow(s, rules)

    _run(benchmark, speed_factor, "supply", game, flow, setup, 500)


def test_pool_supply_flow_replanned(
    benchmark: BenchmarkFixture, speed_factor: float, game: _Game
) -> None:
    """The same dispatch tick without the plans of the previous tick (``systems.flow``'s plan
    memo dropped in the setup): the dispatch whose inputs changed since the last plan, so both
    the dispatch and the plan run the calls of item M for each player."""
    rules, state = game.match.rules, game.match.state
    assert state.tick % rules.supply.dispatch_ticks == 0

    def setup() -> tuple[tuple[object, ...], dict[str, object]]:
        s = copy.deepcopy(state)
        for key in [k for k in s.memo if k.startswith("flow.plan.")]:
            del s.memo[key]
        return (s,), {}

    def flow(s: GameState) -> None:
        supply_flow(s, rules)

    _run(benchmark, speed_factor, "supply_replan", game, flow, setup, 500)


def test_pool_snapshot_frame(benchmark: BenchmarkFixture, speed_factor: float, game: _Game) -> None:
    """The encoded snapshot of one player from the view of the tick (the cost on top of it)."""
    view = game.fresh().view(0)
    _run(benchmark, speed_factor, "snapshot", game, lambda: snapshot_frame(view))


def test_pool_server_tick(benchmark: BenchmarkFixture, speed_factor: float, game: _Game) -> None:
    """What ``MatchRunner.step`` does per tick without the bot and the sockets: the step, a view
    with the reused vision and the encoded snapshot for each player; ticks ``WARM_TICKS + 1``
    on of the log."""
    match = game.fresh()

    def tick(cmds: list[PlayerCommand]) -> None:
        match.step(cmds)
        for p in PLAYERS:
            snapshot_frame(match.view(p, reuse=True))

    def setup() -> tuple[tuple[object, ...], dict[str, object]]:
        return (game.commands(match),), {}

    _run(benchmark, speed_factor, "server_tick", game, tick, setup, 1000)


def test_pool_decision(speed_factor: float, game: _Game) -> None:
    """``view`` plus ``decide`` of a hard smart bot, the call ``MatchRunner._bot_commands`` times
    against ``bot_budget_s`` (1 ms of wall time): the mean over the decisions of the warm-up
    from tick 300 and the share of them over 1 ms (scaled to the reference machine)."""
    data = sorted(t / speed_factor for t in game.decisions)
    assert len(data) > 100
    mean = sum(data) / len(data)
    over = sum(t > BOT_BUDGET_MS * MS for t in data) / len(data)
    print(
        f"\nDECISION {game.name}: mean {mean / MS:.3f} ms, p50 {data[len(data) // 2] / MS:.3f}, "
        f"p95 {data[len(data) * 95 // 100] / MS:.3f}, over 1 ms {over:.1%} (x{speed_factor:.2f})"
    )
    _check(mean * speed_factor, speed_factor, "decision", game)
