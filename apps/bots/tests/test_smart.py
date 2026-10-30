"""#166: the assessment layer (``gow_bots.bots.assess``) and the smart base (``SmartBot``).

Expected values come from the rules, not from the code: DEC-03 (an award every
``victory.vp_period_ticks``, 30 in a match, the capital counts ``capital_multiplier`` times),
DEC-02 (the CP quantum split by stance, the cap), DEC-08 (the prices of a planned order and of
Defense, public intents), DEC-07 (``shots_to_take``), DEC-33 (enemy figures on edges) and the
travel time ``travel_ticks * 100 // speed`` of mechanics.md, section 4.
"""

import dataclasses
from typing import ClassVar

import pytest

from gow_bots.bots import BOTS, SmartBot, SmartRusher, SmartTurtle
from gow_bots.bots.assess import (
    VP_MARGIN,
    Assessment,
    Assessor,
    EnemyCp,
    Threat,
    Travel,
    army,
    awards_left,
    vp_rates,
)
from gow_bots.bots.base import Bot
from gow_bots.bots.smart import PERSONALITIES
from gow_bots.bots.utility import shots_to_take
from gow_sim.commands import Move, PlayerCommand, Recruit, SetMode
from gow_sim.maps import MapDef, NodeKind
from gow_sim.match import Match, run_headless
from gow_sim.ruleset import Ruleset, Stance
from gow_sim.view import (
    AtNode,
    Detail,
    EnemyGroupView,
    IntentKind,
    IntentView,
    Mode,
    PlayerView,
    Sighting,
)

KEY = bytes(range(32))
MVP_MAPS = ("artery", "web", "pass")


def _start(mapdef: MapDef, rules: Ruleset, player: int = 0) -> PlayerView:
    return Match(mapdef, rules, KEY).view(player)


def _assessor(mapdef: MapDef, rules: Ruleset, player: int = 0) -> Assessor:
    return Assessor(mapdef, rules, player, Travel(mapdef, rules))


# VP forecast (DEC-03) ------------------------------------------------------------------------


def test_awards_left_counts_the_awards_of_dec03(mvp1_rules: Ruleset) -> None:
    period = mvp1_rules.victory.vp_period_ticks
    total = mvp1_rules.match_ticks // period
    assert total == 30  # DEC-22: 15 minutes, an award every 30 s
    assert awards_left(mvp1_rules, 0) == 30
    assert awards_left(mvp1_rules, period - 1) == 30
    assert awards_left(mvp1_rules, period) == 29
    assert awards_left(mvp1_rules, mvp1_rules.match_ticks) == 0


def test_vp_rates_count_the_capital_times_the_multiplier(
    maps: dict[str, MapDef], mvp1_rules: Ruleset
) -> None:
    mapdef = maps["web"]
    view = _start(mapdef, mvp1_rules)
    mult = mvp1_rules.victory.capital_multiplier
    expected = [0, 0]
    for node in mapdef.nodes:
        if node.start_owner is not None:
            expected[node.start_owner] += node.vp * (mult if node.capital_of is not None else 1)
    assert vp_rates(view, mapdef, mvp1_rules) == tuple(expected)


def _assessment(view: PlayerView, mapdef: MapDef, rules: Ruleset) -> Assessment:
    bot = SmartBot(mapdef, rules, seed=0, player=view.player)
    return _assessor(mapdef, rules, view.player).assess(
        view, bot.supplied(view), guess=3, horizon=60
    )


def test_forecast_is_ahead_only_with_a_lead_of_the_margin(
    maps: dict[str, MapDef], mvp1_rules: Ruleset
) -> None:
    mapdef = maps["web"]  # symmetric: both sides own the same VP at the start
    view = _start(mapdef, mvp1_rules)
    a = _assessment(view, mapdef, mvp1_rules)
    assert a.rate[0] == a.rate[1] and a.lead == 0 and not a.ahead
    assert a.forecast == (a.rate[0] * 30, a.rate[1] * 30)

    # The last tick: no award left, only the VP now count; +1 is a lead, a tie is not.
    end = mvp1_rules.match_ticks
    for own, enemy, ahead in [(5, 5, False), (5 + VP_MARGIN, 5, True), (5, 6, False)]:
        late = dataclasses.replace(view, tick=end, vp=(own, enemy))
        a = _assessment(late, mapdef, mvp1_rules)
        assert a.lead == own - enemy and a.ahead is ahead

    # A neutral city taken: the lead is its VP at every award left.
    neutral = next(n for n in mapdef.nodes if n.start_owner is None and n.vp > 0)
    nodes = list(view.nodes)
    nodes[neutral.id] = dataclasses.replace(nodes[neutral.id], owner=0)
    a = _assessment(dataclasses.replace(view, nodes=tuple(nodes)), mapdef, mvp1_rules)
    assert a.lead == neutral.vp * 30 and a.ahead


# Own state -----------------------------------------------------------------------------------


def test_army_counts_the_own_groups_and_cities(
    maps: dict[str, MapDef], mvp1_rules: Ruleset
) -> None:
    mapdef = maps["web"]
    view = _start(mapdef, mvp1_rules)
    bot = SmartBot(mapdef, mvp1_rules, seed=0, player=0)
    own = army(view, mapdef, bot.supplied(view))
    start = [n for n in mapdef.nodes if n.start_owner == 0]
    assert own.units == sum(n.start_units for n in start)
    assert own.charged == sum(n.start_charged for n in start)
    assert own.uncharged_standing == own.units - own.charged
    assert own.cities == sum(n.kind is not NodeKind.PROVINCE for n in start)
    assert own.cut == 0
    assert own.warehouse == sum(n.warehouse or 0 for n in view.nodes if n.owner == 0)


# Travel lower bounds -------------------------------------------------------------------------


def test_travel_is_a_lower_bound_of_every_edge(
    maps: dict[str, MapDef], mvp1_rules: Ruleset
) -> None:
    mapdef = maps["web"]
    travel = Travel(mapdef, mvp1_rules)
    fastest = max(mvp1_rules.terrain.speed_pct.plains, mvp1_rules.terrain.speed_pct.forest)
    fastest = max(fastest, mvp1_rules.terrain.speed_pct.mountains)
    for e in mapdef.edges:
        # mechanics.md, section 4: an edge in one terrain takes travel_ticks * 100 // speed.
        assert travel.ticks[e.a][e.b] <= e.travel_ticks * 100 // fastest
        assert travel.ticks[e.a][e.b] == travel.ticks[e.b][e.a]
    count = len(mapdef.nodes)
    assert all(travel.ticks[n][n] == 0 for n in range(count))
    for a in range(0, count, 5):
        for b in range(count):
            for c in range(0, count, 7):
                assert travel.ticks[a][c] <= travel.ticks[a][b] + travel.ticks[b][c]


# The upper bound of the enemy CP (DEC-02, DEC-08) --------------------------------------------


def _intent(i: int, kind: IntentKind, tick: int, owner: int = 1) -> IntentView:
    return IntentView(i, owner, kind, 0, 1 if kind is IntentKind.PLANNED_MOVE else None, tick)


def test_enemy_cp_bound_follows_the_regeneration_and_the_visible_payments(
    maps: dict[str, MapDef], mvp1_rules: Ruleset
) -> None:
    rules = mvp1_rules
    view = _start(maps["web"], rules)
    cp = EnemyCp(rules, 1)
    period, start, cap = rules.cp.period_ticks, rules.cp.start, rules.cp.cap
    gain = (
        rules.cp.per_period - rules.cp.per_period * rules.economy.stance_to_charges_pct.war // 100
    )
    assert cp.update(view) == start
    assert cp.update(dataclasses.replace(view, tick=period)) == start + gain
    assert cp.update(dataclasses.replace(view, tick=period * 10)) == cap
    # A planned order paid at the tick of a quantum: the command comes before the economy.
    plan = _intent(7, IntentKind.PLANNED_MOVE, period * 11)
    seen = dataclasses.replace(view, tick=period * 11, intents=(plan,))
    assert cp.update(seen) == cap - rules.orders.cost.planned_move + gain
    again = dataclasses.replace(seen, tick=period * 11 + 5)
    assert cp.update(again) == cap - rules.orders.cost.planned_move + gain  # paid once
    defense = _intent(8, IntentKind.DEFENSE, period * 11 + 7)
    own = _intent(9, IntentKind.DEFENSE, period * 11 + 7, owner=0)
    later = dataclasses.replace(view, tick=period * 11 + 10, intents=(plan, defense, own))
    expected = cap - rules.orders.cost.planned_move + gain - rules.orders.cost.defense
    assert cp.update(later) == expected
    assert cp.ticks_to(expected, later.tick) == 0
    assert cp.ticks_to(expected + gain, later.tick) == period * 12 - later.tick


@pytest.mark.parametrize("map_name", MVP_MAPS)
def test_enemy_cp_bound_is_never_below_the_true_cp(
    maps: dict[str, MapDef], mvp1_rules: Ruleset, map_name: str
) -> None:
    mapdef = maps[map_name]
    match = Match(mapdef, mvp1_rules, KEY)
    bots = [
        BOTS[name](mapdef, mvp1_rules, seed=3, player=p)
        for p, name in enumerate(("random_legal", "reactive"))
    ]
    bound = EnemyCp(mvp1_rules, 1)
    seq = 0
    while match.tick < 3000 and not match.finished:
        cmds: list[PlayerCommand] = []
        if match.tick % 5 == 0:
            view = match.view(0)
            assert bound.update(view) >= match.state.players[1].cp
            for p in (0, 1):
                for cmd in bots[p].decide(match.view(p), match.tick):
                    cmds.append(PlayerCommand(p, seq, match.resolve(p, cmd)))
                    seq += 1
        match.step(cmds)


# Threat to the capital -----------------------------------------------------------------------


def _with_figure(view: PlayerView, edge: int, figure: EnemyGroupView) -> PlayerView:
    edges = list(view.edges)
    edges[edge] = dataclasses.replace(edges[edge], enemy_groups=(figure,))
    return dataclasses.replace(view, edges=tuple(edges))


def _capital_edge(mapdef: MapDef, player: int) -> tuple[int, int, bool]:
    """An edge into the capital: its id, the other end and whether the capital is ``b``."""
    capital = mapdef.capital(player)
    edge = min(mapdef.incident[capital])
    e = mapdef.edges[edge]
    return edge, e.other(capital), e.b == capital


def _capital_need(mapdef: MapDef, rules: Ruleset, view: PlayerView) -> int:
    capital = mapdef.capital(view.player)
    here = [g for g in view.groups if g.location == AtNode(capital)]
    units = sum(g.units for g in here)
    charged = sum(g.charged for g in here)
    return shots_to_take(rules, mapdef.nodes[capital].terrain, units, charged, 0)


def test_no_enemy_in_sight_is_no_threat(maps: dict[str, MapDef], mvp1_rules: Ruleset) -> None:
    mapdef = maps["web"]
    view = _start(mapdef, mvp1_rules)
    t = _assessor(mapdef, mvp1_rules).threat(view, guess=3, horizon=60)
    assert t == Threat(None, 0, _capital_need(mapdef, mvp1_rules, view))
    assert not t.danger


def test_a_figure_heading_to_the_capital_is_a_threat_by_its_eta(
    maps: dict[str, MapDef], mvp1_rules: Ruleset
) -> None:
    mapdef = maps["web"]
    view = _start(mapdef, mvp1_rules)
    edge, _, cap_is_b = _capital_edge(mapdef, 0)
    need = _capital_need(mapdef, mvp1_rules, view)
    assessor = _assessor(mapdef, mvp1_rules)
    pos = 600 if cap_is_b else 400  # 400 thousandths of the edge left to the capital
    big = EnemyGroupView(1, pos, cap_is_b, Detail.EXACT, Mode.ATTACK, need, need, None)
    t = assessor.threat(_with_figure(view, edge, big), guess=3, horizon=60)
    assert t.eta == view.tick + assessor.travel.edge_ticks[edge] * 400 // 1000
    assert t.units == need and t.danger
    small = dataclasses.replace(big, units=need - 1, charged=need - 1)
    assert not assessor.threat(_with_figure(view, edge, small), guess=3, horizon=60).danger
    # Going away into an own node: its path ends there (SIM-05), no threat to the capital.
    away = dataclasses.replace(big, toward_b=not cap_is_b)
    assert assessor.threat(_with_figure(view, edge, away), guess=3, horizon=60).eta is None
    # Going away into an enemy node next to the capital: it can come back with one order.
    _, near, _ = _capital_edge(mapdef, 0)
    nodes = list(view.nodes)
    nodes[near] = dataclasses.replace(nodes[near], owner=1)
    enemy_near = dataclasses.replace(view, nodes=tuple(nodes))
    later = assessor.threat(_with_figure(enemy_near, edge, away), guess=3, horizon=60)
    assert later.eta is not None and t.eta is not None and later.eta > t.eta
    # Exact numbers: only the charged units shoot (DEC-07).
    empty = dataclasses.replace(big, charged=0)
    assert assessor.threat(_with_figure(view, edge, empty), guess=3, horizon=60).units == 0
    # Hidden numbers (PRESENCE): the guess.
    hidden = EnemyGroupView(1, pos, cap_is_b, Detail.PRESENCE, Mode.ATTACK, None, None, None)
    assert assessor.threat(_with_figure(view, edge, hidden), guess=7, horizon=60).units == 7


def test_sightings_count_only_fresh_and_in_the_attack_mode(
    maps: dict[str, MapDef], mvp1_rules: Ruleset
) -> None:
    mapdef = maps["web"]
    view = dataclasses.replace(_start(mapdef, mvp1_rules), tick=200)
    _, near, _ = _capital_edge(mapdef, 0)
    assessor = _assessor(mapdef, mvp1_rules)

    def seen(sighting: Sighting) -> Threat:
        nodes = list(view.nodes)
        nodes[near] = dataclasses.replace(nodes[near], seen=sighting)
        return assessor.threat(dataclasses.replace(view, nodes=tuple(nodes)), guess=3, horizon=60)

    fresh = seen(Sighting(200, Detail.EXACT, (Mode.ATTACK,), 9, 9))
    assert fresh.units == 9 and fresh.eta == 200 + assessor.travel.ticks[near][mapdef.capital(0)]
    assert seen(Sighting(200, Detail.EXACT, (Mode.DEFENSE,), 9, 9)).eta is None
    assert seen(Sighting(100, Detail.EXACT, (Mode.ATTACK,), 9, 9)).eta is None  # stale
    assert seen(Sighting(200, Detail.RANGE, (Mode.ATTACK,), None, None, (3, 5))).units == 5
    assert seen(Sighting(200, Detail.EXACT, (Mode.ATTACK,), 9, 4)).units == 4  # 4 shoot


def test_only_forces_with_a_one_order_path_threaten_the_capital(
    maps: dict[str, MapDef], mvp1_rules: Ruleset
) -> None:
    # A path goes through the mover's own nodes only and ends at the first foreign or neutral
    # node (SIM-05): an enemy force behind an own node of the bot must take that node first.
    mapdef = maps["web"]
    view = dataclasses.replace(_start(mapdef, mvp1_rules), tick=200)
    capital = mapdef.capital(0)
    hops = Bot(mapdef, mvp1_rules, seed=0, player=0).hops[capital]
    near = next(n for n in range(len(mapdef.nodes)) if hops[n] == 1)
    far = next(n for n in range(len(mapdef.nodes)) if hops[n] == 2 and near in _nbrs(mapdef, n))
    assessor = _assessor(mapdef, mvp1_rules)
    sighting = Sighting(200, Detail.EXACT, (Mode.ATTACK,), 9, 9)

    def threat(owners: dict[int, int | None]) -> Threat:
        nodes = list(view.nodes)
        for n, owner in owners.items():
            nodes[n] = dataclasses.replace(nodes[n], owner=owner)
        nodes[far] = dataclasses.replace(nodes[far], seen=sighting)
        return assessor.threat(dataclasses.replace(view, nodes=tuple(nodes)), guess=3, horizon=60)

    assert threat({near: 0, far: 1}).eta is None  # the own node ``near`` stops it
    assert threat({near: None, far: 1}).eta is None  # so does a neutral one
    t = threat({near: 1, far: 1})  # over the enemy node ``near``: one order
    assert t.units == 9 and t.eta == 200 + assessor.travel.ticks[far][capital]
    # A garrison in its own node with hidden numbers counts the bottom of the range.
    nodes = list(view.nodes)
    nodes[near] = dataclasses.replace(
        nodes[near], owner=1, seen=Sighting(200, Detail.RANGE, (Mode.ATTACK,), None, None, (3, 5))
    )
    garrison = assessor.threat(dataclasses.replace(view, nodes=tuple(nodes)), guess=3, horizon=60)
    assert garrison.units == 3


def _nbrs(mapdef: MapDef, node: int) -> list[int]:
    return [mapdef.edges[e].other(node) for e in mapdef.incident[node]]


def test_a_planned_strike_at_the_capital_arrives_after_its_delay(
    maps: dict[str, MapDef], mvp1_rules: Ruleset
) -> None:
    mapdef = maps["web"]
    view = dataclasses.replace(_start(mapdef, mvp1_rules), tick=100)
    _, near, _ = _capital_edge(mapdef, 0)
    capital = mapdef.capital(0)
    strike = IntentView(5, 1, IntentKind.PLANNED_MOVE, near, capital, 98)
    assessor = _assessor(mapdef, mvp1_rules)
    t = assessor.threat(dataclasses.replace(view, intents=(strike,)), guess=4, horizon=60)
    delay = mvp1_rules.orders.planned_delay_ticks
    assert t.eta == 98 + delay + assessor.travel.ticks[near][capital]
    assert t.units == 4


# The smart base ------------------------------------------------------------------------------


def test_personalities_are_registered_with_their_params_in_range(
    maps: dict[str, MapDef], mvp1_rules: Ruleset
) -> None:
    names = sorted(cls.name for cls in PERSONALITIES)
    assert names == [
        "smart_expander",
        "smart_reactive",
        "smart_rusher",
        "smart_strangler",
        "smart_turtle",
    ]
    for cls in PERSONALITIES:
        assert BOTS[cls.name] is cls
        assert set(cls.PARAMS) == set(SmartBot.PARAMS)  # one base: the same knobs everywhere
        for seed in range(10):
            bot = cls(maps["web"], mvp1_rules, seed=seed, player=seed % 2)
            for key, r in cls.PARAMS.items():
                assert r.low <= bot.params[key] <= r.high


def _assessed(a: Assessment, **changes: object) -> Assessment:
    return dataclasses.replace(a, **changes)  # pyright: ignore[reportArgumentType]


def test_thresholds_follow_the_assessment(maps: dict[str, MapDef], mvp1_rules: Ruleset) -> None:
    mapdef = maps["web"]
    view = _start(mapdef, mvp1_rules)
    bot = SmartTurtle(mapdef, mvp1_rules, seed=1, player=0)
    drawn = dict(bot.params)
    base = _assessment(view, mapdef, mvp1_rules)
    rich = _assessed(base, enemy_cp=mvp1_rules.cp.cap)

    ahead = bot.adjusted(_assessed(rich, vp=(base.vp[0] + VP_MARGIN, base.vp[1])))
    assert ahead["margin"] == drawn["margin"] + drawn["secure_margin"]
    assert ahead["guard"] == drawn["guard"] and ahead["reserve"] == drawn["reserve"]

    late = _assessed(rich, awards_left=drawn["all_in"], vp=(0, 1))
    all_in = bot.adjusted(late)
    assert all_in["guard"] == 0 and all_in["reserve"] == 0
    assert all_in["radius"] == drawn["radius"] + 1 and all_in["margin"] == drawn["margin"]

    poor = bot.adjusted(_assessed(base, enemy_cp=mvp1_rules.orders.cost.planned_move - 1))
    assert poor["reserve"] == 0  # the enemy cannot pay for a planned strike


def test_stance_steps_toward_economy_while_units_wait_for_charges(
    maps: dict[str, MapDef], mvp1_rules: Ruleset
) -> None:
    mapdef = maps["web"]
    bot = SmartRusher(mapdef, mvp1_rules, seed=0, player=0)
    a = _assessment(_start(mapdef, mvp1_rules), mapdef, mvp1_rules)
    starving = dataclasses.replace(
        a.own, uncharged_standing=bot.params["starved"], warehouse=0, warehouse_cap=10
    )
    assert bot.wanted_stance(_assessed(a, own=starving)) is Stance.BALANCE
    full = dataclasses.replace(a.own, uncharged_standing=0, warehouse=10, warehouse_cap=10)
    assert bot.wanted_stance(_assessed(a, own=full, cp=0)) is Stance.WAR  # the last step
    turtle = SmartTurtle(mapdef, mvp1_rules, seed=0, player=0)
    assert turtle.wanted_stance(_assessed(a, own=full, cp=0)) is Stance.BALANCE
    # More CP would only burn at the cap (DEC-02): no step toward War.
    burning = mvp1_rules.cp.cap - mvp1_rules.cp.per_period
    assert turtle.wanted_stance(_assessed(a, own=full, cp=burning)) is Stance.ECONOMY


def test_a_capital_in_danger_keeps_its_groups_and_defends(
    maps: dict[str, MapDef], mvp1_rules: Ruleset
) -> None:
    mapdef = maps["web"]
    view = _start(mapdef, mvp1_rules)
    edge, _, cap_is_b = _capital_edge(mapdef, 0)
    need = _capital_need(mapdef, mvp1_rules, view)
    pos = 600 if cap_is_b else 400
    figure = EnemyGroupView(1, pos, cap_is_b, Detail.EXACT, Mode.ATTACK, need + 2, need + 2, None)
    danger = _with_figure(view, edge, figure)
    capital = mapdef.capital(0)
    home = {g.id for g in view.groups if g.location == AtNode(capital)}
    for cls in PERSONALITIES:
        bot = cls(mapdef, mvp1_rules, seed=2, player=0)
        cmds = bot.decide(danger, 0)
        assert bot.alarm
        assert not any(isinstance(c, Move) and c.group in home for c in cmds), cls.name
        assert any(isinstance(c, SetMode) and c.group in home for c in cmds) or any(
            c == Recruit(capital) for c in cmds
        ), cls.name
        calm = cls(mapdef, mvp1_rules, seed=2, player=0)
        calm.decide(view, 0)
        assert not calm.alarm


def _mirrored(cls: type[Bot]) -> type[Bot]:
    """The bot class whose side 1 draws the parameters and choices of side 0."""

    class Mirrored(cls):
        name: ClassVar[str] = cls.name

        def __init__(self, mapdef: MapDef, rules: Ruleset, *, seed: int, player: int) -> None:
            super().__init__(mapdef, rules, seed=seed, player=player)
            twin = cls(mapdef, rules, seed=seed, player=0)
            self.params, self.rng = twin.params, twin.rng

    return Mirrored


@pytest.mark.parametrize("cls", PERSONALITIES, ids=lambda c: c.name)
@pytest.mark.parametrize("map_name", MVP_MAPS)
def test_self_play_on_a_symmetric_map_is_a_draw(
    maps: dict[str, MapDef], short_rules: Ruleset, cls: type[SmartBot], map_name: str
) -> None:
    # Nothing but the opaque ids differs between the sides: a tie-break by id breaks this.
    mapdef = maps[map_name]
    mirrored = _mirrored(cls)
    for seed in range(2):
        bots = [mirrored(mapdef, short_rules, seed=seed, player=p) for p in (0, 1)]
        result = run_headless(mapdef, short_rules, bots)
        assert result.vp[0] == result.vp[1]
        assert result.accepted[0] == result.accepted[1]
        assert result.outcome is not None and result.outcome.winner is None
