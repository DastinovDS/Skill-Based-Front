"""#1032: army upkeep of the smart bots (``gow_bots.bots.upkeep``, ``SmartBot`` item 30).

Expected values come from the rules: the start army of the map (public, ``start_units``), the
price of a recruit and of an order (``orders.cost``, DEC-25), the shots that take a node (DEC-07,
``shots_to_take``), a strike counted with its full bonus (DEC-41 item 10, ``strike_shots``), a
planned order that gathers in its node (DEC-41 item 10), a free cancel (DEC-20, C); and from the
step-4c plan of the owner (2026-11-13): below a floor a recruit comes before the shuffles, no
reinforcement unit by unit, a plan that will not take its target is called off, a small army
retakes with two units at least.
"""

import dataclasses
from pathlib import Path

import pytest

from gow_bots.bots import SmartExploiter, SmartReactive, SmartStrangler
from gow_bots.bots.defense import HIDDEN_STRIKE
from gow_bots.bots.upkeep import OPENING_PCT, floor
from gow_bots.bots.utility import shots_to_take
from gow_sim.commands import CancelOrder, Move, Recruit
from gow_sim.maps import MapDef, load_map
from gow_sim.match import Match
from gow_sim.ruleset import Ruleset, load_ruleset
from gow_sim.view import (
    AtNode,
    Detail,
    GroupView,
    IntentKind,
    IntentView,
    Mode,
    NodeView,
    OrderView,
    PlayerView,
    Sighting,
)

ROOT = Path(__file__).resolve().parents[3]
KEY = bytes(range(32))
TICK = 3000
LAST_OWN = 24
"""Crossroads split for the tests: nodes 0..24 are player 0's, 25..48 player 1's (no neutral)."""
START_ARMY = 16
"""The start units of a side on crossroads (``maps/crossroads.json``)."""


@pytest.fixture(scope="module")
def rules() -> Ruleset:
    return load_ruleset(ROOT / "rulesets" / "mvp-7.toml")


@pytest.fixture(scope="module")
def crossroads() -> MapDef:
    return load_map(ROOT / "maps" / "crossroads.json")


def _group(gid: int, node: int, units: int, charged: int) -> GroupView:
    return GroupView(gid, units, charged, Mode.ATTACK, AtNode(node), None)


def _settled(
    mapdef: MapDef,
    rules: Ruleset,
    groups: tuple[GroupView, ...],
    *,
    cp: int = 400,
    seen: dict[int, Sighting] | None = None,
    stock: dict[int, int] | None = None,
    owner: dict[int, int] | None = None,
    tick: int = TICK,
) -> PlayerView:
    """The view of player 0 on a crossroads without neutral nodes (the midgame)."""
    view = Match(mapdef, rules, KEY).view(0)
    nodes: list[NodeView] = []
    for n in view.nodes:
        o = (owner or {}).get(n.id, 0 if n.id <= LAST_OWN else 1)
        node = dataclasses.replace(n, owner=o, seen=(seen or {}).get(n.id))
        if stock is not None and n.id in stock:
            node = dataclasses.replace(node, warehouse=stock[n.id])
        nodes.append(node)
    return dataclasses.replace(
        view,
        tick=tick,
        me=dataclasses.replace(view.me, cp=cp),
        nodes=tuple(nodes),
        groups=groups,
        intents=(),
        fights=(),
    )


def _seen(charged: int, tick: int = TICK) -> Sighting:
    return Sighting(tick, Detail.EXACT, (Mode.ATTACK,), charged, charged)


def test_the_floor_follows_the_start_army_and_the_phase(crossroads: MapDef, rules: Ruleset) -> None:
    bot = SmartStrangler(crossroads, rules, seed=0, player=0)
    bot.decide(Match(crossroads, rules, KEY).view(0), 0)  # the opening: the neutrals last
    least = START_ARMY * bot.FLOOR_PCT // 100
    assert floor(bot) == least * OPENING_PCT // 100
    bot = SmartStrangler(crossroads, rules, seed=0, player=0)
    bot.decide(_settled(crossroads, rules, (_group(1, 0, 4, 4),)), TICK)
    assert floor(bot) == least
    assert bot.deficit == least - 4
    assert floor(SmartExploiter(crossroads, rules, seed=0, player=0)) == 0  # the benchmark


def test_below_the_floor_a_recruit_comes_before_a_rally(crossroads: MapDef, rules: Ruleset) -> None:
    # The capital keeps its guard; a charged stack stands in the rear (Middle Court, 7) with no
    # target in reach: it would rally to the front. One CP: below the floor it buys a recruit.
    move = rules.orders.cost.move
    assert rules.orders.cost.recruit == move
    groups = (_group(1, 0, 2, 2), _group(2, 7, 3, 3))
    bot = SmartStrangler(crossroads, rules, seed=0, player=0)
    bot.params = {**bot.params, "reserve": 0}
    cmds = bot.decide(_settled(crossroads, rules, groups, cp=move), TICK)
    assert bot.thin()
    assert Recruit(0) in cmds
    assert not any(isinstance(c, Move) and c.group == 2 for c in cmds)


def test_above_the_floor_the_recruit_keeps_its_cp(crossroads: MapDef, rules: Ruleset) -> None:
    move = rules.orders.cost.move
    groups = (
        _group(1, 0, 2, 2),
        _group(2, 7, 3, 3),
        _group(3, 4, 3, 3),
        _group(4, 1, 3, 3),
        _group(5, 6, 3, 3),
    )
    bot = SmartStrangler(crossroads, rules, seed=0, player=0)
    bot.params = {**bot.params, "reserve": 0}
    cmds = bot.decide(_settled(crossroads, rules, groups, cp=move), TICK)
    assert not bot.thin()
    assert Recruit(0) not in cmds


def test_a_strike_the_sum_cannot_hold_gets_no_unit_by_unit_reinforcement(
    crossroads: MapDef, rules: Ruleset
) -> None:
    # Millstead (18, plains) holds 1 charged unit; 5 charged units are seen in South Outpost (25):
    # a strike of 10 shots with the full bonus. The helper in Flint (13, 2 charged) with the
    # picket cannot hold it, so ``smart_reactive`` (it answered every strike with the nearest
    # group before #1032) sends no unit in.
    target, origin, helper = 18, 25, 13
    terrain = crossroads.nodes[target].terrain
    assert shots_to_take(rules, terrain, 3, 3) <= 2 * 5
    groups = (_group(1, 0, 2, 2), _group(2, target, 1, 1), _group(3, helper, 2, 2))
    view = _settled(crossroads, rules, groups, seen={origin: _seen(5)})
    strike = IntentView(77, 1, IntentKind.PLANNED_MOVE, origin, target, TICK - 5)
    view = dataclasses.replace(view, intents=(strike,))
    bot = SmartReactive(crossroads, rules, seed=0, player=0)
    cmds = bot.decide(view, TICK)
    assert Move(3, target) not in cmds


def test_a_strike_from_an_origin_that_looks_empty_counts_as_a_squad(
    crossroads: MapDef, rules: Ruleset
) -> None:
    # The strike's origin (South Outpost, 25) is seen without a charged enemy: the plan gathers
    # there all the same. Before #1032 it counted 2 shots and the helper walked in; now it counts
    # ``HIDDEN_STRIKE`` charged units with their bonus, which the picket and the helper do not hold.
    target, origin, helper = 18, 25, 13
    terrain = crossroads.nodes[target].terrain
    assert shots_to_take(rules, terrain, 3, 3) > 2
    assert shots_to_take(rules, terrain, 3, 3) <= 2 * HIDDEN_STRIKE
    groups = (_group(1, 0, 2, 2), _group(2, target, 1, 1), _group(3, helper, 2, 2))
    empty = Sighting(TICK, Detail.EXACT, (), None, None)
    view = _settled(crossroads, rules, groups, seen={origin: empty})
    strike = IntentView(79, 1, IntentKind.PLANNED_MOVE, origin, target, TICK - 5)
    view = dataclasses.replace(view, intents=(strike,))
    bot = SmartStrangler(crossroads, rules, seed=0, player=0)
    assert Move(3, target) not in bot.decide(view, TICK)


def test_two_strikes_at_one_node_are_weighed_together(crossroads: MapDef, rules: Ruleset) -> None:
    # Two charged units seen in South Outpost (25) and in Bend's enemy neighbour 29 aim at
    # Millstead (18): 4 shots each, 8 together. The picket and the helper hold one, not both.
    target, helper = 18, 13
    terrain = crossroads.nodes[target].terrain
    assert 4 < shots_to_take(rules, terrain, 3, 3) <= 8
    groups = (_group(1, 0, 2, 2), _group(2, target, 1, 1), _group(3, helper, 2, 2))
    view = _settled(crossroads, rules, groups, seen={25: _seen(2), 29: _seen(2)})
    strikes = (
        IntentView(80, 1, IntentKind.PLANNED_MOVE, 25, target, TICK - 5),
        IntentView(81, 1, IntentKind.PLANNED_MOVE, 29, target, TICK - 5),
    )
    view = dataclasses.replace(view, intents=strikes)
    bot = SmartStrangler(crossroads, rules, seed=0, player=0)
    assert Move(3, target) not in bot.decide(view, TICK)


def test_a_gathering_plan_the_target_now_beats_is_called_off(
    crossroads: MapDef, rules: Ruleset
) -> None:
    # A planned attack of 2 charged units asks for a bonus of 2 in Millstead (18) on South
    # Outpost (25); the enemy is seen there now with 6 charged units: 4 shots against a pool of
    # 6 lose the group. The cancel is free (DEC-20, C).
    order = OrderView(25, (25,), True, None, bonus=1, gathering=True, plan=2)
    plan = GroupView(2, 2, 2, Mode.ATTACK, AtNode(18), order)
    groups = (_group(1, 0, 2, 2), plan)
    seen = {25: Sighting(TICK, Detail.EXACT, (Mode.ATTACK,), 6, 6)}
    view = _settled(crossroads, rules, groups, seen=seen)
    assert rules.orders.cost.cancel == 0
    bot = SmartStrangler(crossroads, rules, seed=0, player=0)
    assert CancelOrder(2) in bot.decide(view, TICK)


def test_a_small_army_retakes_with_two_units_at_least(crossroads: MapDef, rules: Ruleset) -> None:
    # Bend (22) falls empty; one charged unit stands next to it in Glade (17): it would walk in.
    groups = (_group(1, 0, 2, 2), _group(2, 17, 1, 1))
    empty = Sighting(TICK + 5, Detail.EXACT, (), None, None)
    bot = SmartStrangler(crossroads, rules, seed=0, player=0)
    bot.decide(_settled(crossroads, rules, groups), TICK)
    later = _settled(crossroads, rules, groups, owner={22: 1}, seen={22: empty}, tick=TICK + 5)
    cmds = bot.decide(later, TICK + 5)
    assert bot.thin() and 22 in bot.defense.lost
    assert Move(2, 22) not in cmds
