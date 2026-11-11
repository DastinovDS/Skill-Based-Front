"""The memos of the simulation equal a fresh computation in a real match (#983).

``GameState.memo`` keeps the last result of a pure function of the state with every input it read
(the vision levels, ``systems.vision.compute_vision``; the plan of the next dispatch,
``systems.flow._store``) and returns it again while those inputs are equal. A memo keyed on too
little would return a stale result that is still deterministic, so ``test_determinism.py`` and the
golden replays alone do not prove it right. Here smart bots play a match on a pool map under
``mvp-7``, and on every call of every tick, for both players, the memoised result is compared with
the same function run on an empty memo:

- every ``compute_vision`` (the step's ``vision`` and ``fortify``, the commands, ``project()``):
  the levels, and the halves in sight ``current_sightings`` walks;
- the sight the step's ``vision`` system kept for ``Match.view(reuse=True)``, after every step;
- every plan (``_store``): the ``Node.flow`` it left equals ``_plan`` on the same field, and that
  field equals the one computed without the flow memos.

The quick run plays the first ``QUICK_TICKS`` of a match on ``ridge``; the full matches on the
pool maps are ``slow``.
"""

from collections.abc import Callable, Generator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import pytest

from gow_bots.bots.registry import bot_factory
from gow_sim import commands, view
from gow_sim.commands import PlayerCommand
from gow_sim.maps import PLAYERS, load_map
from gow_sim.match import Glancer, Match
from gow_sim.ruleset import Ruleset, load_ruleset
from gow_sim.state import Detail, GameState
from gow_sim.systems import flow, fortify, vision
from gow_sim.systems.vision import Vision

ROOT: Final = Path(__file__).resolve().parents[3]
KEY: Final = bytes(range(32))
BOTS: Final = ("smart_rusher", "smart_expander")
QUICK_TICKS: Final = 3000


@contextmanager
def _no_memo(state: GameState) -> Generator[None]:
    """Run the block on an empty ``GameState.memo``; the memo of the match comes back after."""
    kept = state.memo
    state.memo = {}
    try:
        yield
    finally:
        state.memo = kept


def _halves(state: GameState, levels: Vision) -> tuple[tuple[int, int], ...]:
    """The halves of edges not in fog in the order of ``current_sightings``, from the levels."""
    return tuple(
        (e.id, n) for e in state.map.edges for n in (e.a, e.b) if levels.half(n) is not Detail.FOG
    )


@dataclass(slots=True)
class _Counts:
    vision_calls: int = 0
    vision_hits: int = 0
    plans: int = 0
    plan_hits: int = 0
    sights: int = 0


def _checked_vision(
    real: Callable[[GameState, Ruleset, int], Vision], seen: _Counts
) -> Callable[[GameState, Ruleset, int], Vision]:
    def check(state: GameState, rules: Ruleset, player: int) -> Vision:
        memo = state.memo.get(vision._MEMO[player])  # pyright: ignore[reportPrivateUsage]
        got = real(state, rules, player)
        hit = memo is not None and state.memo.get(vision._MEMO[player]) is memo  # pyright: ignore[reportPrivateUsage]
        with _no_memo(state):
            fresh = real(state, rules, player)
        assert got == fresh, (state.tick, player)
        halves = vision._halves_in_sight(state, player, got)  # pyright: ignore[reportPrivateUsage]
        assert halves == _halves(state, fresh), (state.tick, player)
        seen.vision_calls += 1
        seen.vision_hits += hit
        return got

    return check


def _checked_store(
    real: Callable[[GameState, flow._Field, tuple[int, ...], dict[int, int]], None],  # pyright: ignore[reportPrivateUsage]
    rules: Ruleset,
    seen: _Counts,
) -> Callable[[GameState, flow._Field, tuple[int, ...], dict[int, int]], None]:  # pyright: ignore[reportPrivateUsage]
    def check(
        state: GameState,
        field: flow._Field,  # pyright: ignore[reportPrivateUsage]
        capacities: tuple[int, ...],
        incoming: dict[int, int],
    ) -> None:
        player = field.player
        memo = state.memo.get(flow._PLAN_MEMO[player])  # pyright: ignore[reportPrivateUsage]
        real(state, field, capacities, incoming)
        hit = memo is not None and state.memo.get(flow._PLAN_MEMO[player]) is memo  # pyright: ignore[reportPrivateUsage]
        stored = [(n, state.nodes[n].flow) for n in field.adj]
        with _no_memo(state):
            assert flow._field(state, rules, player) == field, (state.tick, player)  # pyright: ignore[reportPrivateUsage]
        fresh = flow._plan(state, field, capacities, dict(incoming))  # pyright: ignore[reportPrivateUsage]
        assert stored == fresh, (state.tick, player)
        seen.plans += 1
        seen.plan_hits += hit
        return None

    return check


def _play(map_name: str, ticks: int | None, monkeypatch: pytest.MonkeyPatch) -> _Counts:
    mapdef = load_map(ROOT / "maps" / f"{map_name}.json")
    rules = load_ruleset(ROOT / "rulesets" / "mvp-7.toml")
    match = Match(mapdef, rules, KEY)
    seen = _Counts()
    compute = vision.compute_vision
    checked = _checked_vision(compute, seen)
    for module in (vision, fortify, commands, view):  # every caller of ``compute_vision``
        monkeypatch.setattr(module, "compute_vision", checked)
    monkeypatch.setattr(flow, "_store", _checked_store(flow._store, match.rules, seen))  # pyright: ignore[reportPrivateUsage]
    bots = [bot_factory(b)(mapdef, match.rules, seed=1, player=p) for p, b in enumerate(BOTS)]
    seqs = dict.fromkeys(PLAYERS, 0)
    pending: list[PlayerCommand] = []
    limit = match.rules.match_ticks if ticks is None else ticks
    while not match.finished and match.tick < limit:
        if match.tick % 5 == 0:
            for p in PLAYERS:
                bot = bots[p]
                if isinstance(bot, Glancer) and not bot.thinks(match.tick):
                    bot.glance(match.tick, match.figures(p, reuse=True))
                    continue
                for cmd in bot.decide(match.view(p, reuse=True), match.tick):
                    pending.append(PlayerCommand(p, seqs[p], match.resolve(p, cmd)))
                    seqs[p] += 1
        match.step(pending)
        pending = []
        state = match.state
        for p in PLAYERS:  # the sight the step kept for ``Match.view(reuse=True)``
            sight = match._fresh(p)  # pyright: ignore[reportPrivateUsage]
            assert sight is not None
            with _no_memo(state):
                levels = compute(state, match.rules, p)
                nodes, halves = vision.current_sightings(state, match.rules, p, levels)
            assert sight.levels == levels, (state.tick, p)
            assert list(sight.nodes.items()) == list(nodes.items()), (state.tick, p)
            assert list(sight.halves.items()) == list(halves.items()), (state.tick, p)
            seen.sights += 1
    return seen


def _assert_both_paths(seen: _Counts) -> None:
    """Both the hits and the misses of each memo were compared."""
    assert 0 < seen.vision_hits < seen.vision_calls
    assert 0 < seen.plan_hits < seen.plans
    assert seen.sights > 0


def test_memos_equal_a_fresh_computation(monkeypatch: pytest.MonkeyPatch) -> None:
    seen = _play("ridge", QUICK_TICKS, monkeypatch)
    _assert_both_paths(seen)
    assert seen.sights == 2 * QUICK_TICKS


@pytest.mark.slow  # full smart-bot matches with every memo checked
@pytest.mark.parametrize("map_name", ["ridge", "crossroads"])
def test_memos_equal_a_fresh_computation_in_full_matches(
    map_name: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    _assert_both_paths(_play(map_name, None, monkeypatch))
