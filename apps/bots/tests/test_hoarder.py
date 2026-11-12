"""#624: the benchmark ``smart_hoarder`` and the converging strike of ``SmartBot`` (item 12).

Expected values come from the rules and the map: the travel time of mechanics.md, section 4
("Speed by terrain by zones"), a plan that gathers one bonus at least (DEC-41, item 10), the
prices of DEC-08, ``shots_to_take`` of DEC-07, the capacities of DEC-22 and the owner's strike in
``docs/balance/playtest-2026-10-30.md`` (the stage Middle Court next to the bot capital, the
centre Crossroads).
"""

import dataclasses
from pathlib import Path
from typing import ClassVar

import pytest

from gow_bots.bots import BOTS, SmartHoarder, bot_factory
from gow_bots.bots.campaign import Ctx
from gow_bots.bots.smart import SmartBot
from gow_bots.bots.travel import edge_ticks
from gow_bots.bots.utility import shots_to_take
from gow_sim.commands import Split
from gow_sim.maps import MapDef, load_map
from gow_sim.match import Match, run_headless
from gow_sim.ruleset import Ruleset, load_ruleset
from gow_sim.state import AtNode
from gow_sim.systems.movement import traversal_ticks

ROOT = Path(__file__).resolve().parents[3]
KEY = bytes(range(32))


@pytest.fixture(scope="module")
def rules() -> Ruleset:
    return load_ruleset(ROOT / "rulesets" / "mvp-7.toml")


@pytest.fixture(scope="module")
def crossroads() -> MapDef:
    return load_map(ROOT / "maps" / "crossroads.json")


def _named(mapdef: MapDef, name: str) -> int:
    return next(n.id for n in mapdef.nodes if n.name == name)


def test_the_hoarder_is_registered_with_its_params_in_range(
    crossroads: MapDef, rules: Ruleset
) -> None:
    assert BOTS["smart_hoarder"] is SmartHoarder
    assert SmartHoarder.STRIKE and not SmartBot.STRIKE
    for seed in range(10):
        bot = SmartHoarder(crossroads, rules, seed=seed, player=seed % 2)
        for key, r in SmartHoarder.PARAMS.items():
            assert r.low <= bot.params[key] <= r.high
    assert isinstance(
        bot_factory("smart_hoarder@easy")(crossroads, rules, seed=0, player=0), SmartHoarder
    )


def test_stage_and_centre_on_crossroads(crossroads: MapDef, rules: Ruleset) -> None:
    # Side 1 (Core) stages in Middle Court next to Nexus, the owner's stage; side 0 in its
    # mirror. The centre is Crossroads for both (the large city at 4 hops from either capital).
    human = SmartHoarder(crossroads, rules, seed=0, player=1)
    assert human.stage == _named(crossroads, "Middle Court")
    assert human.centre == _named(crossroads, "Crossroads")
    bot = SmartHoarder(crossroads, rules, seed=0, player=0)
    assert bot.stage == crossroads.mirror_nodes[human.stage]
    assert bot.centre == human.centre == crossroads.mirror_nodes[human.centre]
    assert crossroads.nodes[human.stage].kind.value == "city_large"


def test_edge_ticks_is_the_travel_time_of_the_rules(crossroads: MapDef, rules: Ruleset) -> None:
    for e, edge in enumerate(crossroads.edges):
        for to in (edge.a, edge.b):
            assert edge_ticks(crossroads, rules, e, to) == traversal_ticks(crossroads, rules, e, to)


def test_way_follows_the_fastest_own_path(crossroads: MapDef, rules: Ruleset) -> None:
    view = Match(crossroads, rules, KEY).view(1)
    bot = SmartHoarder(crossroads, rules, seed=0, player=1)
    home = crossroads.capital(1)
    for e in crossroads.incident[home]:
        other = crossroads.edges[e].other(home)
        # A neutral neighbour ends the path: one edge.
        assert bot.way(view, home, other, 1) == (1, edge_ticks(crossroads, rules, e, other))
    # The enemy capital is beyond neutral nodes: no own path reaches it at the start.
    assert bot.way(view, home, crossroads.capital(0), 1) is None


@pytest.mark.parametrize("player", [0, 1])
def test_a_split_keeps_the_cp_of_the_move_of_its_part(
    crossroads: MapDef, rules: Ruleset, player: int
) -> None:
    """#754 (G-H): a split is free (``orders.cost.split``) and its part walks in the next
    decision; the hoarder splits only while the CP outside the kept ones pay that move
    (``orders.cost.move``), and leaves them unspent, so the part is not merged back unmoved."""
    view = Match(crossroads, rules, KEY).view(player)
    bot = SmartHoarder(crossroads, rules, seed=0, player=player)
    home = next(g for g in view.groups if g.location == AtNode(crossroads.capital(player)))
    move, split = rules.orders.cost.move, Split(home.id, 1)
    assert rules.orders.cost.split == 0
    ctx = Ctx(view, 0, move, standing=bot.standing(view))
    assert bot.spend(ctx, split)
    assert ctx.cmds == [split]
    assert ctx.budget == 0  # the move of the part is kept
    held = Ctx(view, 0, move, standing=bot.standing(view), held=1)
    assert not bot.spend(held, split)  # the kept CP leave less than a move
    assert held.cmds == []
    broke = Ctx(view, 0, move - 1, standing=bot.standing(view))
    assert not bot.spend(broke, split)


def test_an_unseen_capital_counts_the_guessed_garrison(crossroads: MapDef, rules: Ruleset) -> None:
    view = Match(crossroads, rules, KEY).view(1)
    bot = SmartHoarder(crossroads, rules, seed=0, player=1)
    bot.decide(view, 0)
    ctx = Ctx(view, 0, view.me.cp, standing=bot.standing(view))
    guess = bot.params["strike_guess"]
    terrain = crossroads.nodes[crossroads.capital(0)].terrain
    expected = shots_to_take(rules, terrain, guess, guess) + bot.params["strike_margin"]
    assert bot.strike_need(ctx) == expected


def test_a_far_small_group_of_a_strike_goes_planned(crossroads: MapDef, rules: Ruleset) -> None:
    bot = SmartHoarder(crossroads, rules, seed=0, player=1)
    view = Match(crossroads, rules, KEY).view(1)
    g = next(iter(view.groups))
    two = dataclasses.replace(g, units=2, charged=2)
    # DEC-41, item 10: a group that can gather a bonus from its warehouse goes planned.
    assert bot.plan_strike(two, 3, 2, bonus=1)
    assert not bot.plan_strike(two, 3, 2, bonus=0)


def _mirrored(cls: type[SmartBot]) -> type[SmartBot]:
    class Mirrored(cls):
        name: ClassVar[str] = cls.name

        def __init__(self, mapdef: MapDef, rules: Ruleset, *, seed: int, player: int) -> None:
            super().__init__(mapdef, rules, seed=seed, player=player)
            twin = cls(mapdef, rules, seed=seed, player=0)
            self.params, self.rng = twin.params, twin.rng

    return Mirrored


def test_hoarder_self_play_is_a_draw(crossroads: MapDef, rules: Ruleset) -> None:
    # Mirror-invariant: the stage, the centre, the strike timing and every tie-break by
    # ``node_key``; nothing but the opaque ids differs between the sides.
    cls = _mirrored(SmartHoarder)
    bots = [cls(crossroads, rules, seed=3, player=p) for p in (0, 1)]
    result = run_headless(crossroads, rules, bots)
    assert result.vp[0] == result.vp[1]
    assert result.accepted[0] == result.accepted[1]


def test_strike_groups_are_committed_and_kept_in_the_fight(
    crossroads: MapDef, rules: Ruleset
) -> None:
    bot = SmartHoarder(crossroads, rules, seed=0, player=1)
    bot.strike_sent[7] = 100
    assert bot.committed(7) and not bot.committed(8)
    plain = bot_factory("smart_expander")(crossroads, rules, seed=0, player=1)
    assert isinstance(plain, SmartBot) and not plain.committed(7)
