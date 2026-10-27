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
    ReactiveBot,
    choose_params,
    prefer_planned,
    shots_to_take,
)
from gow_sim.commands import CancelOrder
from gow_sim.maps import MapDef, Terrain, parse_map
from gow_sim.match import Controller, Match, run_headless
from gow_sim.ruleset import Ruleset
from gow_sim.state import AtNode, Group, Mode, OnEdge, Order, initial_state
from gow_sim.systems.combat import combat
from gow_sim.systems.movement import leg, movement
from gow_sim.view import PlayerView, project

ROOT = Path(__file__).resolve().parents[3]
MVP_MAPS = ("artery", "web", "pass")

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
    mapdef = maps["web"]
    for seed in range(20):
        bot = RandomLegalBot(mapdef, mvp_rules, seed=seed, player=1)
        for key, r in RandomLegalBot.PARAMS.items():
            assert r.low <= bot.params[key] <= r.high


# The shared utility --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("terrain", "units", "charged", "defense", "need"),
    [
        (FOREST, 2, 2, 0, 4),  # example 3: 4 charged take 2 charged defenders
        (FOREST, 0, 0, 0, 0),  # example 5: an empty node falls without a fight
        (PLAINS, 2, 2, 0, 3),  # example 8: Qd = 1, 2 charged are not enough
        (MOUNTAINS, 2, 2, 0, 5),  # example 6: Qd = 3, 3 charged bounce
        (MOUNTAINS, 3, 0, 0, 3),  # example 7: no firing charge, no terrain
        (FOREST, 2, 2, 2, 6),  # example 10: Qd = 4 with «Защита» (+2 gathered, DEC-30)
        (FOREST, 2, 0, 2, 2),  # example 16: «Защита» needs a firing charge
        (FOREST, 2, 2, 10, 6),  # DEC-30, item 2: the bonus is capped by the 2 charged
    ],
)
def test_shots_to_take_follows_dec07(
    mvp_rules: Ruleset, terrain: Terrain, units: int, charged: int, defense: int, need: int
) -> None:
    assert shots_to_take(mvp_rules, terrain, units, charged, defense) == need


def test_planned_order_pays_when_the_bonus_turns_a_bounce_into_a_capture(
    mvp_rules: Ruleset,
) -> None:
    # Example 9: 2 charged + plan (+2: two edges away, DEC-29) take 2 charged defenders in a
    # forest (need 4).
    assert prefer_planned(mvp_rules, own_charged=2, need=4, edges=2)


def test_planned_bonus_grows_with_the_distance(mvp_rules: Ruleset) -> None:
    # DEC-29: a neighbour gives +1, which leaves 2 + 1 short of 4: no capture, and 1 shot is
    # worth half the surcharge; two edges give +2 and the capture.
    assert not prefer_planned(mvp_rules, own_charged=2, need=4, edges=1)
    assert prefer_planned(mvp_rules, own_charged=2, need=4, edges=2)
    # The cap: 1 charged unit gets +1 on any distance (example 4), too little for need 3.
    assert not prefer_planned(mvp_rules, own_charged=1, need=3, edges=3)


def test_planned_order_does_not_pay_for_shots_worth_its_surcharge(mvp_rules: Ruleset) -> None:
    # mvp-0: the plan costs 1 CP more (200 - 100) and 2 shots are worth 1 CP (2 charges/CP).
    assert not prefer_planned(mvp_rules, own_charged=4, need=4, edges=2)  # wins anyway
    assert not prefer_planned(mvp_rules, own_charged=1, need=10, edges=2)  # bounces anyway
    assert not prefer_planned(mvp_rules, own_charged=3, need=0, edges=2)  # an empty node


def test_share_of_plans_follows_the_price(mvp_rules: Ruleset) -> None:
    cost = mvp_rules.orders.cost
    cheap = dataclasses.replace(
        mvp_rules,
        orders=dataclasses.replace(
            mvp_rules.orders, cost=dataclasses.replace(cost, planned_move=cost.move + 50)
        ),
    )
    assert prefer_planned(cheap, own_charged=4, need=4, edges=2)
    dear = dataclasses.replace(
        mvp_rules,
        orders=dataclasses.replace(
            mvp_rules.orders, cost=dataclasses.replace(cost, planned_move=cost.move + 500)
        ),
    )
    assert not prefer_planned(dear, own_charged=2, need=4, edges=2)


# Baseline bots ---------------------------------------------------------------------------------


def test_idle_bot_sends_nothing(maps: dict[str, MapDef], mvp_rules: Ruleset) -> None:
    mapdef = maps["artery"]
    result = run_headless(mapdef, mvp_rules, _pair("idle", mapdef, mvp_rules, 0), max_ticks=200)
    assert result.accepted == result.rejected == (0, 0)


def test_bot_refuses_the_view_of_the_other_side(
    maps: dict[str, MapDef], mvp_rules: Ruleset
) -> None:
    mapdef = maps["artery"]
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


@pytest.mark.slow  # 100 full matches on test-short
def test_one_bot_pair_over_100_seeds_gives_at_least_30_final_hashes(
    maps: dict[str, MapDef], short_rules: Ruleset
) -> None:
    # Full matches on test-short (mvp-0 with a 60 s timer) to keep the test fast.
    mapdef = maps["web"]
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
    args = [
        str(ROOT / "maps" / "fixtures" / "pass.json"),
        str(ROOT / "rulesets" / "test-short.toml"),
    ]
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


# Fights over time (DEC-24, item K) ----------------------------------------------------------------


class _Rejects:
    """A ``MatchObserver`` that counts reject codes and fights."""

    def __init__(self) -> None:
        self.codes: dict[str, int] = {}
        self.fights = 0
        self.withdrawals = 0

    def begin(self, match: Match) -> None:
        del match

    def record(self, match: Match, commands: object) -> None:
        del commands
        for r in match.results:
            code = getattr(r.outcome, "code", None)
            if code is not None:
                self.codes[code.value] = self.codes.get(code.value, 0) + 1
        for e in match.state.events:
            self.fights += e.kind == "fight_started"
            self.withdrawals += e.kind == "fight_group" and e.get("left") is True


@pytest.mark.parametrize(("a", "b"), [("rusher", "reactive"), ("expander", "strangler")])
def test_bots_fight_without_in_fight_rejects(
    maps: dict[str, MapDef], mvp_rules: Ruleset, a: str, b: str
) -> None:
    """Groups in a fight get only withdrawals (IN_FIGHT never comes back); fights happen."""
    mapdef = maps["web"]
    seen = _Rejects()
    bots = [
        BOTS[a](mapdef, mvp_rules, seed=1, player=0),
        BOTS[b](mapdef, mvp_rules, seed=1, player=1),
    ]
    result = run_headless(mapdef, mvp_rules, bots, observer=seen)
    assert result.outcome is not None
    assert seen.fights > 0
    assert seen.codes.get("IN_FIGHT", 0) == 0


# The bonus stock of a fight (DEC-32, item 8) ---------------------------------------------------


def _attack_into_a_fight(rules: Ruleset, enemy_bonus: int) -> tuple[PlayerView, ReactiveBot]:
    """Player 0's 2/2 arrives in node 1 of the line ``0 - 1 - 2`` and fights player 1's 2/2 there
    (row 1 of the table); the defender has ``enemy_bonus`` virtual shots left."""
    nodes = [
        {
            "id": i,
            "name": f"n{i}",
            "x": 10 * i,
            "y": 10,
            "terrain": "forest",
            "vp": 1,
            "kind": "capital" if i != 1 else "city_large",
            "capital_of": {0: 0, 2: 1}.get(i),
            "start_owner": 0 if i == 0 else 1,
            "start_units": 0,
            "start_charged": 0,
            "start_stock": 0,
        }
        for i in range(3)
    ]
    edges = [
        {"id": i, "a": i, "b": i + 1, "max_level": 3, "travel_ticks": 30, "border_permille": 500}
        for i in range(2)
    ]
    mirror = {"nodes": {"0": 2, "1": 1, "2": 0}, "edges": {"0": 1, "1": 0}}
    meta = {"name": "l", "version": 1, "symmetry": "rot180", "width": 100, "height": 20}
    mapdef = parse_map({"meta": meta, "nodes": nodes, "edges": edges, "mirror": mirror})
    state = initial_state(mapdef, rules)
    state.groups[0] = Group(0, 1, 2, 2, Mode.ATTACK, AtNode(1))
    way = leg(mapdef, rules, 0, 1)
    there = OnEdge(0, 0, way.progress(way.ticks - 1))
    state.groups[1] = Group(1, 0, 2, 2, Mode.ATTACK, there, order=Order((1,), False, 0))
    state.next_id = 2
    state.tick = 1
    state.events = movement(state, rules)  # ``combat`` reads the arrivals of the tick
    state.events += combat(state, rules)
    (fight,) = state.fights.values()
    fight.virtual = (0, enemy_bonus)
    bot = ReactiveBot(mapdef, rules, seed=1, player=0)
    return project(state, rules, 0, b"k" * 32), bot


@pytest.mark.parametrize(("enemy_bonus", "withdraws"), [(0, False), (2, True)])
def test_a_bot_counts_the_visible_bonus_stock_of_a_fight(
    mvp_rules: Ruleset, enemy_bonus: int, withdraws: bool
) -> None:
    """DEC-32, item 8: the stock of a side is its charged units plus its bonus still left. 2/2
    against 2/2 is even, the attacker stays; with 2 bonus shots of the enemy left it is lost
    (every round costs a unit), and the attacker cancels (free, DEC-20)."""
    view, bot = _attack_into_a_fight(mvp_rules, enemy_bonus)
    (fight,) = view.fights
    assert fight.virtual_left == (0, enemy_bonus)
    cmds = bot.fight_commands(view, view.tick, budget=10_000)
    assert cmds == ([CancelOrder(fight.groups[0])] if withdraws else [])
