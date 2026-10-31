"""#663: the phase of the match, the enemy strength by sector and the midgame characters.

Expected values come from the rules and the map, not from the code: DEC-03 (an award every
``victory.vp_period_ticks``, 30 in a match), the start forces of the map (``start_owner``,
``start_units``, symmetric by the mirror of the map), DEC-24 (the losses of a fight are public),
and the weights written in the docstring of ``gow_bots.bots.estimate``.
"""

import dataclasses

from gow_bots.bots import SmartBot, SmartReactive, SmartTurtle
from gow_bots.bots.assess import awards_left
from gow_bots.bots.campaign import Ctx
from gow_bots.bots.estimate import (
    OPEN_NEUTRAL_PCT,
    W_CAPITAL,
    W_FRONT,
    EnemyForce,
    Phase,
    phase,
    sectors,
    strengths,
    threats,
)
from gow_sim.maps import MapDef
from gow_sim.match import Match
from gow_sim.ruleset import Ruleset
from gow_sim.view import Detail, FightView, Mode, PlayerView, Sighting

KEY = bytes(range(32))


def _start(mapdef: MapDef, rules: Ruleset, player: int = 0) -> PlayerView:
    return Match(mapdef, rules, KEY).view(player)


def _owned(view: PlayerView, owners: dict[int, int | None]) -> PlayerView:
    nodes = [
        dataclasses.replace(n, owner=owners[n.id]) if n.id in owners else n for n in view.nodes
    ]
    return dataclasses.replace(view, nodes=tuple(nodes))


def _split(bot: SmartBot, view: PlayerView) -> PlayerView:
    """Every node to the player whose capital is nearer in hops (ties to player 1): no neutral
    node is left, the territory is split."""
    near, far = bot.hops[bot.map.capital(0)], bot.hops[bot.map.capital(1)]
    return _owned(view, {n: (0 if near[n] < far[n] else 1) for n in range(len(bot.map.nodes))})


def _fight(fid: int, node: int, attacker: int, losses: tuple[int, int]) -> FightView:
    return FightView(
        id=fid,
        node=node,
        edge=None,
        point=None,
        attacker=attacker,
        start_tick=1,
        next_round_tick=2,
        groups=(),
        enemy_units=0,
        enemy_charged=0,
        shots=(0, 0),
        losses=losses,
        virtual_left=(0, 0),
        mute=(0, 0),
        last_round=None,
    )


# Phase -----------------------------------------------------------------------------------------


def test_phase_opening_midgame_late(maps: dict[str, MapDef], mvp1_rules: Ruleset) -> None:
    mapdef = maps["web"]
    view = _start(mapdef, mvp1_rules)
    assert 100 * sum(n.owner is None for n in view.nodes) > OPEN_NEUTRAL_PCT * len(view.nodes)
    assert phase(view, mvp1_rules, 6) is Phase.OPENING
    settled = _owned(view, {n.id: 0 for n in view.nodes if n.owner is None})
    assert phase(settled, mvp1_rules, 6) is Phase.MIDGAME
    # DEC-03: an award every vp_period_ticks, the last on the last tick: 6 left from 24 periods on.
    period = mvp1_rules.victory.vp_period_ticks
    late = dataclasses.replace(settled, tick=mvp1_rules.match_ticks - 6 * period)
    assert awards_left(mvp1_rules, late.tick) == 6
    assert phase(late, mvp1_rules, 6) is Phase.LATE
    assert phase(dataclasses.replace(late, tick=late.tick - 1), mvp1_rules, 6) is Phase.MIDGAME


# Enemy force -----------------------------------------------------------------------------------


def test_enemy_force_starts_with_the_symmetric_start_units(
    maps: dict[str, MapDef], mvp1_rules: Ruleset
) -> None:
    mapdef = maps["web"]
    start = [0, 0]
    for n in mapdef.nodes:
        if n.start_owner is not None:
            start[n.start_owner] += n.start_units
    assert start[0] == start[1]  # the map is mirrored
    force = EnemyForce(mapdef, 0)
    view = _start(mapdef, mvp1_rules)
    assert force.update(view) == start[1]


def test_enemy_force_counts_own_recruits_and_enemy_losses(
    maps: dict[str, MapDef], mvp1_rules: Ruleset
) -> None:
    mapdef = maps["web"]
    view = _start(mapdef, mvp1_rules)
    force = EnemyForce(mapdef, 0)
    start = force.update(view)
    g = view.groups[0]
    # Two own recruits: the own units grow by 2, so the enemy is assumed to have 2 more.
    grown = dataclasses.replace(
        view, tick=10, groups=(dataclasses.replace(g, units=g.units + 2), *view.groups[1:])
    )
    assert force.update(grown) == start + 2
    # A visible fight: the enemy lost 3 units, the own side 1 (the own unit lost is not a recruit
    # the less: own recruits = own units now + own losses - own start).
    fight = _fight(7, 0, 1, (1, 3))
    one_lost = (dataclasses.replace(g, units=g.units + 1), *view.groups[1:])
    hurt = dataclasses.replace(grown, tick=20, fights=(fight,), groups=one_lost)
    assert force.update(hurt) == start + 2 - 3
    # The fight ends: its losses stay counted.
    after = dataclasses.replace(hurt, tick=30, fights=())
    assert force.update(after) == start + 2 - 3


# Strength by node, sectors, threats ------------------------------------------------------------


def test_hidden_force_is_spread_by_the_weights(
    maps: dict[str, MapDef], mvp1_rules: Ruleset
) -> None:
    mapdef = maps["web"]
    bot = SmartTurtle(mapdef, mvp1_rules, seed=0, player=0)
    view = _split(bot, _start(mapdef, mvp1_rules))
    # Nothing seen: no sightings at all.
    blind = dataclasses.replace(
        view, nodes=tuple(dataclasses.replace(n, seen=None) for n in view.nodes), groups=()
    )
    enemy = [n.id for n in blind.nodes if n.owner == 1]
    weight: dict[int, int] = {}
    for n in enemy:
        if mapdef.nodes[n].capital_of is not None:
            weight[n] = W_CAPITAL
        elif any(blind.nodes[m].owner == 0 for m in bot.neighbors[n]):
            weight[n] = W_FRONT
        else:
            weight[n] = 1
    total = 40
    shots = strengths(blind, mapdef, bot.neighbors, total, 3)
    parts = sum(weight.values())
    for n in enemy:
        assert shots[n] == total * weight[n] // parts
    assert all(shots[n.id] == 0 for n in blind.nodes if n.owner != 1)
    # A fresh exact sighting gives its numbers, the rest of the force is spread over the others.
    front = next(n for n in enemy if weight[n] == W_FRONT)
    sight = Sighting(blind.tick, Detail.EXACT, (Mode.ATTACK,), 5, 4)
    nodes = [dataclasses.replace(n, seen=sight) if n.id == front else n for n in blind.nodes]
    seen = dataclasses.replace(blind, nodes=tuple(nodes))
    shots = strengths(seen, mapdef, bot.neighbors, total, 3)
    assert shots[front] == 4
    rest = parts - W_FRONT
    for n in enemy:
        if n != front:
            assert shots[n] == (total - 5) * weight[n] // rest


def test_sectors_and_threats(maps: dict[str, MapDef], mvp1_rules: Ruleset) -> None:
    mapdef = maps["web"]
    bot = SmartTurtle(mapdef, mvp1_rules, seed=0, player=0)
    view = _split(bot, _start(mapdef, mvp1_rules))
    shots = [n.id + 1 if n.owner == 1 else 0 for n in view.nodes]
    found = sectors(view, bot.neighbors, shots)
    assert found
    for sec in found:
        assert view.nodes[sec.node].owner == 1
        assert any(view.nodes[m].owner == 0 for m in bot.neighbors[sec.node])
        enemy = [m for m in bot.neighbors[sec.node] if view.nodes[m].owner == 1]
        assert sec.shots == sec.node + 1
        assert sec.support == sum(m + 1 for m in enemy) // 2
    out = threats(view, bot.neighbors, shots)
    for n in view.nodes:
        near = sorted(
            (m + 1 for m in bot.neighbors[n.id] if view.nodes[m].owner == 1), reverse=True
        )
        if n.owner != 0 or not near:
            assert out[n.id] == 0
        else:
            assert out[n.id] == near[0] + sum(near[1:]) // 2


# The turtle (#663) -----------------------------------------------------------------------------


def test_turtle_half_is_mirror_symmetric(maps: dict[str, MapDef], mvp1_rules: Ruleset) -> None:
    for mapdef in maps.values():
        a = SmartTurtle(mapdef, mvp1_rules, seed=0, player=0)
        b = SmartTurtle(mapdef, mvp1_rules, seed=0, player=1)
        mirror = mapdef.mirror_nodes
        for n in range(len(mapdef.nodes)):
            assert a.half[n] == b.half[mirror[n]]
        assert a.half[mapdef.capital(0)] and not a.half[mapdef.capital(1)]


def _ctx(bot: SmartBot, view: PlayerView) -> Ctx:
    return Ctx(view, view.tick, view.me.cp, standing=bot.standing(view))


def test_turtle_claims_its_half_then_holds_or_pushes(
    maps: dict[str, MapDef], mvp1_rules: Ruleset
) -> None:
    mapdef = maps["web"]
    start = _start(mapdef, mvp1_rules)
    bot = SmartTurtle(mapdef, mvp1_rules, seed=0, player=0)
    g = start.groups[0]
    poor = dataclasses.replace(start, me=dataclasses.replace(start.me, cp=0))
    bot.decide(poor, 0)
    ctx = _ctx(bot, poor)
    # Opening: the half only (CP do not burn).
    for n in range(len(mapdef.nodes)):
        assert bot.in_reach(ctx, g, n) == bot.half[n], n
    # The territory split, ahead on the forecast: nothing outside the own half.
    split = _split(bot, poor)
    lead = dataclasses.replace(split, tick=5, vp=(50, 0))
    bot.decide(lead, 5)
    assert bot.settled() and not bot.pushing()
    ctx = _ctx(bot, lead)
    outside = [n.id for n in lead.nodes if n.owner == 1 and not bot.half[n.id]]
    assert outside
    assert not any(bot.in_reach(ctx, g, n) for n in outside)
    # Behind: the advance, enemy nodes become targets, the weakest sector first.
    behind = dataclasses.replace(split, tick=40, vp=(0, 50))
    bot.decide(behind, 40)
    assert bot.pushing()
    ctx = _ctx(bot, behind)
    assert all(bot.in_reach(ctx, g, n) for n in outside)
    spot = bot.weak_spot(ctx)
    assert spot is not None and behind.nodes[spot].owner == 1
    assert bot.objective(ctx) == spot


def test_turtle_front_garrison_follows_the_threat(
    maps: dict[str, MapDef], mvp1_rules: Ruleset
) -> None:
    mapdef = maps["web"]
    bot = SmartTurtle(mapdef, mvp1_rules, seed=0, player=0)
    view = _split(bot, _start(mapdef, mvp1_rules))
    lead = dataclasses.replace(view, tick=5, vp=(50, 0))
    bot.decide(lead, 5)
    hold = bot.params["hold_front"]
    for n in range(len(mapdef.nodes)):
        want = max(hold, min(bot.threat[n] + 1, hold + SmartTurtle.FRONT_EXTRA))
        assert bot.front_hold(n) == want
    behind = dataclasses.replace(view, tick=40, vp=(0, 50))
    bot.decide(behind, 40)
    for n in range(len(mapdef.nodes)):
        assert bot.front_hold(n) == max(1, min(hold, bot.threat[n] + 1))


# The reactive counterattack (#663) -------------------------------------------------------------


def test_reactive_waits_for_the_enemy_to_commit_when_ahead(
    maps: dict[str, MapDef], mvp1_rules: Ruleset
) -> None:
    mapdef = maps["web"]
    bot = SmartReactive(mapdef, mvp1_rules, seed=0, player=0)
    view = _split(bot, _start(mapdef, mvp1_rules))
    g = view.groups[0]
    lead = dataclasses.replace(view, tick=5, vp=(50, 0))
    bot.decide(lead, 5)
    ctx = _ctx(bot, lead)
    enemy = [n.id for n in lead.nodes if n.owner == 1]
    # Ahead and nothing committed: only an empty node or a weak sector is a target.
    for n in enemy:
        open_ = bot.shots[n] == 0 or bot.weakness(n) > 0
        assert bot.in_reach(ctx, g, n) == open_, n
    assert not all(bot.in_reach(ctx, g, n) for n in enemy)
    # The enemy attacks an own node next to its territory: its neighbours are open to a
    # counterattack for COUNTER_TICKS.
    own = next(
        n.id
        for n in lead.nodes
        if n.owner == 0 and any(lead.nodes[m].owner == 1 for m in bot.neighbors[n.id])
    )
    attacked = dataclasses.replace(lead, tick=10, fights=(_fight(3, own, 1, (0, 0)),))
    bot.decide(attacked, 10)
    ctx = _ctx(bot, attacked)
    assert all(bot.in_reach(ctx, g, n) for n in enemy)
    near = [m for m in bot.neighbors[own] if attacked.nodes[m].owner == 1]
    assert all(bot.mid_value(ctx, m) >= bot.params["w_exposed"] for m in near)
    # Behind on the forecast it attacks without waiting.
    bot2 = SmartReactive(mapdef, mvp1_rules, seed=0, player=0)
    behind = dataclasses.replace(view, tick=5, vp=(0, 50))
    bot2.decide(behind, 5)
    ctx = _ctx(bot2, behind)
    assert all(bot2.in_reach(ctx, g, n) for n in enemy)
