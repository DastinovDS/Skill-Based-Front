"""BOT-01: the controller interface, the baseline bots, seed variability and the shared utility
«обычный или запланированный приказ».

Expected fight numbers come from the DEC-07 table of mechanics.md, section 4 (example numbers in
the comments); prices from ``rulesets/mvp-0.toml`` (DEC-08, DEC-02).
"""

import dataclasses
import os
import subprocess
import sys
from pathlib import Path
from typing import ClassVar

import pytest

from gow_bots.bots import (
    BOTS,
    IdleBot,
    ParamRange,
    RandomLegalBot,
    choose_params,
    prefer_planned,
    shots_to_take,
)
from gow_sim.maps import MapDef, Terrain
from gow_sim.match import Controller, Match, run_headless
from gow_sim.ruleset import Ruleset

ROOT = Path(__file__).resolve().parents[3]
MVP_MAPS = ("arteriya", "pautina", "pereval")

FOREST, PLAINS, MOUNTAINS = Terrain.FOREST, Terrain.PLAINS, Terrain.MOUNTAINS


def _pair(name: str, mapdef: MapDef, rules: Ruleset, seed: int) -> list[Controller]:
    return [BOTS[name](mapdef, rules, seed=seed, player=p) for p in (0, 1)]


# Parameters from the seed ------------------------------------------------------------------------


def test_params_are_a_function_of_name_seed_and_side() -> None:
    ranges = {"a": ParamRange(0, 1000), "b": ParamRange(3, 3)}
    first = choose_params("x", 7, 0, ranges)
    assert first == choose_params("x", 7, 0, ranges)
    assert first["b"] == 3 and 0 <= first["a"] <= 1000
    others = {choose_params("x", seed, 0, ranges)["a"] for seed in range(50)}
    assert len(others) > 25  # different seeds, different bots
    assert choose_params("x", 7, 1, ranges) != first or choose_params("y", 7, 0, ranges) != first


def test_empty_range_is_rejected() -> None:
    with pytest.raises(ValueError, match="empty range"):
        ParamRange(2, 1)


def test_bot_params_stay_in_their_ranges(maps: dict[str, MapDef], mvp_rules: Ruleset) -> None:
    mapdef = maps["pautina"]
    for seed in range(20):
        bot = RandomLegalBot(mapdef, mvp_rules, seed=seed, player=1)
        for key, r in RandomLegalBot.PARAMS.items():
            assert r.low <= bot.params[key] <= r.high


# The shared utility --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("terrain", "units", "charged", "defense", "need"),
    [
        (FOREST, 2, 2, False, 4),  # example 3: 4 charged take 2 charged defenders
        (FOREST, 0, 0, False, 0),  # example 5: an empty node falls without a fight
        (PLAINS, 2, 2, False, 3),  # example 8: Qd = 1, 2 charged are not enough
        (MOUNTAINS, 2, 2, False, 5),  # example 6: Qd = 3, 3 charged bounce
        (MOUNTAINS, 3, 0, False, 3),  # example 7: no firing charge, no terrain
        (FOREST, 2, 2, True, 6),  # example 10: Qd = 4 with «Защита»
        (FOREST, 2, 0, True, 2),  # example 16: «Защита» needs a firing charge
    ],
)
def test_shots_to_take_follows_dec07(
    mvp_rules: Ruleset, terrain: Terrain, units: int, charged: int, defense: bool, need: int
) -> None:
    assert shots_to_take(mvp_rules, terrain, units, charged, defense) == need


def test_planned_order_pays_when_the_bonus_turns_a_bounce_into_a_capture(
    mvp_rules: Ruleset,
) -> None:
    # Example 9: 2 charged + plan (+2) take 2 charged defenders in a forest (need 4).
    assert prefer_planned(mvp_rules, own_charged=2, need=4)


def test_planned_order_does_not_pay_for_shots_worth_its_surcharge(mvp_rules: Ruleset) -> None:
    # mvp-0: the plan costs 1 CP more (200 - 100) and its 2 shots are worth 1 CP (2 charges/CP).
    assert not prefer_planned(mvp_rules, own_charged=4, need=4)  # wins anyway
    assert not prefer_planned(mvp_rules, own_charged=1, need=10)  # bounces anyway
    assert not prefer_planned(mvp_rules, own_charged=3, need=0)  # an empty node


def test_share_of_plans_follows_the_price(mvp_rules: Ruleset) -> None:
    cost = mvp_rules.orders.cost
    cheap = dataclasses.replace(
        mvp_rules,
        orders=dataclasses.replace(
            mvp_rules.orders, cost=dataclasses.replace(cost, planned_move=cost.move + 50)
        ),
    )
    assert prefer_planned(cheap, own_charged=4, need=4)
    dear = dataclasses.replace(
        mvp_rules,
        orders=dataclasses.replace(
            mvp_rules.orders, cost=dataclasses.replace(cost, planned_move=cost.move + 500)
        ),
    )
    assert not prefer_planned(dear, own_charged=2, need=4)


# Baseline bots ---------------------------------------------------------------------------------


def test_idle_bot_sends_nothing(maps: dict[str, MapDef], mvp_rules: Ruleset) -> None:
    mapdef = maps["arteriya"]
    result = run_headless(mapdef, mvp_rules, _pair("idle", mapdef, mvp_rules, 0), max_ticks=200)
    assert result.accepted == result.rejected == (0, 0)


def test_bot_refuses_the_view_of_the_other_side(
    maps: dict[str, MapDef], mvp_rules: Ruleset
) -> None:
    mapdef = maps["arteriya"]
    match = Match(mapdef, mvp_rules, bytes(range(32)))
    with pytest.raises(ValueError, match="player 0"):
        IdleBot(mapdef, mvp_rules, seed=0, player=0).decide(match.view(1), 0)


@pytest.mark.parametrize("name", MVP_MAPS)
def test_random_legal_full_match_on_mvp_maps(
    maps: dict[str, MapDef], name: str, mvp_rules: Ruleset
) -> None:
    mapdef = maps[name]
    result = run_headless(mapdef, mvp_rules, _pair("random_legal", mapdef, mvp_rules, 1))
    assert result.outcome is not None
    assert result.ticks <= mvp_rules.match_ticks
    assert min(result.accepted) > 10  # both sides did play
    assert sum(result.rejected) * 10 <= sum(result.accepted)  # the commands are legal


def test_one_bot_pair_over_100_seeds_gives_at_least_30_final_hashes(
    maps: dict[str, MapDef], short_rules: Ruleset
) -> None:
    # Full matches on test-short (mvp-0 with a 60 s timer) to keep the test fast.
    mapdef = maps["pautina"]
    hashes = {
        run_headless(mapdef, short_rules, _pair("random_legal", mapdef, short_rules, s)).state_hash
        for s in range(100)
    }
    assert len(hashes) >= 30


class _MirroredRandom(RandomLegalBot):
    """Both sides draw the parameters and choices of side 0: mirrored decisions."""

    name: ClassVar[str] = "random_legal"

    def __init__(self, mapdef: MapDef, rules: Ruleset, *, seed: int, player: int) -> None:
        super().__init__(mapdef, rules, seed=seed, player=player)
        twin = RandomLegalBot(mapdef, rules, seed=seed, player=0)
        self.params, self.rng = twin.params, twin.rng


@pytest.mark.parametrize("name", MVP_MAPS)
def test_tie_breaks_are_mirror_invariant(
    maps: dict[str, MapDef], name: str, short_rules: Ruleset
) -> None:
    # The same bot on both sides of a symmetric map: nothing but opaque ids differs, so a
    # tie-break by opaque id would break the symmetry of the result.
    mapdef = maps[name]
    for seed in range(5):
        bots = [_MirroredRandom(mapdef, short_rules, seed=seed, player=p) for p in (0, 1)]
        result = run_headless(mapdef, short_rules, bots)
        assert result.vp[0] == result.vp[1]
        assert result.accepted[0] == result.accepted[1]
        assert result.outcome is not None and result.outcome.winner is None


def test_match_is_the_same_in_fresh_processes() -> None:
    script = (
        "import sys\n"
        "from gow_sim.maps import load_map\n"
        "from gow_sim.match import run_headless\n"
        "from gow_sim.ruleset import load_ruleset\n"
        "from gow_bots.bots import BOTS\n"
        "m = load_map(sys.argv[1]); r = load_ruleset(sys.argv[2])\n"
        "bots = [BOTS['random_legal'](m, r, seed=42, player=p) for p in (0, 1)]\n"
        "print(run_headless(m, r, bots).state_hash)\n"
    )
    args = [str(ROOT / "maps" / "pereval.json"), str(ROOT / "rulesets" / "test-short.toml")]
    outputs = {
        subprocess.run(
            [sys.executable, "-c", script, *args],
            env={**os.environ, "PYTHONHASHSEED": seed},
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        for seed in ("0", "1", "4242")
    }
    assert len(outputs) == 1
