"""#166, PR 2: supply, scouting and the engagement zone of the smart bots.

Expected values come from the rules: the travel time ``travel_ticks * 100 // speed`` by the
terrain of the zone (mechanics.md, section 4), the engagement zone ``combat.engage_ticks``
(DEC-37), the supply targets and the rear minimum (DEC-28, items 3 and 5), the transfer to the
free room of the target (DEC-18, item 6), the loss of the queue and the warehouse with a city
(DEC-25, item 10; DEC-26, item 4), vision from own groups only (DEC-35).
"""

import dataclasses

from gow_bots.bots import SmartBot, SmartRusher, SmartStrangler
from gow_bots.bots.assess import Travel
from gow_bots.bots.campaign import Ctx
from gow_bots.bots.logistics import (
    Arrival,
    arrivals,
    figure_ticks,
    incoming_charges,
    own_parts,
)
from gow_sim.commands import (
    CancelRecruit,
    Command,
    Move,
    Recruit,
    SetFront,
    SetRearMin,
    Split,
    Transfer,
)
from gow_sim.maps import MapDef, NodeKind
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
    PacketView,
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
    edge in the zone of ``node`` on a level 1 road."""
    speed = rules.terrain.speed_pct.of(mapdef.nodes[node].terrain)
    return mapdef.edges[edge].travel_ticks * 100 * left // (speed * 1000)


def _moves_from(cmds: list[Command], view: PlayerView, node: int) -> list[Command]:
    here = {g.id for g in view.groups if g.location == AtNode(node)}
    return [c for c in cmds if isinstance(c, (Move, Split)) and c.group in here]


# Logistics -----------------------------------------------------------------------------------


def test_a_figure_heading_into_an_own_node_arrives_by_the_zone_speed(
    maps: dict[str, MapDef], mvp1_rules: Ruleset
) -> None:
    mapdef = maps["web"]
    view = _start(mapdef, mvp1_rules)
    edge, city, other = _border(mapdef, view)
    f = _toward(mapdef, edge, city, 500, 4)
    seen = _figure(view, edge, f)
    expected = _zone_ticks(mapdef, mvp1_rules, edge, city, 500)
    assert figure_ticks(seen, mapdef, mvp1_rules, edge, f) == expected
    travel = Travel(mapdef, mvp1_rules)
    assert arrivals(seen, mapdef, mvp1_rules, travel, 3) == {city: Arrival(view.tick + expected, 4)}
    # Heading away, into the node that is not own: no arrival into an own node.
    away = _figure(view, edge, _toward(mapdef, edge, other, 500, 4))
    assert arrivals(away, mapdef, mvp1_rules, travel, 3) == {}


def test_a_planned_strike_arrives_after_its_delay_with_the_guess(
    maps: dict[str, MapDef], mvp1_rules: Ruleset
) -> None:
    mapdef = maps["web"]
    view = _start(mapdef, mvp1_rules)
    _, city, other = _border(mapdef, view)
    strike = IntentView(5, 1, IntentKind.PLANNED_MOVE, other, city, 0)
    travel = Travel(mapdef, mvp1_rules)
    found = arrivals(dataclasses.replace(view, intents=(strike,)), mapdef, mvp1_rules, travel, 3)
    delay = mvp1_rules.orders.planned_delay_ticks
    assert found == {city: Arrival(delay + travel.ticks[other][city], 3)}


def test_incoming_charges_and_own_parts(maps: dict[str, MapDef], mvp1_rules: Ruleset) -> None:
    mapdef = maps["web"]
    view = _start(mapdef, mvp1_rules)
    capital = mapdef.capital(0)
    edge, city, _ = _border(mapdef, view)
    packet = PacketView(1, edge, capital, 2, 0, 30, (capital, city), 30, False)
    assert incoming_charges(dataclasses.replace(view, packets=(packet,))) == {city: 2}
    parts = own_parts(view, mapdef)
    own = [n.id for n in view.nodes if n.owner == 0]
    assert all(parts[n] == parts[capital] for n in own)  # the start territory is one part
    assert all(parts[n.id] == -1 for n in view.nodes if n.owner != 0)


# DEC-37: the engagement zone ------------------------------------------------------------------


def test_a_group_does_not_leave_a_node_the_enemy_enters_within_the_zone(
    maps: dict[str, MapDef], mvp1_rules: Ruleset
) -> None:
    mapdef = maps["web"]
    view = _start(mapdef, mvp1_rules)
    edge, city, _ = _border(mapdef, view)
    window = mvp1_rules.combat.engage_ticks + 1  # the order applies in the next tick
    left = 1
    while _zone_ticks(mapdef, mvp1_rules, edge, city, left + 1) <= window:
        left += 1
    near = _figure(view, edge, _toward(mapdef, edge, city, left, 1))
    far = _figure(view, edge, _toward(mapdef, edge, city, 1000, 1))
    for cls in (SmartRusher, SmartStrangler):
        bot = cls(mapdef, mvp1_rules, seed=3, player=0)
        cmds = bot.decide(near, 0)
        assert bot.pinned[city], cls.name
        assert not bot.doomed[city]  # one enemy unit does not take the garrison
        assert not _moves_from(cmds, near, city), cls.name
        calm = cls(mapdef, mvp1_rules, seed=3, player=0)
        calm.decide(far, 0)
        assert not calm.pinned[city]


# Doomed cities: DEC-25, item 10; DEC-26, item 4 -----------------------------------------------


def test_a_doomed_city_cancels_its_queue_and_ships_its_charges(
    maps: dict[str, MapDef], mvp1_rules: Ruleset
) -> None:
    mapdef = maps["web"]
    view = _start(mapdef, mvp1_rules)
    edge, city, _ = _border(mapdef, view)
    capital = mapdef.capital(0)
    stock = view.nodes[city].warehouse
    assert stock is not None and stock > 0
    view = _node(view, city, recruit_queue=1, recruit_progress=5)
    view = _node(view, capital, warehouse=0)  # the only room left is in the capital
    doomed = _figure(view, edge, _toward(mapdef, edge, city, 100, 20))
    bot = SmartRusher(mapdef, mvp1_rules, seed=1, player=0)
    cmds = bot.decide(doomed, 0)
    assert bot.doomed[city]
    assert CancelRecruit(city) in cmds
    # The garrison is charged: the whole stock goes, to the only city with room.
    assert Transfer(city, capital, stock) in cmds
    assert not any(isinstance(c, SetFront) and c.node == city for c in cmds)


# DEC-28: the rear minimum, DEC-18: transfers ----------------------------------------------------


def test_the_rear_minimum_follows_the_front_and_the_capital(
    maps: dict[str, MapDef], mvp1_rules: Ruleset
) -> None:
    mapdef = maps["web"]
    supply = mvp1_rules.supply
    view = _start(mapdef, mvp1_rules)
    capital = mapdef.capital(0)
    full = view.nodes[capital]
    assert full.warehouse == full.warehouse_cap  # the start: a full capital
    bot = SmartRusher(mapdef, mvp1_rules, seed=1, player=0)
    assert SetRearMin(bot.params["rear_full"]) in bot.decide(view, 0)

    half = _node(view, capital, warehouse=0)
    bot = SmartRusher(mapdef, mvp1_rules, seed=1, player=0)
    assert view.me.rear_min == supply.rear_min_default
    assert not any(isinstance(c, SetRearMin) for c in bot.decide(half, 0))

    _, city, _ = _border(mapdef, view)
    groups = [
        dataclasses.replace(g, charged=0) if g.location == AtNode(city) else g for g in half.groups
    ]
    starving = _groups(_node(half, city, warehouse=0), groups)
    starving = dataclasses.replace(
        starving, me=dataclasses.replace(starving.me, fronts=(city, None))
    )
    bot = SmartRusher(mapdef, mvp1_rules, seed=1, player=0)
    assert SetRearMin(0) in bot.decide(starving, 0)


def test_a_transfer_feeds_the_units_that_wait_for_charges(
    maps: dict[str, MapDef], mvp1_rules: Ruleset
) -> None:
    mapdef = maps["web"]
    view = _start(mapdef, mvp1_rules)
    capital = mapdef.capital(0)
    rear_min = view.me.rear_min
    # Every city at its supply target (DEC-28, item 5): only the capital has a stock above it.
    for n in view.nodes:
        if n.owner == 0 and n.id != capital and n.warehouse_cap is not None:
            view = _node(view, n.id, warehouse=min(rear_min, n.warehouse_cap))
    city = next(
        n.id
        for n in view.nodes
        if n.owner == 0
        and n.id != capital
        and mapdef.nodes[n.id].kind is not NodeKind.PROVINCE
        and (n.warehouse_cap or 0) >= 2
        and any(g.location == AtNode(n.id) and g.units >= 2 for g in view.groups)
    )
    groups = [
        dataclasses.replace(g, charged=0) if g.location == AtNode(city) else g for g in view.groups
    ]
    waiting = sum(g.units for g in groups if g.location == AtNode(city))
    view = _groups(_node(view, city, warehouse=0), groups)
    cap = view.nodes[city].warehouse_cap or 0
    bot = SmartBot(mapdef, mvp1_rules, seed=1, player=0)
    cmds = bot.decide(view, 0)
    assert Transfer(capital, city, min(waiting, cap)) in cmds


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
    maps: dict[str, MapDef], mvp1_rules: Ruleset
) -> None:
    mapdef = maps["web"]
    capital = mapdef.capital(0)
    cost = mvp1_rules.orders.cost.recruit
    cap = mvp1_rules.cp.cap
    view = _node(_start(mapdef, mvp1_rules), capital, recruit_queue=1, recruit_progress=3)
    keep = SmartRusher(mapdef, mvp1_rules, seed=1, player=0).params["recruit_keep"]
    rules = mvp1_rules
    assert _bank(mapdef, rules, view, keep + 2 * cost) == [Recruit(capital)]  # a price spare
    assert _bank(mapdef, rules, view, keep + 2 * cost - 1) == []
    two = _node(view, capital, recruit_queue=2)
    assert _bank(mapdef, rules, two, keep + 2 * cost) == []  # two while CP do not burn
    assert _bank(mapdef, rules, two, cap) == [Recruit(capital)]  # CP about to burn (DEC-02)
    full = _node(view, capital, recruit_queue=rules.recruit.queue_max)
    assert _bank(mapdef, rules, full, cap) == []  # DEC-25, item 6


def test_a_capital_in_danger_takes_the_production_of_the_other_cities(
    maps: dict[str, MapDef], mvp1_rules: Ruleset
) -> None:
    mapdef = maps["web"]
    capital = mapdef.capital(0)
    view = _start(mapdef, mvp1_rules)
    _, city, _ = _border(mapdef, view)
    view = _node(view, city, has_barracks=True, recruit_queue=1, recruit_progress=0)
    edge = min(mapdef.incident[capital])
    danger = _figure(view, edge, _toward(mapdef, edge, capital, 600, 30))
    bot = SmartRusher(mapdef, mvp1_rules, seed=1, player=0)
    assert CancelRecruit(city) in bot.decide(_cp(danger, 0), 0)
    assert bot.alarm
    bot = SmartRusher(mapdef, mvp1_rules, seed=1, player=0)
    rich = bot.decide(_cp(danger, mvp1_rules.cp.cap), 0)
    assert CancelRecruit(city) not in rich  # the capital pays its own recruit
    assert Recruit(capital) in rich


# DEC-28, item 7: the arteries --------------------------------------------------------------------


def test_the_arteries_run_from_the_capital_to_the_markers(
    maps: dict[str, MapDef], mvp1_rules: Ruleset
) -> None:
    mapdef = maps["web"]
    view = _start(mapdef, mvp1_rules)
    capital = mapdef.capital(0)
    bot = SmartBot(mapdef, mvp1_rules, seed=1, player=0)
    assert not any(bot.arteries(view))
    edge = min(
        e for e in mapdef.incident[capital] if view.nodes[mapdef.edges[e].other(capital)].owner == 0
    )
    city = mapdef.edges[edge].other(capital)
    marked = dataclasses.replace(view, me=dataclasses.replace(view.me, fronts=(city, None)))
    assert [e for e, on in enumerate(bot.arteries(marked)) if on] == [edge]


# DEC-35: scouting ------------------------------------------------------------------------------


def test_an_empty_front_node_near_the_capital_gets_a_scout(
    maps: dict[str, MapDef], mvp1_rules: Ruleset
) -> None:
    mapdef = maps["web"]
    capital = mapdef.capital(0)
    view = _start(mapdef, mvp1_rules)
    _, _, other = _border(mapdef, view)
    view = _node(view, other, owner=1)  # an enemy node next to the own territory
    bot = SmartRusher(mapdef, mvp1_rules, seed=1, player=0)
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
    bot = SmartRusher(mapdef, mvp1_rules, seed=1, player=0)
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
    bot = SmartRusher(mapdef, mvp1_rules, seed=1, player=0)
    cmds = bot.decide(lone, 0)
    assert any(isinstance(c, Move) and c.dest == nearest for c in cmds)
