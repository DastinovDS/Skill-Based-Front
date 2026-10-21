"""Supply control: one-off transfers and the packet path (DEC-18, #230).

Table tests of the worked examples of DEC-18 that DEC-28 keeps (mechanics.md, section 7; 29-33:
owner's decisions of 2026-10-15, #287): 8-17, 19, 23 and 29-33. Examples 1-7, 20-22 and 25-28
described the priorities, the targets and the forwarding reserve that DEC-28 replaces (its
examples: ``test_dec28.py``); 18 and 24 were replaced earlier. Expected values come from the
decision, not from the code. The setting of the examples:

- capital K (capacity 10); cities A, B, C (capacity 6); roads K-A, A-B, A-C; the province P only
  in examples 8 and 15; every road ``travel_ticks = 30``, level 1 (``speed_pct`` 100,
  ``amount`` 1) unless said otherwise; ``dispatch_ticks = 10``; ``node_key``
  grows in the order K, A, B, C; no units; warehouses as at the dispatch (after recharge); the
  result describes one dispatch period. The automatic dispatch around the transfers follows
  DEC-28 (``rear_min = 1``, no markers).

These numbers are pinned in ``RULES``, so balance changes of ``mvp-0.toml`` do not break them.

Map ``dec18`` (rot180): K = 0 (capital of 0), A = 1, B = 2, C = 3 (medium cities); P = 4 (a
province, neutral unless a test takes it) with K -e3- P -e4- B; X = 5 (a neutral medium city,
example 14 gives it to player 0) reached only through E = 6 (a medium city the tests give to
player 1) from C; E -e7- 7 joins the mirror half.
Roads: K-A e0, A-B e1, A-C e2.
"""

import dataclasses
from pathlib import Path

from gow_sim.commands import (
    Ok,
    PlayerCommand,
    Reject,
    RejectCode,
    Transfer,
    apply_commands,
)
from gow_sim.maps import load_map
from gow_sim.ruleset import FullLevelTable, KindTable, LevelTable, Ruleset, load_ruleset
from gow_sim.state import Event, GameState, Packet, initial_state
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
            base_speed_pct=100,
            amount_by_level=FullLevelTable((1, 2, 3)),
            fast_speed_pct=LevelTable((150, 200)),
        ),
        orders=dataclasses.replace(
            base.orders,
            cost=dataclasses.replace(base.orders.cost, transfer=0),
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


def _dispatch(state: GameState, rules: Ruleset = RULES) -> list[tuple[int, int, int]]:
    """One dispatch at tick ``DISPATCH``: ``(from, to, charges)`` of the new packets of player 0."""
    state.tick = DISPATCH
    before = set(state.packets)
    supply(state, rules)
    return sorted(
        (p.from_node, packet_dest(state, p), p.charges)
        for pid, p in state.packets.items()
        if pid not in before and p.owner == 0
    )


def _cmd(state: GameState, cmd: Transfer) -> Ok | Reject:
    results, _ = apply_commands(state, RULES, [PlayerCommand(0, 0, cmd)])
    return results[0].outcome


def _until(state: GameState, tick: int) -> list[Event]:
    events: list[Event] = []
    while state.tick < tick:
        state.tick += 1
        events += supply(state, RULES)
    return events


def _transfer(state: GameState, src: int, dst: int, n: int) -> list[Packet]:
    """``Transfer`` applied at tick ``T``; its batches by departure (#287)."""
    state.tick = T
    assert isinstance(_cmd(state, Transfer(src, dst, n)), Ok)
    return sorted((p for p in state.packets.values() if p.transfer), key=lambda p: p.depart_tick)


def _arrivals(events: list[Event], node: int) -> list[tuple[int, object]]:
    """``(tick, charges)`` of the deliveries into ``node``."""
    return [
        (e.tick, e.get("charges"))
        for e in events
        if e.kind == "packet_delivered" and e.get("node") == node
    ]


# Dispatch: example 8 ---------------------------------------------------------------------------


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


# Transfers: examples 9-19 ------------------------------------------------------------------------


def _keep(state: GameState, node: int) -> None:
    """A front marker on ``node``: it keeps what it gets (DEC-28, item 6: "чтобы удержать запас,
    ставят маркер"); without it the automatic dispatch would pass the surplus on."""
    state.players[0].fronts = (node, None)


def test_example_9_transfer_time_with_batches() -> None:
    state = _state(A=5)
    _keep(state, B)
    batches = _transfer(state, A, B, 4)
    assert state.nodes[A].warehouse == 1  # in tick t
    assert [(p.depart_tick, p.charges) for p in batches] == [
        (T, 1),
        (T + 10, 1),
        (T + 20, 1),
        (T + 30, 1),
    ]
    events = _until(state, T + 60)
    assert _arrivals(events, B) == [(T + 30, 1), (T + 40, 1), (T + 50, 1), (T + 60, 1)]
    assert state.nodes[B].warehouse == 4
    assert not state.packets


def test_example_10_transfer_on_a_level_3_road() -> None:
    state = _state(A=5)
    _road(state, AB, 3)
    batches = _transfer(state, A, B, 4)  # amount 3 on level 3 (DEC-28): batches of 3 and 1
    assert [(p.depart_tick, p.charges) for p in batches] == [(T, 3), (T + 10, 1)]
    events = _until(state, T + 45)  # last batch: t + 1 * 10 + 15 (speed 200)
    assert _arrivals(events, B) == [(T + 15, 3), (T + 25, 1)]


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
    batches = _transfer(state, K, B, 3)
    assert [p.route for p in batches] == [(AB,)] * 3
    _until(state, T + 55)  # on A-B since t + 30, t + 40 and t + 50
    assert [(p.edge, p.from_node) for p in batches] == [(AB, A)] * 3
    change_owner(state, A, 1)
    events = _until(state, T + 56)
    assert [(e.kind, e.get("charges")) for e in events] == [("packet_lost", 1)] * 3
    assert not state.packets


def test_example_17_way_cut_ahead_charges_stay_in_the_city() -> None:
    state = _state(K=3)
    _keep(state, A)
    _transfer(state, K, C, 3)
    _until(state, T + 10)
    change_owner(state, C, 1)
    events = _until(state, T + 50)
    assert [
        (e.kind, e.get("node"), e.get("charges")) for e in events if e.kind == "packet_delivered"
    ] == [("packet_delivered", A, 1)] * 3
    assert _arrivals(events, A) == [(T + 30, 1), (T + 40, 1), (T + 50, 1)]
    assert state.nodes[A].warehouse == 3
    assert not state.packets


# Example 18 (the overflow burns) is replaced by example 29 (#287): the transfer is cut.


def test_example_19_a_packet_to_a_captured_city_is_lost() -> None:
    state = _state(A=2)
    _road(state, AB, 2)
    _transfer(state, A, B, 2)  # one batch: amount 2 on level 2 (DEC-28)
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
    _keep(state, A)  # DEC-28: the demand of A that the old target «discharged + buffer» made
    events = _transfer_on_dispatch_tick(state, K, A, 2)
    assert state.nodes[K].warehouse == 3
    events += _until(state, SHARED_T + 20)
    # t and t + 10: the batches take the amount 1 of K-A; t + 20: K sends A 1 charge.
    assert _sent(events) == [(SHARED_T + 20, K, A, 1)]
    events = _until(state, SHARED_T + 40)
    assert _arrivals(events, A) == [(SHARED_T + 30, 1), (SHARED_T + 40, 1)]
    assert state.nodes[A].warehouse == 2


# Example 24 (a freight road) is deleted by DEC-26: there is no freight road.


# Transfer amount and batches: examples 29-33 (owner's decision of 2026-10-15, #287) ------------


def test_example_29_transfer_cut_to_the_free_room() -> None:
    state = _state(A=3, B=5)
    state.tick = T
    results, events = apply_commands(state, RULES, [PlayerCommand(0, 0, Transfer(A, B, 3))])
    assert results[0].outcome == Ok(cost=0, path=(A, B), arrive_tick=T + 30)
    assert [(e.kind, e.get("charges")) for e in events] == [("transfer_started", 1)]
    assert state.nodes[A].warehouse == 2
    events = _until(state, T + 30)
    assert _arrivals(events, B) == [(T + 30, 1)]
    assert not [e for e in events if e.kind == "charges_overflow"]
    assert state.nodes[B].warehouse == 6


def test_example_30_target_full() -> None:
    state = _state(A=3, B=6)
    assert _cmd(state, Transfer(A, B, 1)) == Reject(RejectCode.TARGET_FULL)
    assert state.nodes[A].warehouse == 3


def test_example_31_charges_on_the_way_count() -> None:
    state = _state(A=3, B=2)
    pid = state.new_id()
    state.packets[pid] = Packet(
        pid,
        0,
        KA,
        from_node=K,
        charges=2,
        depart_tick=0,
        arrive_tick=500,
        route=(AB,),
        route_ticks=(30,),
    )
    batches = _transfer(state, A, B, 3)
    assert sum(p.charges for p in batches) == 2
    assert state.nodes[A].warehouse == 1


def test_example_32_batches_go_the_whole_way_one_period_apart() -> None:
    state = _state(K=5)
    state.tick = T
    assert _cmd(state, Transfer(K, B, 3)) == Ok(cost=0, path=(K, A, B), arrive_tick=T + 80)
    events = _until(state, T + 80)
    assert _arrivals(events, B) == [(T + 60, 1), (T + 70, 1), (T + 80, 1)]


def test_example_33_waiting_batches_go_back_when_the_way_is_cut() -> None:
    state = _state(A=3)
    _transfer(state, A, B, 3)
    assert state.nodes[A].warehouse == 0
    _until(state, T + 5)
    change_owner(state, B, 1)
    events = _until(state, T + 6)
    assert [(e.kind, e.get("charges")) for e in events if e.kind == "packet_lost"] == [
        ("packet_lost", 1)
    ]
    assert _arrivals(events, A) == [(T + 6, 1), (T + 6, 1)]
    assert state.nodes[A].warehouse == 2
    assert not state.packets


def test_transfer_from_equals_to_is_invalid() -> None:
    state = _state(A=5)
    assert _cmd(state, Transfer(A, A, 1)) == Reject(RejectCode.INVALID_ARGUMENT)
    assert _cmd(state, Transfer(A, B, 0)) == Reject(RejectCode.INVALID_ARGUMENT)


def test_transfer_inside_a_cut_off_pocket() -> None:
    # A cut off from K (K-A lost): A -> B is still allowed (owner 2026-10-12).
    state = _state(A=2)
    state.nodes[K].owner = 1
    assert isinstance(_cmd(state, Transfer(A, B, 2)), Ok)
