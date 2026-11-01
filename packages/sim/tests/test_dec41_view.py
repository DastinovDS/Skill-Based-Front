"""Economy v2 in the ``PlayerView`` (DEC-41, #642; protocol and view: #647).

Expected values come from mechanics.md, section 7, block "Economy v2 (DEC-41, #642)": item 2
(the capital is a factory from the start, 1 charge per ``factory.capital_period_ticks = 50``; a
built factory per ``built_period_ticks = 100``; ``build_ticks = 100``), item 3 ("the enemy's lines
are never visible; ``PlayerView`` has only your own lines"), item 7 (the progressive payment: the
build time starts when it is paid in full), item 10 (the requested bonus, one charge per
``orders.plan_ticks_per_bonus = 30`` ticks; table P1), item 12 (the bunker: "visible like an enemy
barracks (DEC-31: only a built one, next to an own node)", ``bunker.build_ticks = 100``) and item
14 ("an enemy factory and bunker follow the DEC-31 rule; never an enemy line").

Map ``dec41`` (see ``test_dec41.py``): player 0 owns K = 0 (capital), A = 1 (large), B, C, D = 2,
3, 4 (medium), E, F, G = 5, 6, 7 (small); M = 8 is a neutral province between C and the enemy
city 13; the neutral province 18 joins D and the enemy city 13. Player 1 owns 9..16 (capital 16).
"""

from dataclasses import replace
from pathlib import Path

from gow_sim.commands import (
    BuildBarracks,
    BuildFactory,
    Command,
    DrawLine,
    Move,
    PlayerCommand,
    ReleasePlan,
)
from gow_sim.maps import load_map
from gow_sim.match import HEADLESS_MATCH_KEY, Match
from gow_sim.ruleset import load_ruleset
from gow_sim.state import AtNode, FactoryBuild, Group, Line, Mode
from gow_sim.view import (
    GroupView,
    LineView,
    NodeView,
    SiteBuildView,
    opaque_id,
    project,
    view_to_canonical,
)

TESTS_DIR = Path(__file__).resolve().parent
ROOT = TESTS_DIR.parents[2]
MVP3 = load_ruleset(ROOT / "rulesets" / "mvp-3.toml")
# The tables of DEC-41 (mechanics.md) are written for the accepted starting values: CP every 50 ticks,
# factories 50 / 100, a capture costs 1. mvp-3 moved on (owner decision 2026-11-01, #659: `balanced`),
# so these tests pin the DEC-41 numbers on top of it; test_dec41.py pins the file itself.
assert MVP3.factory is not None
RULES = replace(
    MVP3,
    cp=replace(MVP3.cp, period_ticks=50),
    factory=replace(MVP3.factory, capital_period_ticks=50, built_period_ticks=100),
    capture=replace(MVP3.capture, charge_cost=1),
)
V1 = load_ruleset(ROOT / "rulesets" / "mvp-2.toml")
MAP = load_map(TESTS_DIR / "maps" / "dec41.json")
KEY = HEADLESS_MATCH_KEY
K, A, B, C, D, E, F, G, M = range(9)
ENEMY_CITY, ENEMY_CAPITAL, SOUTH_PASS = 13, 16, 18


def _match() -> Match:
    return Match(MAP, RULES, KEY)


def _group(m: Match, node: int, units: int, charged: int, owner: int = 0) -> Group:
    gid = m.state.new_id()
    group = Group(gid, owner, units, charged, Mode.ATTACK, AtNode(node))
    m.state.groups[gid] = group
    return group


def _to(m: Match, tick: int, *cmds: Command) -> None:
    """Step ``m`` until ``m.tick == tick``; ``cmds`` (player 0) are applied at ``tick``."""
    while m.tick < tick - 1:
        m.step()
    m.step([PlayerCommand(0, seq, c) for seq, c in enumerate(cmds)])


def _node(m: Match, player: int, node: int) -> NodeView:
    return project(m.state, m.rules, player, KEY).nodes[node]


def _own(m: Match, g: Group) -> GroupView:
    oid = opaque_id(KEY, 0, g.id)
    return next(v for v in project(m.state, m.rules, 0, KEY).groups if v.id == oid)


def _v2(n: NodeView) -> tuple[object, ...]:
    return (n.factory, n.factory_period, n.factory_build, n.fort, n.fort_build)


# Lines (item 3) ----------------------------------------------------------------------------------


def test_own_lines_are_in_the_view_with_their_paths() -> None:
    """Item 3: ``PlayerView.lines`` carries the own lines by id with the path as stored."""
    m = _match()
    me = m.state.players[0]
    me.lines = {0: Line(0, (K, A, B)), 2: Line(2, (A, E))}
    me.next_line = 3
    assert project(m.state, RULES, 0, KEY).lines == (
        LineView(id=0, path=(K, A, B)),
        LineView(id=2, path=(A, E)),
    )


def test_fog_an_enemy_line_is_never_visible() -> None:
    """Item 3 and 14: the enemy's lines never reach a view, and nothing of a view depends on
    them: the views of a player are equal whatever lines the enemy has, also with an own group in
    the enemy's nodes on the lines (an own source of vision there) and with the relay state of
    the enemy's nodes."""
    m = _match()
    _group(m, ENEMY_CITY, 2, 2)  # an own source of vision inside the enemy's lines
    m.step()
    before = view_to_canonical(project(m.state, RULES, 0, KEY))
    enemy = m.state.players[1]
    enemy.lines = {0: Line(0, (16, 15, 14, 13)), 1: Line(1, (14, 9)), 5: Line(5, (16, 11))}
    enemy.next_line = 6
    m.state.nodes[14].inbox = 1
    m.state.nodes[14].rr = 2
    after = project(m.state, RULES, 0, KEY)
    assert view_to_canonical(after) == before
    assert after.lines == ()
    assert [line.path for line in project(m.state, RULES, 1, KEY).lines] == [
        (16, 15, 14, 13),
        (14, 9),
        (16, 11),
    ]


def test_fog_no_enemy_line_in_any_view_of_a_played_match() -> None:
    """Item 3, over a played match: both players draw lines, and at every tick each view has
    exactly the own lines of its player."""
    m = _match()
    m.step([PlayerCommand(0, 1, DrawLine((K, A, B))), PlayerCommand(1, 1, DrawLine((16, 15, 14)))])
    m.step([PlayerCommand(0, 2, DrawLine((B, F))), PlayerCommand(1, 2, DrawLine((14, 10)))])
    assert len(m.state.players[0].lines) == 2 and len(m.state.players[1].lines) == 2
    for _ in range(120):
        m.step()
        for p in (0, 1):
            own = m.state.players[p].lines
            assert project(m.state, RULES, p, KEY).lines == tuple(
                LineView(id=k, path=own[k].path) for k in sorted(own)
            )


# Factories (item 2) ------------------------------------------------------------------------------


def test_own_factories_and_their_rates() -> None:
    """Item 2: the own capital is a factory from the start at 50 ticks per charge, a built factory
    at 100; another own city is no factory; a province is never one (``None``)."""
    m = _match()
    m.state.nodes[M].owner = 0
    m.state.nodes[A].factory = 0
    m.step()
    assert _v2(_node(m, 0, K)) == (True, 50, None, False, None)
    assert _v2(_node(m, 0, A)) == (True, 100, None, False, None)
    assert _v2(_node(m, 0, B)) == (False, None, None, False, None)
    assert _v2(_node(m, 0, M)) == (None, None, None, False, None)


def test_a_factory_build_shows_the_owed_charges_then_the_done_tick() -> None:
    """Item 7: an unpaid build has no done tick; ``build_ticks = 100`` after the full payment.
    ``BuildFactory(A)`` at tick 10 with an empty warehouse owes ``factory.cost = 4``; 4 charges
    put into A pay it in tick 11 (the ``build`` system), so it is done at tick 111."""
    m = _match()
    m.state.nodes[A].warehouse = 0
    _to(m, 10, BuildFactory(A))
    assert _node(m, 0, A).factory_build == SiteBuildView(done_tick=None, owed=4)
    m.state.nodes[A].warehouse = 2  # the capacity of a large city in mvp-3
    _to(m, 11)
    assert _node(m, 0, A).factory_build == SiteBuildView(done_tick=None, owed=2)
    m.state.nodes[A].warehouse = 2
    _to(m, 12)
    assert _node(m, 0, A).factory_build == SiteBuildView(done_tick=112, owed=0)
    _to(m, 112)
    a = _node(m, 0, A)
    assert (a.factory, a.factory_period, a.factory_build) == (True, 100, None)


def test_an_unpaid_city_build_has_no_done_tick() -> None:
    """Item 7: the barracks of B owes ``city_upgrades.barracks_charges = 3`` and has no done
    tick until paid (B starts empty under ``start_stock_capital_only``, no group there)."""
    m = _match()
    _to(m, 10, BuildBarracks(B))
    building = _node(m, 0, B).building
    assert building is not None
    assert (building.done_tick, building.owed) == (None, 3)


# The enemy's factory and bunker by the DEC-31 rule (items 2, 12, 14) --------------------------


def _enemy_works(m: Match) -> None:
    """A built factory and a bunker in the enemy city 13; a bunker in the enemy province 18; a
    factory build and a bunker build in the enemy city 14 (both never visible to player 0)."""
    s = m.state
    s.nodes[ENEMY_CITY].factory = 1
    s.nodes[ENEMY_CITY].fort = True
    s.nodes[SOUTH_PASS].owner = 1
    s.nodes[SOUTH_PASS].fort = True
    s.nodes[14].factory_build = FactoryBuild(owner=1, since=0, owed=0)
    s.nodes[14].fort_build = FactoryBuild(owner=1, since=0, owed=2)


def test_fog_enemy_factory_and_bunker_only_next_to_an_own_node() -> None:
    """DEC-31 rule: no own node next to the enemy's 13 and 18: nothing of them; once the own M
    borders 13 and the own D borders 18 (always), the built factory and bunkers are seen. The
    enemy capital (next to no own node) shows nothing, also not its factory."""
    m = _match()
    _enemy_works(m)
    m.step()
    # D borders 18 (edge 24) from the start: the bunker of the enemy province is seen.
    assert _v2(_node(m, 0, SOUTH_PASS)) == (None, None, None, True, None)
    assert _v2(_node(m, 0, ENEMY_CITY)) == (None,) * 5
    assert _v2(_node(m, 0, ENEMY_CAPITAL)) == (None,) * 5
    m.state.nodes[M].owner = 0  # now 13 is next to an own node (edge 21)
    m.step()
    assert _v2(_node(m, 0, ENEMY_CITY)) == (True, None, None, True, None)
    assert _v2(_node(m, 0, ENEMY_CAPITAL)) == (None,) * 5


def test_fog_enemy_builds_are_never_seen() -> None:
    """Items 2 and 12, "only a built one": next to an own node, an enemy city that builds a
    factory and a bunker shows ``False`` for both, never the builds or what they owe; the
    enemy's factory rate is never in a view."""
    m = _match()
    _enemy_works(m)
    s = m.state
    s.nodes[13].owner = 0  # an own node next to 14 (edge 15)
    m.step()
    city = _node(m, 0, 14)
    assert _v2(city) == (False, None, None, False, None)
    own_view = _node(m, 1, 14)
    assert own_view.factory_build == SiteBuildView(done_tick=100, owed=0)
    assert own_view.fort_build == SiteBuildView(done_tick=None, owed=2)


def test_v1_views_have_no_economy_v2_fields() -> None:
    """Under ``economy.model = "v1"`` every economy v2 field is empty."""
    m = Match(MAP, V1, KEY)
    m.step()
    for p in (0, 1):
        view = project(m.state, V1, p, KEY)
        assert view.lines == ()
        assert all(_v2(n) == (None,) * 5 for n in view.nodes)


def test_no_road_upgrade_is_offered_under_v2() -> None:
    """Items 5 and 8: road upgrades are removed; v1 still offers them on own internal edges."""
    m = _match()
    m.step()
    assert all(e.upgrade_gain is None for e in project(m.state, RULES, 0, KEY).edges)
    v1 = Match(MAP, V1, KEY)
    v1.step()
    assert any(e.upgrade_gain is not None for e in project(v1.state, V1, 0, KEY).edges)


# The planned order gathers its bonus (item 10, table P1) ----------------------------------------


def test_a_gathering_plan_shows_its_request_progress_and_next_charge() -> None:
    """P1: group 3/3 in B holding 2, ``Move(planned, bonus = 2)`` at tick 10: charges at ticks 40
    and 70, the group departs at tick 71 with bonus 2. While it gathers the order has no
    departure tick, the request 2, the bonus so far and the tick of the next charge."""
    m = _match()
    g = _group(m, B, 3, 3)
    m.state.nodes[B].warehouse = 2
    _to(m, 10, Move(g.id, M, planned=True, bonus=2))

    def order() -> tuple[object, ...]:
        o = _own(m, g).order
        assert o is not None
        return (o.gathering, o.plan, o.bonus, o.depart_tick, o.next_charge_tick)

    assert order() == (True, 2, 0, None, 40)
    _to(m, 40)
    assert order() == (True, 2, 1, None, 70)
    _to(m, 70)
    assert order() == (False, 0, 2, 71, None)


def test_a_released_plan_departs_with_the_bonus_gathered() -> None:
    """P5: ``bonus = 3``, one charge taken, ``ReleasePlan`` at tick 52: the order departs at once
    with bonus 1 and no longer gathers."""
    m = _match()
    g = _group(m, B, 3, 3)
    m.state.nodes[B].warehouse = 2
    _to(m, 10, Move(g.id, M, planned=True, bonus=3))
    _to(m, 52, ReleasePlan(g.id))
    o = _own(m, g).order
    assert o is not None
    assert (o.gathering, o.plan, o.bonus, o.next_charge_tick) == (False, 0, 1, None)


def test_fog_the_enemy_sees_only_the_intent_of_a_gathering_plan() -> None:
    """Item 10 and DEC-32: the enemy sees the public intent, never the request or the bonus: its
    views are equal whatever the request and the bonus gathered so far."""
    m = _match()
    g = _group(m, B, 3, 3)
    m.state.nodes[B].warehouse = 2
    _to(m, 10, Move(g.id, M, planned=True, bonus=2))
    before = view_to_canonical(project(m.state, RULES, 1, KEY))
    m.state.groups[g.id] = replace(g, plan=5, bonus=1, plan_tick=3)
    assert view_to_canonical(project(m.state, RULES, 1, KEY)) == before
