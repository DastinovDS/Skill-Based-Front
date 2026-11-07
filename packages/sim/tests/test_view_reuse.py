"""The shortcuts of a match equal the full computation (#787), on the states of the golden replays.

- ``Match.view(reuse=True)`` (``run_headless``) reuses what the ``vision`` system of the step saw
  (``Sight``): the view equals ``project()`` computed from scratch;
- ``enemy_figure_ids`` (``Match.figures``, the light projection of a bot that does not decide on a
  call) equals the figure ids of the full view, by edge and then by id, for both players: the same
  fog rules (DEC-33), nothing more;
- the flow field memo (``systems.flow._field``) returns the field computed without it.

Each replay is re-simulated once; the comparisons run on every ``EVERY``-th tick for both players.
The Hypothesis machine of ``test_properties.py`` checks the first two on random states as well.
"""

import copy
from pathlib import Path
from typing import Final

import pytest

from gow_sim.maps import PLAYERS, load_map
from gow_sim.match import SIM_VERSION, Match
from gow_sim.replay import REPLAY_SUFFIX, replay_match
from gow_sim.ruleset import load_ruleset
from gow_sim.systems import flow
from gow_sim.view import PlayerView, enemy_figure_ids, project

TESTS = Path(__file__).resolve().parent
ROOT = TESTS.parents[2]
GOLDEN = TESTS / "golden" / f"v{SIM_VERSION}"
ARCHIVE = ROOT / "rulesets" / "archive"
MAPS = ROOT / "maps" / "fixtures"
REPLAYS = sorted(GOLDEN.glob(f"*{REPLAY_SUFFIX}"))
EVERY: Final = 17
"""Ticks between two comparisons (odd: the decisions of ``run_headless`` fall every 5 ticks)."""
FIELD_EVERY: Final = 151
"""Ticks between two comparisons of the flow field (a deep copy of the state each)."""


def _ids(view: PlayerView) -> tuple[int, ...]:
    return tuple(f.id for e in view.edges for f in e.enemy_groups)


class _Compare:
    """An observer of the re-simulation that compares the shortcuts with the full computation."""

    def __init__(self) -> None:
        self.views = 0
        self.figures = 0
        self.fields = 0

    def begin(self, match: Match) -> None:
        self.record(match, ())

    def record(self, match: Match, commands: object) -> None:
        del commands
        state, rules, key = match.state, match.rules, match.match_key
        if state.tick % EVERY == 0:
            for p in PLAYERS:
                full = project(state, rules, p, key)
                assert match.view(p, reuse=True) == full, (state.tick, p)
                ids = _ids(full)
                assert match.figures(p, reuse=True) == ids, (state.tick, p)
                assert enemy_figure_ids(state, rules, p, key) == ids, (state.tick, p)
                self.views += 1
                self.figures += len(ids)
        if rules.flow and state.tick % FIELD_EVERY == 0:
            for p in PLAYERS:
                kept, fresh = copy.deepcopy(state), copy.deepcopy(state)
                fresh.memo.clear()
                assert flow._field(kept, p) == flow._field(fresh, p), (state.tick, p)  # pyright: ignore[reportPrivateUsage]
                assert kept.players[p] == fresh.players[p]  # the clamp of the shift (item B3)
                self.fields += 1


QUICK: Final = "web-mvp4.jsonl.gz"
"""The replay of the quick run (the flow, fights and figures on edges); the others are ``slow``."""


@pytest.mark.parametrize(
    "path",
    [
        pytest.param(p, id=p.name, marks=() if p.name == QUICK else (pytest.mark.slow,))
        for p in REPLAYS
    ],
)
def test_shortcuts_equal_the_full_computation(path: Path) -> None:
    seen = _Compare()
    replay_match(path, ARCHIVE, MAPS, seen)
    assert seen.views > 0
    if "mvp4" in path.name:  # the flow and enemy figures on edges: the comparisons bite
        assert seen.figures > 0 and seen.fields > 0


def test_a_view_after_a_change_outside_a_step_is_computed_again() -> None:
    """``Match.view(reuse=True)`` reuses the sight of a step only at the tick of that step."""
    mapdef = load_map(MAPS / "web.json")
    match = Match(mapdef, load_ruleset(ROOT / "rulesets" / "mvp-4.toml"), bytes(range(32)))
    assert match._fresh(0) is None  # pyright: ignore[reportPrivateUsage]  # no step yet
    match.step()
    assert match._fresh(0) is not None  # pyright: ignore[reportPrivateUsage]
    match.state.tick += 1  # a state the last step did not see
    assert match._fresh(0) is None  # pyright: ignore[reportPrivateUsage]
