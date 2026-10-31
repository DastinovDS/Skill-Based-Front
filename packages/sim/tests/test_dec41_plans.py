"""Economy v2, part 3 (DEC-41, #642; implementation #646): the planned order gathers its bonus,
a capture costs a charge.

Expected values come from mechanics.md, section 7, block "Economy v2 (DEC-41, #642)": item 10
(the planned order costs as much as an ordinary one, ``orders.cost.planned_move =
orders.cost.move``; the player names the requested bonus ``b >= 1`` and the intent is public at
once; while waiting the group takes 1 real charge from the warehouse of its node once per
``orders.plan_ticks_per_bonus = 30`` ticks and the bonus grows by 1; the units recharge first;
an empty warehouse pauses the plan with no timeout; ``ReleasePlan`` sends the group at once with
the bonus gathered, free; a cancel is free and the consumed charges are lost; the bonus is at
most the charged units; the group departs by itself at ``b`` or at the cap; the DEC-29 distance
bonus is removed; a province works too) and item 11 (``capture.charge_cost = 1``), and the
implementation notes of #646 under that block.

Map ``dec41`` (see ``test_dec41.py``): player 0 owns K = 0 (capital), A = 1 (large), B, C, D =
2, 3, 4 (medium), E, F, G = 5, 6, 7 (small); M = 8 is a neutral province next to C; player 1
owns 9..16 (its capital 16). Warehouse capacities of ``mvp-3``: medium 2, province 1. Only the
capital produces, and no line is drawn, so the warehouse of B holds exactly what a test puts in.
"""

from pathlib import Path

from gow_sim.commands import (
    CancelOrder,
    Command,
    Move,
    Ok,
    PlayerCommand,
    Reject,
    RejectCode,
    ReleasePlan,
    validate,
)
from gow_sim.maps import load_map
from gow_sim.match import HEADLESS_MATCH_KEY, Match
from gow_sim.ruleset import load_ruleset
from gow_sim.state import PLAN_WAIT, AtNode, Event, Group, IntentKind, Mode, OnEdge
from gow_sim.systems.combat import Bonus, BonusSource
from gow_sim.systems.orders import active_bonuses
from gow_sim.view import project

TESTS_DIR = Path(__file__).resolve().parent
ROOT = TESTS_DIR.parents[2]
RULES = load_ruleset(ROOT / "rulesets" / "mvp-3.toml")
V1 = load_ruleset(ROOT / "rulesets" / "mvp-2.toml")
MAP = load_map(TESTS_DIR / "maps" / "dec41.json")
K, A, B, C, D, E, F, G, M = range(9)


def _match() -> Match:
    return Match(MAP, RULES, HEADLESS_MATCH_KEY)


def _group(m: Match, node: int, units: int, charged: int, owner: int = 0) -> Group:
    state = m.state
    gid = state.new_id()
    group = Group(gid, owner, units, charged, Mode.ATTACK, AtNode(node))
    state.groups[gid] = group
    return group


def _to(m: Match, tick: int, *cmds: Command) -> list[Event]:
    """Step ``m`` until ``m.tick == tick``; ``cmds`` (player 0) are applied at ``tick``."""
    events: list[Event] = []
    while m.tick < tick - 1:
        events += m.step()
    events += m.step([PlayerCommand(0, seq, c) for seq, c in enumerate(cmds)])
    return events


def _charged(events: list[Event]) -> list[tuple[int, object, object]]:
    """``(tick, node, bonus)`` of the ``plan_charged`` events."""
    return [(e.tick, e.get("node"), e.get("bonus")) for e in events if e.kind == "plan_charged"]


def _outcome(m: Match) -> Ok | Reject:
    return m.results[0].outcome


# Item 10: the price, the request, the public intent -----------------------------------------


def test_a_planned_order_costs_an_ordinary_move_and_starts_with_no_bonus() -> None:
    """Item 10: ``planned_move = move`` (1 CP), the DEC-29 distance bonus is removed (B -> C ->
    M is two edges, the bonus stays 0), the intent is public at once, the group waits."""
    m = _match()
    g = _group(m, B, 3, 3)
    cp = m.state.players[0].cp
    _to(m, 10, Move(g.id, M, planned=True, bonus=2))
    assert isinstance(_outcome(m), Ok)
    assert m.state.players[0].cp == cp - RULES.orders.cost.move == cp - 100
    assert g.order is not None and g.order.depart_tick == PLAN_WAIT
    assert (g.bonus, g.plan, g.plan_tick) == (0, 2, 10)
    assert g.location == AtNode(B)
    enemy = project(m.state, RULES, 1, HEADLESS_MATCH_KEY)
    intents = [(i.kind, i.origin, i.target) for i in enemy.intents]
    assert intents == [(IntentKind.PLANNED_MOVE, B, M)]


def test_the_requested_bonus_is_checked() -> None:
    """Item 10: a v2 planned order needs ``b >= 1``; an ordinary order and a v1 planned order
    name none (v1 keeps the DEC-29 distance bonus)."""
    m = _match()
    g = _group(m, B, 3, 3)
    state = m.state
    invalid = Reject(RejectCode.INVALID_ARGUMENT)
    assert validate(state, RULES, 0, Move(g.id, C, planned=True)) == invalid
    assert validate(state, RULES, 0, Move(g.id, C, planned=True, bonus=-1)) == invalid
    assert validate(state, RULES, 0, Move(g.id, C, bonus=1)) == invalid
    assert isinstance(validate(state, RULES, 0, Move(g.id, C, planned=True, bonus=1)), Ok)
    assert validate(state, V1, 0, Move(g.id, C, planned=True, bonus=1)) == invalid


def test_release_plan_is_of_economy_v2_and_needs_a_gathering_plan() -> None:
    m = _match()
    g = _group(m, B, 3, 3)
    state = m.state
    assert validate(state, V1, 0, ReleasePlan(g.id)) == Reject(RejectCode.FEATURE_DISABLED)
    assert validate(state, RULES, 0, ReleasePlan(g.id)) == Reject(RejectCode.NOTHING_TO_CANCEL)
    assert validate(state, RULES, 1, ReleasePlan(g.id)) == Reject(RejectCode.NOT_FOUND_OR_HIDDEN)
    assert validate(state, RULES, 0, ReleasePlan(999)) == Reject(RejectCode.NOT_FOUND_OR_HIDDEN)


# Item 10: gathering ----------------------------------------------------------------------------


def test_one_charge_per_30_ticks_and_the_group_departs_at_the_requested_bonus() -> None:
    """Item 10: tick 10 ``b = 2``, B holds 2: a charge at ticks 40 and 70, the warehouse ends
    empty, the bonus is 2; the group departs by itself in the next tick, 71."""
    m = _match()
    m.state.nodes[B].warehouse = 2
    g = _group(m, B, 3, 3)
    events = _to(m, 10, Move(g.id, C, planned=True, bonus=2))
    events += _to(m, 70)
    assert _charged(events) == [(40, B, 1), (70, B, 2)]
    assert m.state.nodes[B].warehouse == 0
    assert g.location == AtNode(B) and g.plan == 0
    assert g.order is not None and g.order.depart_tick == 71
    _to(m, 71)
    assert isinstance(g.location, OnEdge) and (g.charged, g.bonus) == (3, 2)


def test_the_units_recharge_before_the_plan_takes_a_charge() -> None:
    """Item 10 (P4): a group 3/2, B holds 1 at the due tick 40: the unit recharges (3/3) and the
    plan takes nothing; the next charge (tick 45) goes to the plan."""
    m = _match()
    g = _group(m, B, 3, 2)
    events = _to(m, 10, Move(g.id, C, planned=True, bonus=2))
    events += _to(m, 39)
    m.state.nodes[B].warehouse = 1
    events += _to(m, 44)
    assert (g.charged, g.bonus, m.state.nodes[B].warehouse) == (3, 0, 0)
    m.state.nodes[B].warehouse = 1
    events += _to(m, 45)
    assert _charged(events) == [(45, B, 1)]
    assert (g.charged, g.bonus, m.state.nodes[B].warehouse) == (3, 1, 0)


def test_an_empty_warehouse_pauses_the_plan_with_no_timeout() -> None:
    """Item 10 (P2): B is empty, the plan waits; stock at tick 300 is taken at once, the next
    one 30 ticks after that charge."""
    m = _match()
    g = _group(m, B, 3, 3)
    events = _to(m, 10, Move(g.id, C, planned=True, bonus=2))
    events += _to(m, 299)
    assert _charged(events) == [] and g.order is not None and g.location == AtNode(B)
    m.state.nodes[B].warehouse = 2
    events += _to(m, 330)
    assert _charged(events) == [(300, B, 1), (330, B, 2)]
    assert g.order is not None and g.order.depart_tick == 331


def test_the_bonus_is_capped_by_the_charged_units_and_the_group_departs_at_the_cap() -> None:
    """Item 10: a group 2/2 requests 5, B holds 2: bonus 2 at tick 70 is the cap, the group
    departs at 71 and B keeps nothing for a third bonus."""
    m = _match()
    m.state.nodes[B].warehouse = 2
    g = _group(m, B, 2, 2)
    events = _to(m, 10, Move(g.id, C, planned=True, bonus=5))
    events += _to(m, 71)
    assert _charged(events) == [(40, B, 1), (70, B, 2)]
    assert isinstance(g.location, OnEdge) and g.bonus == 2


def test_release_departs_at_once_with_the_bonus_gathered_free() -> None:
    """Item 10: ``ReleasePlan`` at tick 52 after one charge: the group is on its edge in tick
    52 with bonus 1, no CP; the bonus is active from the departure (not while waiting)."""
    m = _match()
    m.state.nodes[B].warehouse = 2
    g = _group(m, B, 3, 3)
    _to(m, 10, Move(g.id, C, planned=True, bonus=3))
    _to(m, 51)
    assert g.bonus == 1 and active_bonuses(m.state, RULES) == {}
    cp = m.state.players[0].cp
    _to(m, 52, ReleasePlan(g.id))
    assert isinstance(_outcome(m), Ok) and m.state.players[0].cp == cp
    assert isinstance(g.location, OnEdge) and (g.bonus, g.plan) == (1, 0)
    assert active_bonuses(m.state, RULES) == {g.id: Bonus(BonusSource.PLANNED_ORDER, 1)}
    assert m.state.nodes[B].warehouse == 1
    assert [i.kind for i in m.state.intents.values()] == [IntentKind.PLANNED_MOVE]


def test_a_cancel_is_free_and_the_consumed_charges_are_lost() -> None:
    """Item 10: ``CancelOrder`` after one charge: no order, no bonus, no intent, the charge is
    not returned and no CP is taken."""
    m = _match()
    m.state.nodes[B].warehouse = 2
    g = _group(m, B, 3, 3)
    _to(m, 10, Move(g.id, C, planned=True, bonus=3))
    _to(m, 51)
    cp = m.state.players[0].cp
    _to(m, 52, CancelOrder(g.id))
    assert isinstance(_outcome(m), Ok) and m.state.players[0].cp == cp
    assert (g.order, g.bonus, g.plan, g.intent) == (None, 0, 0, None)
    assert m.state.nodes[B].warehouse == 1 and m.state.intents == {}
    _to(m, 100)
    assert m.state.nodes[B].warehouse == 1  # nothing more is taken


def test_a_province_gathers_too() -> None:
    """Item 10 (and item 13): an own province M holds 1; a group 2/2 requests 1: the charge at
    tick 40, the departure at 41."""
    m = _match()
    m.state.nodes[M].owner = 0
    m.state.nodes[M].warehouse = 1
    g = _group(m, M, 2, 2)
    events = _to(m, 10, Move(g.id, C, planned=True, bonus=1))
    events += _to(m, 41)
    assert _charged(events) == [(40, M, 1)]
    assert m.state.nodes[M].warehouse == 0
    assert isinstance(g.location, OnEdge) and g.bonus == 1


def test_a_v1_planned_order_keeps_the_delay_and_the_distance_bonus() -> None:
    """v1 unchanged: ``planned_delay_ticks = 30``, the DEC-29 bonus per edge (B -> C -> M: 2),
    no charge taken."""
    m = Match(MAP, V1, HEADLESS_MATCH_KEY)
    m.state.nodes[B].warehouse = 2
    g = _group(m, B, 3, 3)
    events = _to(m, 10, Move(g.id, M, planned=True))
    assert g.order is not None and g.order.depart_tick == 40
    assert (g.bonus, g.plan) == (2, 0)
    events += _to(m, 40)
    assert _charged(events) == [] and m.state.nodes[B].warehouse == 2


# Item 11: a capture spends one charge ----------------------------------------------------------


def test_a_capture_spends_one_charge_and_destroys_the_bunker_and_takes_the_factory() -> None:
    """Item 11 (DEC-38) with items 2, 12, 13: an own group 2/2 walks into the empty enemy city
    9 (player 1's built factory, a bunker, 1 charge in its warehouse): the capture spends one
    charge (2/1), the bunker is destroyed, the factory passes to the capturer (it has only its
    capital), the warehouse is lost."""
    m = _match()
    state = m.state
    state.nodes[14].owner = 0  # the group stands in an own node next to 9
    state.nodes[9].fort = True
    state.nodes[9].factory = 1
    state.nodes[9].warehouse = 1
    g = _group(m, 14, 2, 2)
    events = _to(m, 1, Move(g.id, 9))
    while state.nodes[9].owner != 0 and m.tick < 60:
        events += m.step()
    assert state.nodes[9].owner == 0
    assert (g.units, g.charged) == (2, 1)
    assert state.nodes[9].fort is False
    assert state.nodes[9].factory == 0
    assert any(e.kind == "warehouse_lost" and e.get("node") == 9 for e in events)


def test_a_group_without_a_charge_cannot_capture_and_bounces() -> None:
    """Item 11: a group 1/0 cannot pay for the empty neutral province M: it bounces."""
    m = _match()
    g = _group(m, C, 1, 0)
    events = _to(m, 1, Move(g.id, M))
    while not any(e.kind == "capture_failed" for e in events) and m.tick < 60:
        events += m.step()
    assert m.state.nodes[M].owner is None
    assert [e.get("result") for e in events if e.kind == "capture_failed"] == ["bounce"]
