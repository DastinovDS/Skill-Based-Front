"""Supply rework: transit, front markers, rear minimum, donors (DEC-28, #290; implementation #292).

Table tests of the supply examples 1-9 of DEC-28 (mechanics.md, section 8, block DEC-28; the
road examples 10-11 belong to #306). Expected values come from the decision, not from the code.
The setting of the examples unless said otherwise: ``mvp-1``, warehouse of the capital K 6, of
the cities A, B, C 2 each, ``packet_ticks`` 30 per road, ``rear_min = 1``, no markers,
``amount`` 1, one chain K-A-B-C.

Map ``dec28`` (rot180): K = 0 (capital of 0), A = 1, B = 2, C = 3 (medium cities of 0) on the
chain K -e0- A -e1- B -e2- C; D = 4 (a neutral medium city) with C -e3- D; P = 5 (a neutral
province) with A -e4- P; the neutral provinces N = 6 and M = 7 (the centre) join D to the mirror
half (player 1: 14 = K', 13 = A', ...). The roads of the chain: ``travel_ticks = 30``, level 1.
"""

from pathlib import Path

import pytest

from gow_sim.commands import (
    Ok,
    PlayerCommand,
    Reject,
    RejectCode,
    SetFront,
    SetRearMin,
    Transfer,
    apply_commands,
)
from gow_sim.maps import load_map
from gow_sim.ruleset import load_ruleset
from gow_sim.state import Event, GameState, event, initial_state
from gow_sim.systems.capacity import change_owner, warehouse_capacity
from gow_sim.systems.supply import packet_dest, supply

TESTS_DIR = Path(__file__).resolve().parent
RULES = load_ruleset(TESTS_DIR.parents[2] / "rulesets" / "mvp-1.toml")
K, A, B, C, D, P = 0, 1, 2, 3, 4, 5
T = 100
"""The dispatch tick ``t`` of the examples (``supply.dispatch_ticks`` 10 divides it)."""


def test_the_setting_of_the_examples() -> None:
    state = _state()
    assert RULES.supply.dispatch_ticks == 10 and RULES.supply.base_amount == 1
    assert [warehouse_capacity(state, RULES, n) for n in (K, A, B, C)] == [6, 2, 2, 2]
    assert state.players[0].rear_min == 1 and state.players[0].fronts == (None, None)


def _state(chain: str = "KABC", **warehouses: int) -> GameState:
    """Player 0 owns the cities of ``chain``; tick ``T - 1``."""
    state = initial_state(load_map(TESTS_DIR / "maps" / "dec28.json"), RULES)
    names = {"K": K, "A": A, "B": B, "C": C, "D": D}
    for name in "ABC":
        if name not in chain:
            state.nodes[names[name]].owner = None
    for name, charges in warehouses.items():
        state.nodes[names[name]].warehouse = charges
    state.tick = T - 1
    return state


def _fronts(state: GameState, *nodes: int | None) -> None:
    state.players[0].fronts = (*nodes, *(None,) * (2 - len(nodes)))


def _step(state: GameState, extra: list[Event] | None = None) -> list[Event]:
    """The supply system of the next tick; ``extra``: events of earlier systems of that tick."""
    state.tick += 1
    state.events = [event(state.tick, e.kind, **dict(e.data)) for e in extra or []]
    return supply(state, RULES)


def _until(state: GameState, tick: int) -> list[Event]:
    events: list[Event] = []
    while state.tick < tick:
        events += _step(state)
    return events


def _sent(events: list[Event]) -> list[tuple[int, object, object, object]]:
    """``(tick, from, to, charges)`` of the automatic packets of player 0."""
    return [
        (e.tick, e.get("from_node"), e.get("to_node"), e.get("charges"))
        for e in events
        if e.kind == "packet_sent" and e.get("player") == 0
    ]


def _stock(state: GameState, *nodes: int) -> tuple[int, ...]:
    return tuple(state.nodes[n].warehouse for n in nodes)


def _cmd(state: GameState, cmd: SetFront | SetRearMin | Transfer) -> Ok | Reject:
    results, _ = apply_commands(state, RULES, [PlayerCommand(0, 0, cmd)])
    return results[0].outcome


# Examples 1-9 ----------------------------------------------------------------------------------


def test_example_1_transit_through_a_city_with_a_small_warehouse() -> None:
    state = _state("KAB", K=6, A=1, B=0)
    _fronts(state, B)
    events = _step(state)  # tick t
    # A keeps its minimum 1 and is no donor; deficit of B 2, donor K: K-A-B 1, A untouched.
    assert _sent(events) == [(T, K, B, 1)]
    (packet,) = state.packets.values()
    assert packet_dest(state, packet) == B and packet.from_node == K
    events = _until(state, T + 10)  # t + 10: deficit of B 2 - 0 - 1 = 1: the second packet
    assert _sent(events) == [(T + 10, K, B, 1)]
    for tick in range(T + 11, T + 71):
        events = _step(state)
        assert state.nodes[A].warehouse == 1  # A never takes a charge of the transit
        assert _sent(events) == []  # B is covered by what is on the way
        if tick == T + 60:
            assert _stock(state, B) == (1,)  # the first packet: t + 60
    assert _stock(state, K, A, B) == (4, 1, 2)  # B full at t + 70


def test_example_2_moved_marker_the_old_front_feeds_the_new_one() -> None:
    state = _state(K=3, A=1, B=2, C=1)
    _fronts(state, B)
    state.tick = T
    assert _cmd(state, SetFront(0, C)) == Ok(cost=0)  # 0 CP
    assert state.players[0].fronts == (C, None)
    events = supply(state, RULES)
    # Targets A 1, B 1, C 2; deficit of C 1; donors B (2 > 1, 30 ticks) and K (3 > 0, 90): B.
    assert _sent(events) == [(T, B, C, 1)]
    assert _stock(state, K, A, B) == (3, 1, 1)
    _until(state, T + 30)
    assert _stock(state, K, A, B, C) == (3, 1, 1, 2)


def test_example_3_rear_minimum_farthest_first() -> None:
    state = _state(K=5)
    state.players[0].rear_min = 2
    events = _until(state, T + 200)
    # Five periods, one charge each over K-A: C, C, B, B, A.
    assert [to for _, _, to, _ in _sent(events)] == [C, C, B, B, A]
    assert [tick for tick, *_ in _sent(events)] == [T, T + 10, T + 20, T + 30, T + 40]
    assert _stock(state, K, A, B, C) == (0, 1, 2, 2)


def _produce(state: GameState) -> list[Event]:
    """The next tick with one charge of the capital that did not fit (``spill``, DEC-28, 4.4)."""
    produced = event(state.tick + 1, "charges_produced", player=0, node=K, charges=1, spill=1)
    return _step(state, [produced])


def test_example_4_the_full_capital_spills_to_the_nearest_rear_city() -> None:
    state = _state(K=6, A=1, B=1, C=1)
    _until(state, T - 1)
    events = _produce(state)  # tick t: pass 4, the nearest rear city with room is A (room 1)
    assert _sent(events) == [(T, K, A, 1)]
    for _ in range(9):
        _step(state)
    events = _produce(state)  # A is full with what is on the way: B
    assert _sent(events) == [(T + 10, K, B, 1)]
    for _ in range(9):
        _step(state)
    events = _produce(state)  # then C
    assert _sent(events) == [(T + 20, K, C, 1)]
    for _ in range(9):
        _step(state)
    events = _produce(state)  # K, A, B, C full (with what is on the way): the charge burns
    assert _sent(events) == []
    assert [(e.kind, e.get("charges")) for e in events if e.kind == "charges_overflow"] == [
        ("charges_overflow", 1)
    ]
    _until(state, T + 110)  # the packet to C: sent at t + 20, 90 ticks over K-A-B-C
    assert _stock(state, K, A, B, C) == (6, 2, 2, 2)


def test_example_5_a_donor_never_gives_below_its_target() -> None:
    state = _state("KAB", K=0, A=2, B=0)
    events = _step(state)
    assert _sent(events) == [(T, A, B, 1)]  # targets A 1, B 1: deficit of B 1, donor A
    events = _until(state, T + 60)
    assert _stock(state, A, B) == (1, 1)
    assert _sent(events) == []  # back: B is not above its target


def test_example_6_rear_minimum_0_the_whole_stock_is_a_donor_s() -> None:
    state = _state("KAB", K=0, A=2, B=0)
    state.players[0].rear_min = 0
    _fronts(state, B)
    events = _until(state, T + 40)
    assert _sent(events) == [(T, A, B, 1), (T + 10, A, B, 1)]  # one per period
    assert _stock(state, A, B) == (0, 2)


def test_example_7_transfer_ignores_the_minimum_and_may_come_back() -> None:
    state = _state("KAB", K=0, A=1, B=1)
    state.tick = T + 1  # not a dispatch tick
    assert isinstance(_cmd(state, Transfer(A, B, 1)), Ok)  # the minimum does not forbid it
    events = _until(state, T + 31)
    assert _stock(state, A, B) == (0, 2)
    assert _sent(events) == []  # until it arrives B is not above its target
    events = _until(state, T + 40)
    # Deficit of A 1, nearest donor B (2 > 1): the charge comes back.
    assert _sent(events) == [(T + 40, B, A, 1)]


def test_example_7_with_a_marker_the_transfer_stays() -> None:
    state = _state("KAB", K=0, A=1, B=1)
    _fronts(state, B)
    state.tick = T + 1
    assert isinstance(_cmd(state, Transfer(A, B, 1)), Ok)
    events = _until(state, T + 100)
    assert _sent(events) == []
    assert _stock(state, A, B) == (0, 2)


def test_example_8_marker_of_a_lost_city_falls_back_past_the_other_marker() -> None:
    state = _state()
    _fronts(state, B, C)
    state.tick = T
    change_owner(state, C, 1)
    events = supply(state, RULES)
    # B holds the other marker, so the marker of C goes to A (one marker per city).
    assert state.players[0].fronts == (B, A)
    assert [(e.get("marker"), e.get("node"), e.get("reason")) for e in events][:1] == [
        (1, A, "fallback")
    ]


def test_example_9_a_cut_off_city_takes_no_part_in_the_supply() -> None:
    state = _state("KAB", K=6, A=1, B=1)
    state.nodes[D].owner = 0  # no own way from D to K (C is neutral)
    events = _until(state, T + 50)
    assert _sent(events) == []  # D, empty, gets nothing
    assert _stock(state, D) == (0,)
    state = _state("KAB", K=0, A=0, B=1)
    state.nodes[D].owner = 0
    state.nodes[D].warehouse = 2
    events = _until(state, T + 50)
    assert _sent(events) == []  # A lacks 1, but D (2 > 1) gives nothing
    assert _stock(state, A, D) == (0, 2)


def test_rear_city_target_is_capped_by_its_warehouse() -> None:
    """«Накопление: граничные случаи»: a warehouse of 2 at ``rear_min = 3`` keeps 2."""
    state = _state("KAB", K=6)
    state.players[0].rear_min = 3
    _until(state, T + 200)
    assert _stock(state, K, A, B) == (2, 2, 2)


def test_the_marker_city_with_less_stock_first() -> None:
    """Item 4.1: between two marker cities the one with fewer charges goes first."""
    state = _state("KAB", K=1, A=1, B=0)
    _fronts(state, A, B)
    events = _step(state)
    assert _sent(events) == [(T, K, B, 1)]  # B (0) before A (1)


# Commands (DEC-28, items 2 and 3) -------------------------------------------------------------


@pytest.mark.parametrize(
    ("cmd", "code"),
    [
        (SetFront(2, A), RejectCode.INVALID_ARGUMENT),
        (SetFront(0, 99), RejectCode.NOT_FOUND_OR_HIDDEN),
        (SetFront(0, 13), RejectCode.NOT_OWNER),  # A' of player 1
        (SetFront(0, P), RejectCode.NOT_OWNER),  # a neutral province
        (SetFront(0, None), RejectCode.NO_CHANGE),
        (SetRearMin(9), RejectCode.INVALID_ARGUMENT),  # 0..supply.rear_min_max = 8
        (SetRearMin(-1), RejectCode.INVALID_ARGUMENT),
        (SetRearMin(1), RejectCode.NO_CHANGE),
    ],
)
def test_rejects(cmd: SetFront | SetRearMin, code: RejectCode) -> None:
    assert _cmd(_state(), cmd) == Reject(code)


def test_province_takes_no_marker() -> None:
    state = _state()
    state.nodes[P].owner = 0
    assert _cmd(state, SetFront(0, P)) == Reject(RejectCode.NOT_CITY)


def test_one_marker_per_city_and_the_same_place() -> None:
    state = _state()
    assert _cmd(state, SetFront(0, B)) == Ok(cost=0)
    assert _cmd(state, SetFront(0, B)) == Reject(RejectCode.NO_CHANGE)
    assert _cmd(state, SetFront(1, B)) == Reject(RejectCode.INVALID_ARGUMENT)
    assert _cmd(state, SetFront(0, None)) == Ok(cost=0)
    assert state.players[0].fronts == (None, None)


def test_rear_minimum_is_set_for_free() -> None:
    state = _state()
    cp = state.players[0].cp
    assert _cmd(state, SetRearMin(8)) == Ok(cost=0)
    assert (state.players[0].rear_min, state.players[0].cp) == (8, cp)


def test_marker_of_the_capital_fills_it() -> None:
    """Item 5: with a marker on the capital its target is the full warehouse."""
    state = _state("KAB", K=4, A=2, B=1)
    _fronts(state, K)
    events = _step(state)
    assert _sent(events) == [(T, A, K, 1)]  # A (2 > 1) is the nearest donor of K
