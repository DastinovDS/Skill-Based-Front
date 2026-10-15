"""Supply control: priorities, transit cities, one-off transfers (DEC-18, #230).

Table tests of exactly the 25 worked examples of DEC-18 (mechanics.md, section 7). Expected
values come from the decision, not from the code. The setting of the examples:

- capital K (capacity 10); cities A, B, C (capacity 6); roads K-A, A-B, A-C; the province P only
  in examples 8, 15 and 20; every road ``travel_ticks = 30``, level 1 (``speed_pct`` 100,
  ``amount`` 1) unless said otherwise; ``buffer = 2``, ``dispatch_ticks = 10``; ``node_key``
  grows in the order K, A, B, C; no units; warehouses as at the dispatch (after recharge); the
  result describes one dispatch period.

These numbers are pinned in ``RULES``, so balance changes of ``mvp-0.toml`` do not break them.

Map ``dec18`` (rot180): K = 0 (capital of 0), A = 1, B = 2, C = 3 (medium cities); P = 4 (a
province, neutral unless a test takes it) with K -e3- P -e4- B; X = 5 (a neutral medium city,
example 14 gives it to player 0) reached only through E = 6 (a medium city the tests give to
player 1) from C; E -e7- 7 joins the mirror half.
Roads: K-A e0, A-B e1, A-C e2.
"""

import dataclasses
from pathlib import Path

import pytest

from gow_sim.commands import (
    Ok,
    PlayerCommand,
    Reject,
    RejectCode,
    SetPriority,
    Transfer,
    apply_commands,
)
from gow_sim.maps import load_map
from gow_sim.ruleset import KindTable, LevelTable, Ruleset, load_ruleset
from gow_sim.state import Event, GameState, Packet, Priority, initial_state
from gow_sim.systems.capacity import change_owner
from gow_sim.systems.supply import packet_dest, supply

TESTS_DIR = Path(__file__).resolve().parent
MVP0 = TESTS_DIR.parents[2] / "rulesets" / "mvp-0.toml"


def _rules() -> Ruleset:
    base = load_ruleset(MVP0)
    return dataclasses.replace(
        base,
        capacity=dataclasses.replace(
            base.capacity,
            by_kind=KindTable(capital=10, city_large=8, city_medium=6, city_small=4, province=3),
        ),
        supply=dataclasses.replace(
            base.supply,
            dispatch_ticks=10,
            buffer=2,
            base_speed_pct=100,
            base_amount=1,
            fast_speed_pct=LevelTable((150, 200)),
        ),
        orders=dataclasses.replace(
            base.orders,
            cost=dataclasses.replace(base.orders.cost, priority=0, transfer=0),
        ),
    )


RULES = _rules()

K, A, B, C, P, X, E = 0, 1, 2, 3, 4, 5, 6
KA, AB, AC = 0, 1, 2
DISPATCH = 10
T = 101
"""Tick of the transfer commands: not a dispatch tick, nor are the arrivals checked below."""


def _state(**warehouses: int) -> GameState:
    state = initial_state(load_map(TESTS_DIR / "maps" / "dec18.json"), RULES)
    for name, charges in warehouses.items():
        state.nodes[{"K": K, "A": A, "B": B, "C": C}[name]].warehouse = charges
    return state


def _road(state: GameState, edge: int, level: int) -> None:
    state.edges[edge].width = level


def _dispatch(state: GameState) -> list[tuple[int, int, int]]:
    """One dispatch at tick ``DISPATCH``: ``(from, to, charges)`` of the new packets of player 0."""
    state.tick = DISPATCH
    before = set(state.packets)
    supply(state, RULES)
    return sorted(
        (p.from_node, packet_dest(state, p), p.charges)
        for pid, p in state.packets.items()
        if pid not in before and p.owner == 0
    )


def _cmd(state: GameState, cmd: SetPriority | Transfer) -> Ok | Reject:
    results, _ = apply_commands(state, RULES, [PlayerCommand(0, 0, cmd)])
    return results[0].outcome


def _until(state: GameState, tick: int) -> list[Event]:
    events: list[Event] = []
    while state.tick < tick:
        state.tick += 1
        events += supply(state, RULES)
    return events


def _transfer(state: GameState, src: int, dst: int, n: int) -> Packet:
    state.tick = T
    assert isinstance(_cmd(state, Transfer(src, dst, n)), Ok)
    (packet,) = (p for p in state.packets.values() if p.transfer)
    return packet


# Dispatch: examples 1-8 and 22 -----------------------------------------------------------------


def test_example_1_capital_sends_one_charge_over_a_level_1_road() -> None:
    # Target K 2, surplus 3; subtree deficit of A 2 + 2 + 2 = 6; K sends A 1 charge (amount 1).
    state = _state(K=5)
    assert _dispatch(state) == [(K, A, 1)]
    assert state.nodes[K].warehouse == 4


def test_example_2_equal_stock_lower_node_key_first() -> None:
    # Target A 2, surplus 1; B and C both 0 with deficit 2: B (lower node_key) gets 1.
    state = _state(A=3)
    assert _dispatch(state) == [(A, B, 1)]
    assert state.nodes[A].warehouse == 2


def test_example_3_high_priority_child_first() -> None:
    # Pass high: A inactive, gives C 1; pass normal: A's surplus 0, B nothing.
    state = _state(A=3)
    state.nodes[C].priority = Priority.HIGH
    assert _dispatch(state) == [(A, C, 1)]
    assert state.nodes[A].warehouse == 2


def _chain(**warehouses: int) -> GameState:
    """K-A-B without C."""
    state = _state(**warehouses)
    state.nodes[C].owner = None
    return state


def test_example_4_low_city_is_transit_in_the_normal_pass() -> None:
    state = _chain(A=2)
    state.nodes[A].priority = Priority.LOW
    _road(state, AB, 3)
    # Pass normal: A inactive (transit), B gets 1 (amount 1 on every level, DEC-26); pass low:
    # A active, target 2, warehouse 1: it gives nothing.
    assert _dispatch(state) == [(A, B, 1)]
    assert state.nodes[A].warehouse == 1


def test_example_5_normal_city_keeps_its_target() -> None:
    state = _chain(A=2)
    _road(state, AB, 3)
    assert _dispatch(state) == []
    assert state.nodes[A].warehouse == 2


def test_example_6_equal_priority_nearer_city_keeps_its_target_first() -> None:
    state = _chain(A=4)
    state.nodes[A].priority = Priority.HIGH
    state.nodes[B].priority = Priority.HIGH
    _road(state, AB, 3)
    # Surplus 2 for B, but the road lets 1 through (DEC-26: amount 1 on level 3).
    assert _dispatch(state) == [(A, B, 1)]
    assert state.nodes[A].warehouse == 3


def test_example_7_high_city_behind_a_normal_one() -> None:
    state = _chain(A=3, B=1)
    state.nodes[B].priority = Priority.HIGH
    # Target B 2, deficit 1; pass high: A inactive (target 0), gives B 1; pass normal: A's
    # surplus 0.
    assert _dispatch(state) == [(A, B, 1)]
    assert state.nodes[A].warehouse == 2


def test_example_8_packet_goes_through_a_province_without_stopping() -> None:
    state = _state(K=5)
    state.nodes[A].owner = None
    state.nodes[C].owner = None
    state.nodes[P].owner = 0
    assert _dispatch(state) == [(K, B, 1)]
    (packet,) = state.packets.values()
    assert (packet.edge, packet.route) == (3, (4,))  # K-P, then P-B
    events = _until(state, DISPATCH + 60)
    delivered = [(e.tick, e.get("node")) for e in events if e.kind == "packet_delivered"]
    assert delivered[0] == (DISPATCH + 60, B)  # 60 ticks on the way, nothing left in P
    assert state.nodes[P].warehouse == 0


def test_example_22_all_normal_least_stock_first() -> None:
    # Surplus A 1; deficits B 1, C 2; C with the least stock first: packet A-C 1, B nothing.
    state = _state(A=3, B=1)
    assert _dispatch(state) == [(A, C, 1)]


# Transfers: examples 9-19 ------------------------------------------------------------------------


def test_example_9_transfer_time_with_batches() -> None:
    state = _state(A=5)
    packet = _transfer(state, A, B, 4)
    assert state.nodes[A].warehouse == 1  # in tick t
    _until(state, T + 59)
    assert state.nodes[B].warehouse == 0
    _until(state, T + 60)  # t + 30 + 3 * 10
    assert state.nodes[B].warehouse == 4
    assert packet.id not in state.packets


def test_example_10_transfer_on_a_level_3_road() -> None:
    state = _state(A=5)
    _road(state, AB, 3)
    _transfer(state, A, B, 4)
    _until(state, T + 44)
    assert state.nodes[B].warehouse == 0
    _until(state, T + 45)  # t + 15 + 3 * 10 (speed 200, amount 1; DEC-26)
    assert state.nodes[B].warehouse == 4


def test_example_11_transfer_on_a_fast_road() -> None:
    state = _state(A=5)
    _road(state, AB, 3)
    _transfer(state, A, B, 1)
    _until(state, T + 14)
    assert state.nodes[B].warehouse == 0
    _until(state, T + 15)
    assert state.nodes[B].warehouse == 1


def test_transfer_ack_has_the_path_and_the_arrival_tick() -> None:
    state = _state(A=5)
    state.tick = T
    assert _cmd(state, Transfer(A, B, 4)) == Ok(cost=0, path=(A, B), arrive_tick=T + 60)


def test_example_12_not_enough_charges() -> None:
    state = _state(A=5)
    assert _cmd(state, Transfer(A, B, 6)) == Reject(RejectCode.NOT_ENOUGH_CHARGES)


def test_example_13_enemy_city() -> None:
    state = _state(A=5)
    state.nodes[E].owner = 1
    assert _cmd(state, Transfer(A, E, 1)) == Reject(RejectCode.NOT_OWNER)


def test_example_14_no_path_through_an_enemy_node() -> None:
    state = _state(A=5)
    state.nodes[E].owner = 1
    state.nodes[X].owner = 0
    assert _cmd(state, Transfer(A, X, 1)) == Reject(RejectCode.NO_PATH)


def test_example_15_province_is_not_a_city() -> None:
    state = _state(A=5)
    state.nodes[P].owner = 0
    assert _cmd(state, Transfer(P, B, 1)) == Reject(RejectCode.NOT_CITY)


def test_example_16_packet_lost_when_its_road_stops_being_internal() -> None:
    state = _state(K=3)
    packet = _transfer(state, K, B, 3)
    assert packet.route == (AB,)
    _until(state, T + 55)  # on A-B since t + 50 (30 + 2 * 10 per road)
    assert (packet.edge, packet.from_node) == (AB, A)
    change_owner(state, A, 1)
    events = _until(state, T + 56)
    assert [(e.kind, e.get("charges")) for e in events] == [("packet_lost", 3)]
    assert packet.id not in state.packets


def test_example_17_way_cut_ahead_charges_stay_in_the_city() -> None:
    state = _state(K=3)
    packet = _transfer(state, K, C, 3)
    _until(state, T + 10)  # on K-A
    change_owner(state, C, 1)
    events = _until(state, T + 50)
    assert [(e.kind, e.get("node"), e.get("charges")) for e in events] == [
        ("packet_delivered", A, 3)
    ]
    assert state.nodes[A].warehouse == 3
    assert packet.id not in state.packets


def test_example_18_transfer_overflow_burns() -> None:
    state = _state(A=3, B=5)
    _transfer(state, A, B, 3)
    events = _until(state, T + 50)
    assert state.nodes[B].warehouse == 6  # capacity 6: B gets 1
    assert [(e.kind, e.get("charges")) for e in events] == [
        ("packet_delivered", 1),
        ("charges_overflow", 2),
    ]


def test_example_19_a_packet_to_a_captured_city_is_lost() -> None:
    state = _state(A=2)
    _road(state, AB, 2)
    _transfer(state, A, B, 2)
    _until(state, T + 10)
    change_owner(state, B, 1)
    events = _until(state, T + 30)
    assert state.nodes[B].warehouse == 0  # no freight road, nothing for the captor (DEC-26)
    lost = [(e.get("player"), e.get("charges")) for e in events if e.kind == "packet_lost"]
    assert lost == [(0, 2)]
    assert not [e for e in events if e.kind == "packet_captured"]


# Transfers share the road with the automatic dispatch: examples 23-25 (item 10, #253) -----------

SHARED_T = 110
"""A dispatch tick ``t`` for examples 23 and 24."""


def _sent(events: list[Event]) -> list[tuple[int, object, object, object]]:
    """``(tick, from, to, charges)`` of the automatic packets of player 0 in ``events``."""
    return [
        (e.tick, e.get("from_node"), e.get("to_node"), e.get("charges"))
        for e in events
        if e.kind == "packet_sent" and e.get("player") == 0
    ]


def _transfer_on_dispatch_tick(state: GameState, src: int, dst: int, n: int) -> list[Event]:
    """``Transfer`` applied at the dispatch tick ``SHARED_T``, then the supply of that tick."""
    state.tick = SHARED_T
    assert isinstance(_cmd(state, Transfer(src, dst, n)), Ok)
    return supply(state, RULES)


def test_example_23_transfer_takes_the_road_first() -> None:
    state = _state(K=5)
    events = _transfer_on_dispatch_tick(state, K, A, 2)
    assert state.nodes[K].warehouse == 3
    events += _until(state, SHARED_T + 20)
    # t and t + 10: the transfer takes the amount 1 of K-A; t + 20: K sends A 1 charge.
    assert _sent(events) == [(SHARED_T + 20, K, A, 1)]
    _until(state, SHARED_T + 39)
    assert state.nodes[A].warehouse == 0
    _until(state, SHARED_T + 40)  # t + 30 + 1 * 10
    assert state.nodes[A].warehouse == 2


# Example 24 (a freight road) is deleted by DEC-26: there is no freight road.


def test_example_25_transfer_entering_the_next_road_takes_it_again() -> None:
    state = _state(A=3)
    pid = state.new_id()
    packet = Packet(
        pid,
        0,
        KA,
        from_node=K,
        charges=1,
        depart_tick=DISPATCH - 30,
        arrive_tick=DISPATCH,
        route=(AB,),
        route_ticks=(30,),
        transfer=True,
    )
    state.packets[pid] = packet
    assert _dispatch(state) == [(A, C, 1)]  # A-B taken by the transfer: the surplus goes to C
    assert (packet.edge, packet.from_node, packet.share) == (AB, A, 0)


# Priority: examples 20 and 21 --------------------------------------------------------------------


def test_example_20_province_has_no_priority() -> None:
    state = _state()
    state.nodes[P].owner = 0
    assert _cmd(state, SetPriority(P, Priority.HIGH)) == Reject(RejectCode.NOT_CITY)


def test_example_21_priority_resets_on_owner_change() -> None:
    state = _state()
    assert _cmd(state, SetPriority(C, Priority.HIGH)) == Ok(cost=0)
    assert state.nodes[C].priority is Priority.HIGH
    change_owner(state, C, 1)
    change_owner(state, C, 0)
    assert state.nodes[C].priority is Priority.NORMAL


# Check order of item 1 (beyond the table) ------------------------------------------------------


@pytest.mark.parametrize(
    ("node", "owner", "level", "code"),
    [
        (99, None, Priority.HIGH, RejectCode.NOT_FOUND_OR_HIDDEN),
        (E, 1, Priority.HIGH, RejectCode.NOT_OWNER),
        (A, 0, Priority.NORMAL, RejectCode.NO_CHANGE),
    ],
)
def test_set_priority_rejects(
    node: int, owner: int | None, level: Priority, code: RejectCode
) -> None:
    state = _state()
    if node < len(state.nodes):
        state.nodes[node].owner = owner
    assert _cmd(state, SetPriority(node, level)) == Reject(code)


def test_transfer_from_equals_to_is_invalid() -> None:
    state = _state(A=5)
    assert _cmd(state, Transfer(A, A, 1)) == Reject(RejectCode.INVALID_ARGUMENT)
    assert _cmd(state, Transfer(A, B, 0)) == Reject(RejectCode.INVALID_ARGUMENT)


def test_transfer_inside_a_cut_off_pocket() -> None:
    # A cut off from K (K-A lost): A -> B is still allowed (owner 2026-10-12).
    state = _state(A=2)
    state.nodes[K].owner = 1
    assert isinstance(_cmd(state, Transfer(A, B, 2)), Ok)
