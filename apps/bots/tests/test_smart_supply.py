"""#166, PR 2: arrivals, recruit queues, scouting and the engagement zone of the smart bots.

Expected values come from the rules: the travel time ``travel_ticks * 100 // speed`` by the
terrain of the zone (mechanics.md, section 4), the engagement zone ``combat.engage_ticks``
(DEC-37), a plan that gathers one bonus at least (DEC-41, item 10), the loss of the queue with a
city (DEC-25, item 10), vision from own groups only (DEC-35).
"""

import dataclasses

from gow_bots.bots import SmartRusher, SmartStrangler
from gow_bots.bots.assess import Travel
from gow_bots.bots.campaign import Ctx
from gow_bots.bots.logistics import Arrival, arrivals, figure_ticks
from gow_sim.commands import CancelRecruit, Command, Move, Recruit, Split
from gow_sim.maps import MapDef
from gow_sim.match import Match
from gow_sim.ruleset import Ruleset
from gow_sim.view import (
    AtNode,
    Detail,
    EnemyGroupView,
    GroupView,
    IntentKind,
    IntentView,
    Mode,
    PlayerView,
)

KEY = bytes(range(32))


def _start(mapdef: MapDef, rules: Ruleset) -> PlayerView:
    return Match(mapdef, rules, KEY).view(0)


def _node(view: PlayerView, node: int, **changes: object) -> PlayerView:
    nodes = list(view.nodes)
    nodes[node] = dataclasses.replace(nodes[node], **changes)  # pyright: ignore[reportArgumentType]
    return dataclasses.replace(view, nodes=tuple(nodes))


def _figure(view: PlayerView, edge: int, figure: EnemyGroupView) -> PlayerView:
    edges = list(view.edges)
    edges[edge] = dataclasses.replace(edges[edge], enemy_groups=(figure,))
    return dataclasses.replace(view, edges=tuple(edges))


def _groups(view: PlayerView, groups: list[GroupView]) -> PlayerView:
    return dataclasses.replace(view, groups=tuple(groups))


def _border(mapdef: MapDef, view: PlayerView) -> tuple[int, int, int]:
    """An own city other than the capital with a garrison and a road to a node that is not own:
    ``(edge, city, other end)``, the lowest edge id."""
    capital = mapdef.capital(0)
    held = {g.location.node for g in view.groups if isinstance(g.location, AtNode)}
    for e, edef in enumerate(mapdef.edges):
        for city, other in ((edef.a, edef.b), (edef.b, edef.a)):
            if (
                city != capital
                and city in held
                and view.nodes[city].owner == 0
                and view.nodes[other].owner != 0
            ):
                return e, city, other
    raise AssertionError("no border city")


def _toward(mapdef: MapDef, edge: int, node: int, left: int, units: int) -> EnemyGroupView:
    """An enemy figure on ``edge`` heading to ``node`` with ``left`` thousandths of it to go."""
    toward_b = mapdef.edges[edge].b == node
    pos = 1000 - left if toward_b else left
    return EnemyGroupView(9, pos, toward_b, Detail.EXACT, Mode.ATTACK, units, units, None)


def _zone_ticks(mapdef: MapDef, rules: Ruleset, edge: int, node: int, left: int) -> int:
    """mechanics.md, section 4: ``travel_ticks * 100 // speed`` for the part ``left`` of the
    edge in the zone of ``node``."""
    speed = rules.terrain.speed_pct.of(mapdef.nodes[node].terrain)
    return mapdef.edges[edge].travel_ticks * 100 * left // (speed * 1000)


def _moves_from(cmds: list[Command], view: PlayerView, node: int) -> list[Command]:
    here = {g.id for g in view.groups if g.location == AtNode(node)}
    return [c for c in cmds if isinstance(c, (Move, Split)) and c.group in here]


# Logistics -----------------------------------------------------------------------------------


def test_a_figure_heading_into_an_own_node_arrives_by_the_zone_speed(
    maps: dict[str, MapDef], mvp_rules: Ruleset
) -> None:
    mapdef = maps["web"]
    view = _start(mapdef, mvp_rules)
    edge, city, other = _border(mapdef, view)
    f = _toward(mapdef, edge, city, 500, 4)
    seen = _figure(view, edge, f)
    expected = _zone_ticks(mapdef, mvp_rules, edge, city, 500)
    assert figure_ticks(seen, mapdef, mvp_rules, edge, f) == expected
    travel = Travel(mapdef, mvp_rules)
    assert arrivals(seen, mapdef, mvp_rules, travel, 3) == {city: Arrival(view.tick + expected, 4)}
    # Heading away, into the node that is not own: no arrival into an own node.
    away = _figure(view, edge, _toward(mapdef, edge, other, 500, 4))
    assert arrivals(away, mapdef, mvp_rules, travel, 3) == {}


def test_a_planned_strike_arrives_after_one_bonus_with_the_guess(
    maps: dict[str, MapDef], mvp_rules: Ruleset
) -> None:
    mapdef = maps["web"]
    view = _start(mapdef, mvp_rules)
    _, city, other = _border(mapdef, view)
    strike = IntentView(5, 1, IntentKind.PLANNED_MOVE, other, city, 0)
    travel = Travel(mapdef, mvp_rules)
    found = arrivals(dataclasses.replace(view, intents=(strike,)), mapdef, mvp_rules, travel, 3)
    delay = mvp_rules.orders.plan_ticks_per_bonus  # it gathers one bonus at least (DEC-41)
    assert found == {city: Arrival(delay + travel.ticks[other][city], 3)}


# DEC-37: the engagement zone ------------------------------------------------------------------


def test_a_group_does_not_leave_a_node_the_enemy_enters_within_the_zone(
    maps: dict[str, MapDef], mvp_rules: Ruleset
) -> None:
    mapdef = maps["web"]
    view = _start(mapdef, mvp_rules)
    edge, city, _ = _border(mapdef, view)
    window = mvp_rules.combat.engage_ticks + 1  # the order applies in the next tick
    left = 1
    while _zone_ticks(mapdef, mvp_rules, edge, city, left + 1) <= window:
        left += 1
    near = _figure(view, edge, _toward(mapdef, edge, city, left, 1))
    far = _figure(view, edge, _toward(mapdef, edge, city, 1000, 1))
    for cls in (SmartRusher, SmartStrangler):
        bot = cls(mapdef, mvp_rules, seed=3, player=0)
        cmds = bot.decide(near, 0)
        assert bot.pinned[city], cls.name
        assert not bot.doomed[city]  # one enemy unit does not take the garrison
        assert not _moves_from(cmds, near, city), cls.name
        calm = cls(mapdef, mvp_rules, seed=3, player=0)
        calm.decide(far, 0)
        assert not calm.pinned[city]


# Doomed cities: DEC-25, item 10 -----------------------------------------------


def test_a_doomed_city_cancels_its_queue(maps: dict[str, MapDef], mvp_rules: Ruleset) -> None:
    mapdef = maps["web"]
    view = _start(mapdef, mvp_rules)
    edge, city, _ = _border(mapdef, view)
    view = _node(view, city, recruit_queue=1, recruit_progress=5)
    doomed = _figure(view, edge, _toward(mapdef, edge, city, 100, 20))
    bot = SmartRusher(mapdef, mvp_rules, seed=1, player=0)
    cmds = bot.decide(doomed, 0)
    assert bot.doomed[city]
    assert CancelRecruit(city) in cmds


# DEC-25: the recruit queue ----------------------------------------------------------------------


def _cp(view: PlayerView, cp: int) -> PlayerView:
    return dataclasses.replace(view, me=dataclasses.replace(view.me, cp=cp))


def _bank(mapdef: MapDef, rules: Ruleset, view: PlayerView, budget: int) -> list[Command]:
    """The commands of ``SmartBot.bank`` of a fresh bot alone, ``budget`` CP left."""
    bot = SmartRusher(mapdef, rules, seed=1, player=0)
    ctx = Ctx(view, view.tick, budget, standing=bot.standing(view))
    bot.bank(ctx)
    return ctx.cmds


def test_spare_cp_queue_a_unit_behind_the_one_in_production(
    maps: dict[str, MapDef], mvp_rules: Ruleset
) -> None:
    mapdef = maps["web"]
    capital = mapdef.capital(0)
    cost = mvp_rules.orders.cost.recruit
    cap = mvp_rules.cp.cap
    view = _node(_start(mapdef, mvp_rules), capital, recruit_queue=1, recruit_progress=3)
    keep = SmartRusher(mapdef, mvp_rules, seed=1, player=0).params["recruit_keep"]
    rules = mvp_rules
    assert _bank(mapdef, rules, view, keep + 2 * cost) == [Recruit(capital)]  # a price spare
    assert _bank(mapdef, rules, view, keep + 2 * cost - 1) == []
    two = _node(view, capital, recruit_queue=2)
    assert _bank(mapdef, rules, two, keep + 2 * cost) == []  # two while CP do not burn
    assert _bank(mapdef, rules, two, cap) == [Recruit(capital)]  # CP about to burn (DEC-02)
    full = _node(view, capital, recruit_queue=rules.recruit.queue_max)
    assert _bank(mapdef, rules, full, cap) == []  # DEC-25, item 6


def test_a_capital_in_danger_takes_the_production_of_the_other_cities(
    maps: dict[str, MapDef], mvp_rules: Ruleset
) -> None:
    mapdef = maps["web"]
    capital = mapdef.capital(0)
    view = _start(mapdef, mvp_rules)
    _, city, _ = _border(mapdef, view)
    view = _node(view, city, has_barracks=True, recruit_queue=1, recruit_progress=0)
    edge = min(mapdef.incident[capital])
    danger = _figure(view, edge, _toward(mapdef, edge, capital, 600, 30))
    bot = SmartRusher(mapdef, mvp_rules, seed=1, player=0)
    assert CancelRecruit(city) in bot.decide(_cp(danger, 0), 0)
    assert bot.alarm
    bot = SmartRusher(mapdef, mvp_rules, seed=1, player=0)
    rich = bot.decide(_cp(danger, mvp_rules.cp.cap), 0)
    assert CancelRecruit(city) not in rich  # with CP to spare the other queues stay


# DEC-35: scouting ------------------------------------------------------------------------------


def test_an_empty_front_node_near_the_capital_gets_a_scout(
    maps: dict[str, MapDef], mvp_rules: Ruleset
) -> None:
    mapdef = maps["web"]
    capital = mapdef.capital(0)
    view = _start(mapdef, mvp_rules)
    _, _, other = _border(mapdef, view)
    view = _node(view, other, owner=1)  # an enemy node next to the own territory
    bot = SmartRusher(mapdef, mvp_rules, seed=1, player=0)
    bot.decide(view, 0)
    assert bot.params["scouts"] == 1
    front = [
        n
        for n in range(len(view.nodes))
        if n != capital
        and view.nodes[n].owner == 0
        and any(mapdef.edges[e].other(n) == other for e in mapdef.incident[n])
    ]
    hops = bot.hops[capital]
    nearest = min(front, key=lambda n: (hops[n], mapdef.node_key(0, n)))
    assert [n for n, on in enumerate(bot.watch) if on] == [nearest]

    empty = _groups(view, [g for g in view.groups if g.location != AtNode(nearest)])
    bot = SmartRusher(mapdef, mvp_rules, seed=1, player=0)
    cmds = bot.decide(empty, 0)
    # Every group has two units: one splits off its spare units, its last unit walks later.
    assert nearest in bot.scouted
    assert any(isinstance(c, Split) and c.n == 1 for c in cmds)

    scout = next(
        g
        for g in empty.groups
        if isinstance(g.location, AtNode)
        and g.location.node not in (capital, nearest)
        and nearest in bot.reachable(empty, g.location.node, 3, 1)
    )
    one = dataclasses.replace(scout, units=1, charged=0)
    lone = _groups(empty, [one if g.id == scout.id else g for g in empty.groups])
    bot = SmartRusher(mapdef, mvp_rules, seed=1, player=0)
    cmds = bot.decide(lone, 0)
    assert any(isinstance(c, Move) and c.dest == nearest for c in cmds)
