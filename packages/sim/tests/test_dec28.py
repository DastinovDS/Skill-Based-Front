"""Supply rework: transit, front markers, rear minimum, donors, roads for CP (DEC-28, #290;
implementation #292 and #306; the owner's answers of #309).

Table tests of the examples 1-14 of DEC-28 (mechanics.md, section 8, block DEC-28; 10-11: roads,
item 7; 12-14: the answers of #309). Expected values come from the decision, not from the code.
The setting of the examples unless said otherwise: ``mvp-1``, warehouse of the capital K 6, of
the cities A, B, C 2 each, ``packet_ticks`` 30 per road, ``rear_min = 1``, no markers,
``amount`` 1, one chain K-A-B-C.

Map ``dec28`` (rot180): K = 0 (capital of 0), A = 1, B = 2, C = 3 (medium cities of 0) on the
chain K -e0- A -e1- B -e2- C; D = 4 (a neutral medium city) with C -e3- D; P = 5 (a neutral
province) with A -e4- P; the neutral provinces N = 6 and M = 7 (the centre) join D to the mirror
half (player 1: 14 = K', 13 = A', ...). The roads of the chain: ``travel_ticks = 30``, level 1.
"""

import dataclasses
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
    UpgradeRoad,
    apply_commands,
)
from gow_sim.maps import Terrain, load_map, parse_map
from gow_sim.ruleset import load_ruleset
from gow_sim.state import (
    AtNode,
    Event,
    GameState,
    Group,
    Mode,
    Order,
    event,
    initial_state,
)
from gow_sim.systems.build import build
from gow_sim.systems.capacity import change_owner, warehouse_capacity
from gow_sim.systems.movement import movement, path_ticks, traversal_ticks
from gow_sim.systems.supply import edge_amount, packet_dest, supply

TESTS_DIR = Path(__file__).resolve().parent
RULES = load_ruleset(TESTS_DIR.parents[2] / "rulesets" / "mvp-1.toml")
K, A, B, C, D, P = 0, 1, 2, 3, 4, 5
T = 100
"""The dispatch tick ``t`` of the examples (``supply.dispatch_ticks`` 10 divides it)."""


def test_the_setting_of_the_examples() -> None:
    state = _state()
    assert RULES.supply.dispatch_ticks == 10 and RULES.supply.amount_by_level.of(1) == 1
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


def _cmd(state: GameState, cmd: SetFront | SetRearMin | Transfer | UpgradeRoad) -> Ok | Reject:
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
    """ "Accumulation: edge cases": a warehouse of 2 at ``rear_min = 3`` keeps 2."""
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


# Examples 10-11: roads for CP (item 7) --------------------------------------------------------


def _terrain_edge(terrain: Terrain) -> GameState:
    """The setting of examples 10 and 11: the road K-A (e0) of ``travel_ticks 60``, both ends of
    ``terrain`` (one zone, so the time is ``travel_ticks * 100 // speed``)."""
    state = _state()
    mapdef = state.map
    nodes = tuple(
        dataclasses.replace(n, terrain=terrain) if n.id in (K, A) else n for n in mapdef.nodes
    )
    edges = tuple(
        dataclasses.replace(e, travel_ticks=60) if e.id == KA else e for e in mapdef.edges
    )
    state.map = dataclasses.replace(mapdef, nodes=nodes, edges=edges)
    return state


KA = 0
"""e0 = K-A."""


def test_example_10_two_levels_cost_1_cp_150_ticks_each() -> None:
    state = _state()
    state.players[0].cp = 300
    state.tick = T
    assert _cmd(state, UpgradeRoad(KA)) == Ok(cost=50)
    assert _cmd(state, UpgradeRoad(KA)) == Reject(RejectCode.EDGE_BUSY)  # one level at a time
    state.tick = T + 149
    assert build(state, RULES) == [] and state.edges[KA].width == 1
    state.tick = T + 150
    assert [e.kind for e in build(state, RULES)] == ["road_upgraded"]
    state.tick = T + 151
    assert _cmd(state, UpgradeRoad(KA)) == Ok(cost=50)
    state.tick = T + 301
    build(state, RULES)
    assert state.edges[KA].width == 3
    assert state.players[0].cp == 300 - 2 * 50  # 2 x 0,5 = 1 CP
    assert edge_amount(state, RULES, KA) == 3  # amount 3 per period


@pytest.mark.parametrize(
    ("terrain", "level", "ticks"),
    [
        (Terrain.FOREST, 1, 60),
        (Terrain.FOREST, 2, 52),  # 60 * 100 // 115
        (Terrain.FOREST, 3, 46),  # 60 * 100 // 130
        (Terrain.PLAINS, 3, 37),  # 125 * 130 // 100 = 162, 60 * 100 // 162
    ],
)
def test_example_10_unit_speed_by_road_level(terrain: Terrain, level: int, ticks: int) -> None:
    state = _terrain_edge(terrain)
    assert traversal_ticks(state.map, RULES, KA, A, level) == ticks
    state.edges[KA].width = level
    assert path_ticks(state, RULES, (K, A)) == ticks  # the time of a path reads the level


@pytest.mark.parametrize(("level", "ticks"), [(1, 85), (2, 75)])
def test_example_11_mountains(level: int, ticks: int) -> None:
    """70 * 115 // 100 = 80, 60 * 100 // 80 = 75; without the road 60 * 100 // 70 = 85."""
    state = _terrain_edge(Terrain.MOUNTAINS)
    assert traversal_ticks(state.map, RULES, KA, A, level) == ticks


def _walk(state: GameState, owner: int, start: int, dest: int, upgrade_at: int | None) -> int:
    """Ticks until a group of ``owner`` that leaves ``start`` for ``dest`` arrives; at the tick
    ``upgrade_at`` on the way the road K-A gets level 3."""
    gid = state.new_id()
    state.groups[gid] = Group(gid, owner, 1, 1, Mode.ATTACK, AtNode(start))
    state.groups[gid].order = Order((dest,), planned=False, depart_tick=state.tick + 1)
    begin = state.tick
    while True:
        state.tick += 1
        if state.tick - begin == upgrade_at:
            state.edges[KA].width = 3
        if any(e.kind == "group_arrived" for e in movement(state, RULES)):
            return state.tick - begin


def test_example_10_the_time_is_fixed_when_the_group_enters_the_edge() -> None:
    state = _terrain_edge(Terrain.FOREST)
    state.edges[KA].width = 3
    assert _walk(state, 0, K, A, None) == 46
    state = _terrain_edge(Terrain.FOREST)
    assert _walk(state, 0, K, A, upgrade_at=10) == 60  # upgraded on the way: still level 1


def test_example_10_the_road_speeds_up_the_enemy_too() -> None:
    state = _terrain_edge(Terrain.FOREST)
    state.edges[KA].width = 3
    assert _walk(state, 1, A, K, None) == 46  # a group of player 1 on the road of player 0


# Examples 12-14: the answers of the owner (#309) ----------------------------------------------

RING_K, RING_A, RING_E, RING_B = 0, 1, 2, 3


def _ring(eb_ticks: int) -> GameState:
    """Example 12: the ring K-A-B and K-E-B of player 0 (A, E, B medium cities), roads of level
    1 and 30 ticks except E-B (``eb_ticks``); a neutral province M joins B to the mirror half.
    Node ids follow ``node_key``: A before E. K 6, A 1, E 1, B 0, a marker on B; tick ``T - 1``."""
    w, h = 1000, 400
    spots = [(100, 200), (250, 100), (250, 300), (400, 200), (500, 200)]
    spots += [(w - x, h - y) for x, y in reversed(spots[:4])]
    kinds = ["capital", "city_medium", "city_medium", "city_medium", "province"]
    kinds += list(reversed(kinds[:4]))
    owners: list[int | None] = [0, 0, 0, 0, None, 1, 1, 1, 1]
    nodes = [
        {
            "id": i,
            "name": f"n{i}",
            "x": x,
            "y": y,
            "terrain": "plains",
            "vp": 0,
            "kind": kinds[i],
            "capital_of": owners[i] if kinds[i] == "capital" else None,
            "start_owner": owners[i],
            "start_units": 0,
            "start_charged": 0,
            "start_stock": 0,
        }
        for i, (x, y) in enumerate(spots)
    ]
    ends = [(0, 1), (1, 3), (0, 2), (2, 3), (3, 4), (4, 5), (5, 6), (5, 7), (6, 8), (7, 8)]
    ticks = [30, 30, 30, eb_ticks, 30, 30, eb_ticks, 30, 30, 30]
    edges = [
        {"id": i, "a": a, "b": b, "max_level": 3, "travel_ticks": ticks[i], "border_permille": 500}
        for i, (a, b) in enumerate(ends)
    ]
    mirror_nodes = {str(i): 8 - i for i in range(9)}
    mirror_edges = {str(i): j for i, j in enumerate((9, 7, 8, 6, 5, 4, 3, 1, 2, 0))}
    data = {
        "meta": {"name": "ring", "version": 1, "symmetry": "rot180", "width": w, "height": h},
        "nodes": nodes,
        "edges": edges,
        "mirror": {"nodes": mirror_nodes, "edges": mirror_edges},
    }
    state = initial_state(parse_map(data), RULES)
    for node, charges in ((RING_K, 6), (RING_A, 1), (RING_E, 1), (RING_B, 0)):
        state.nodes[node].warehouse = charges
    _fronts(state, RING_B)
    state.tick = T - 1
    return state


def _deliveries(events: list[Event], node: int) -> list[tuple[int, object]]:
    return [
        (e.tick, e.get("charges"))
        for e in events
        if e.kind == "packet_delivered" and e.get("node") == node
    ]


def test_example_12_a_detour_of_the_same_time_is_taken() -> None:
    state = _ring(eb_ticks=30)
    events = _step(state)  # tick t: deficit of B 2, donor K
    assert _sent(events) == [(T, RING_K, RING_B, 1), (T, RING_K, RING_B, 1)]
    ways = sorted((p.edge, *p.route) for p in state.packets.values())
    assert ways == [(0, 1), (2, 3)]  # K-A-B first, then the detour K-E-B (60 <= 60 + 10)
    events = _until(state, T + 70)
    assert _deliveries(events, RING_B) == [(T + 60, 1), (T + 60, 1)]
    assert _stock(state, RING_A, RING_E, RING_B) == (1, 1, 2)


def test_example_12_a_detour_longer_than_a_period_waits() -> None:
    state = _ring(eb_ticks=50)  # K-E-B: 80 ticks, more than 60 + 10
    events = _step(state)
    assert _sent(events) == [(T, RING_K, RING_B, 1)]
    events = _until(state, T + 10)  # the second charge waits for the next dispatch
    assert _sent(events) == [(T + 10, RING_K, RING_B, 1)]
    assert all((p.edge, *p.route) == (0, 1) for p in state.packets.values())  # K-A-B
    events = _until(state, T + 70)
    assert _deliveries(events, RING_B) == [(T + 60, 1), (T + 70, 1)]


def test_example_12_a_transfer_takes_no_detour() -> None:
    state = _ring(eb_ticks=30)
    state.players[0].fronts = (None, None)
    state.tick = T + 1  # not a dispatch tick
    assert isinstance(_cmd(state, Transfer(RING_K, RING_B, 2)), Ok)
    assert sorted((p.depart_tick, p.edge, *p.route) for p in state.packets.values()) == [
        (T + 1, 0, 1),
        (T + 11, 0, 1),  # batches one period apart on the same way (DEC-18, item 6)
    ]


def test_example_13_a_marker_without_an_own_neighbour_is_removed() -> None:
    state = _state()
    _fronts(state, C)
    state.tick = T
    change_owner(state, B, 1)  # C is cut off: the marker stays on the own city
    supply(state, RULES)
    assert state.players[0].fronts == (C, None)
    state.tick = T + 1
    change_owner(state, C, 1)  # no own neighbour of C in the supply tree
    events = supply(state, RULES)
    assert state.players[0].fronts == (None, None)  # no jump to the capital
    assert [
        (e.get("marker"), e.get("node"), e.get("reason")) for e in events if e.kind == "front_set"
    ] == [(0, None, "fallback")]


def test_example_14_the_spill_goes_to_a_marker_city_first() -> None:
    state = _state(K=6, A=1, B=0, C=1)
    _fronts(state, K, B)
    _until(state, T - 1)
    events = _produce(state)  # tick t
    # K holds a marker (target 6, no donor), A and C are at the minimum: 4.1 sends nothing; the
    # spill finds no room made in K and goes to the marker city B (room 2) before the rear A.
    assert _sent(events) == [(T, K, B, 1)]
    assert [e for e in events if e.kind == "charges_overflow"] == []


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
