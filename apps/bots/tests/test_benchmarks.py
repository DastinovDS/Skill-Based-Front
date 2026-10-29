"""Budget of a bot decision (AGENTS.md, section 12: at most 1 ms, once per 5 ticks).

Same method as ``packages/sim/tests/test_benchmarks.py`` (``docs/perf.md``): the budget of the
reference machine is scaled by ``speed_factor`` (the same pure-Python workload and reference
time), and the benchmark fails more than 50% above it. The timed part is ``decide`` on views of a
``random_legal`` match on ``web`` (the MVP map with the most edges) after 300..1500 ticks.
"""

import timeit
from dataclasses import dataclass
from itertools import cycle
from typing import Final, Protocol

import pytest

from gow_bots.bots import BOTS, SmartBot, Tempo
from gow_bots.bots.tempo import Bucket
from gow_sim.commands import PlayerCommand
from gow_sim.maps import MapDef
from gow_sim.match import Match
from gow_sim.ruleset import Ruleset
from gow_sim.view import PlayerView

pytestmark = pytest.mark.perf  # serial only: timings are meaningless under xdist

MS: Final = 1e-3
REGRESSION: Final = 1.5
REFERENCE_WORKLOAD_S: Final = 1.29e-3
"""``_workload()`` on the reference machine; equal to the one of the simulation benchmarks."""


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
    def pedantic(self, target: object, rounds: int = 1, iterations: int = 1) -> object: ...


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


def _play(mapdef: MapDef, rules: Ruleset, names: tuple[str, str]) -> list[PlayerView]:
    """Views of a match between two bots at every decision from tick 300 to tick 1500."""
    match = Match(mapdef, rules, bytes(range(32)))
    bots = [BOTS[name](mapdef, rules, seed=3, player=p) for p, name in enumerate(names)]
    out: list[PlayerView] = []
    seq = 0
    while match.tick < 1500 and not match.finished:
        cmds: list[PlayerCommand] = []
        if match.tick % 5 == 0:
            for p in (0, 1):
                view = match.view(p)
                if match.tick >= 300:
                    out.append(view)
                for cmd in bots[p].decide(view, match.tick):
                    cmds.append(PlayerCommand(p, seq, match.resolve(p, cmd)))
                    seq += 1
        match.step(cmds)
    return out


@pytest.fixture(scope="module")
def views(maps: dict[str, MapDef], mvp_rules: Ruleset) -> list[PlayerView]:
    return _play(maps["web"], mvp_rules, ("random_legal", "random_legal"))


@pytest.fixture(scope="module")
def strategy_views(maps: dict[str, MapDef], mvp_rules: Ruleset) -> list[PlayerView]:
    """Views of a match of the strategy bots: many own groups, builds and contact with the enemy."""
    return _play(maps["web"], mvp_rules, ("expander", "turtle"))


@pytest.mark.parametrize("name", sorted(BOTS))
def test_bench_decide(
    benchmark: BenchmarkFixture,
    speed_factor: float,
    views: list[PlayerView],
    maps: dict[str, MapDef],
    mvp_rules: Ruleset,
    name: str,
) -> None:
    _bench(benchmark, speed_factor, views, maps["web"], mvp_rules, name)


@pytest.mark.parametrize("name", ["expander", "turtle"])
def test_bench_decide_strategy_views(
    benchmark: BenchmarkFixture,
    speed_factor: float,
    strategy_views: list[PlayerView],
    maps: dict[str, MapDef],
    mvp_rules: Ruleset,
    name: str,
) -> None:
    """BOT-02: the strategy bots on the views of their own matches (the busiest case)."""
    _bench(benchmark, speed_factor, strategy_views, maps["web"], mvp_rules, name)


@pytest.fixture(scope="module")
def smart_views(maps: dict[str, MapDef], mvp1_rules: Ruleset) -> list[PlayerView]:
    """Views of a match of two smart bots on ``mvp-1`` (city builds, fights, threats, #166)."""
    return _play(maps["web"], mvp1_rules, ("smart_rusher", "smart_expander"))


@pytest.mark.parametrize("name", [n for n in sorted(BOTS) if n.startswith("smart_")])
def test_bench_decide_smart_views(
    benchmark: BenchmarkFixture,
    speed_factor: float,
    smart_views: list[PlayerView],
    maps: dict[str, MapDef],
    mvp1_rules: Ruleset,
    name: str,
) -> None:
    """#166: the smart bots, the assessment layer included, on the views of a smart match."""
    _bench(benchmark, speed_factor, smart_views, maps["web"], mvp1_rules, name)


def _bench(
    benchmark: BenchmarkFixture,
    speed_factor: float,
    views: list[PlayerView],
    mapdef: MapDef,
    rules: Ruleset,
    name: str,
) -> None:
    bots = [BOTS[name](mapdef, rules, seed=5, player=p) for p in (0, 1)]
    for bot in bots:
        if isinstance(bot, SmartBot):  # every call a full decision: no empty APM bucket (#166)
            bot.bucket = Bucket(Tempo(5, 0, 100_000, 1_000, True), rules.tick_hz)
    feed = cycle(views)

    def decide() -> None:
        view = next(feed)
        bots[view.player].decide(view, view.tick)

    benchmark.pedantic(decide, rounds=len(views))
    if not benchmark.disabled:
        mean = benchmark.stats.stats.mean
        assert mean <= 1.0 * MS * speed_factor * REGRESSION, f"mean {mean / MS:.3f} ms"
