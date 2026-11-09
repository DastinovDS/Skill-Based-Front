"""Factories and planned orders in the ``PlayerView`` (DEC-41, #642; protocol and view: #647).

Expected values come from mechanics.md, section 7, block "Economy v2 (DEC-41, #642)": item 2
(the capital is a factory from the start, 1 charge per 50 ticks in the DEC-41 table; a built
factory per ``built_period_ticks = 100``; ``build_ticks = 100``), item 7 (the progressive payment:
the build time starts when it is paid in full), item 10 (the requested bonus, one charge per
``orders.plan_ticks_per_bonus = 30`` ticks; table P1) and item 14 ("an enemy factory follows the
DEC-31 rule"). ``RULES`` pins the DEC-41 numbers on ``mvp-6`` (the capital period under every
stance 50, DEC-44) with no dispatch of the supply flow (DEC-43), so the warehouses hold what a
test puts in; ``QUIET`` makes no charges at all, for the plans.

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
    Move,
    PlayerCommand,
    ReleasePlan,
)
from gow_sim.maps import load_map
from gow_sim.match import HEADLESS_MATCH_KEY, Match
from gow_sim.ruleset import Ruleset, StanceTable, load_ruleset
from gow_sim.state import AtNode, FactoryBuild, Group, Mode
from gow_sim.view import (
    GroupView,
    NodeView,
    SiteBuildView,
    opaque_id,
    project,
    view_to_canonical,
)

TESTS_DIR = Path(__file__).resolve().parent
ROOT = TESTS_DIR.parents[2]
_MVP6 = load_ruleset(ROOT / "rulesets" / "mvp-6.toml")
_NEVER = 10**6


def _periods(capital: int, built: int) -> Ruleset:
    return replace(
        _MVP6,
        stances=replace(
            _MVP6.stances,
            capital_period_ticks=StanceTable(economy=capital, balance=capital, war=capital),
        ),
        factory=replace(_MVP6.factory, built_period_ticks=built),
        supply=replace(_MVP6.supply, dispatch_ticks=_NEVER),
        capture=replace(_MVP6.capture, charge_cost=1),
    )


RULES = _periods(50, 100)
QUIET = _periods(_NEVER, _NEVER)
MAP = load_map(TESTS_DIR / "maps" / "dec41.json")
KEY = HEADLESS_MATCH_KEY
K, A, B, C, D, E, F, G, M = range(9)
ENEMY_CITY, ENEMY_CAPITAL, SOUTH_PASS = 13, 16, 18


def _match(rules: Ruleset = QUIET) -> Match:
    return Match(MAP, rules, KEY)


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
    return (n.factory, n.factory_period, n.factory_build)


# Factories (item 2) ------------------------------------------------------------------------------


def test_own_factories_and_their_rates() -> None:
    """Item 2: the own capital is a factory from the start at 50 ticks per charge, a built factory
    at 100; another own city is no factory; a province is never one (``None``)."""
    m = _match(RULES)
    m.state.nodes[M].owner = 0
    m.state.nodes[A].factory = 0
    m.step()
    assert _v2(_node(m, 0, K)) == (True, 50, None)
    assert _v2(_node(m, 0, A)) == (True, 100, None)
    assert _v2(_node(m, 0, B)) == (False, None, None)
    assert _v2(_node(m, 0, M)) == (None, None, None)


def test_a_factory_build_shows_the_owed_charges_then_the_done_tick() -> None:
    """Item 7: an unpaid build has no done tick; ``build_ticks = 100`` after the full payment.
    ``BuildFactory(A)`` at tick 10 with an empty warehouse owes ``factory.cost = 4``; 4 charges
    put into A pay it in tick 11 (the ``build`` system), so it is done at tick 111."""
    m = _match()
    m.state.nodes[A].warehouse = 0
    _to(m, 10, BuildFactory(A))
    assert _node(m, 0, A).factory_build == SiteBuildView(done_tick=None, owed=4)
    m.state.nodes[A].warehouse = 2
    _to(m, 11)
    assert _node(m, 0, A).factory_build == SiteBuildView(done_tick=None, owed=2)
    m.state.nodes[A].warehouse = 2
    _to(m, 12)
    assert _node(m, 0, A).factory_build == SiteBuildView(done_tick=112, owed=0)
    _to(m, 112)
    a = _node(m, 0, A)
    assert (a.factory, a.factory_period, a.factory_build) == (
        True,
        QUIET.factory.built_period_ticks,
        None,
    )


def test_an_unpaid_city_build_has_no_done_tick() -> None:
    """Item 7: the barracks of B owes ``city_upgrades.barracks_charges = 3`` and has no done
    tick until paid (B starts empty, DEC-41 item 9, no group there)."""
    m = _match()
    _to(m, 10, BuildBarracks(B))
    building = _node(m, 0, B).building
    assert building is not None
    assert (building.done_tick, building.owed) == (None, 3)


# The enemy's factory by the DEC-31 rule (items 2, 14) ------------------------------------------


def _enemy_works(m: Match) -> None:
    """A built factory in the enemy city 13; the enemy province 18; a factory build in the enemy
    city 14 (never visible to player 0)."""
    s = m.state
    s.nodes[ENEMY_CITY].factory = 1
    s.nodes[SOUTH_PASS].owner = 1
    s.nodes[14].factory_build = FactoryBuild(owner=1, since=0, owed=2)


def test_fog_enemy_factory_only_next_to_an_own_node() -> None:
    """DEC-31 rule: no own node next to the enemy's 13: nothing of it; once the own M borders 13
    the built factory is seen. The enemy capital (next to no own node) shows nothing, also not
    its factory; a province is never a factory."""
    m = _match()
    _enemy_works(m)
    m.step()
    assert _v2(_node(m, 0, SOUTH_PASS)) == (None,) * 3  # D borders it: a province, no factory
    assert _v2(_node(m, 0, ENEMY_CITY)) == (None,) * 3
    assert _v2(_node(m, 0, ENEMY_CAPITAL)) == (None,) * 3
    m.state.nodes[M].owner = 0  # now 13 is next to an own node (edge 21)
    m.step()
    assert _v2(_node(m, 0, ENEMY_CITY)) == (True, None, None)
    assert _v2(_node(m, 0, ENEMY_CAPITAL)) == (None,) * 3


def test_fog_enemy_builds_are_never_seen() -> None:
    """Item 2, "only a built one": next to an own node, an enemy city that builds a factory
    shows ``False``, never the build or what it owes; the enemy's factory rate is never in a
    view."""
    m = _match()
    _enemy_works(m)
    s = m.state
    s.nodes[13].owner = 0  # an own node next to 14 (edge 15)
    m.step()
    assert _v2(_node(m, 0, 14)) == (False, None, None)
    assert _node(m, 1, 14).factory_build == SiteBuildView(done_tick=None, owed=2)


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
    before = view_to_canonical(project(m.state, m.rules, 1, KEY))
    m.state.groups[g.id] = replace(g, plan=5, bonus=1, plan_tick=3)
    assert view_to_canonical(project(m.state, m.rules, 1, KEY)) == before
