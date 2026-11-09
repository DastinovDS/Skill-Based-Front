"""Packets and recharge (SIM-08, ``systems.supply``): what the supply flow (DEC-43) and the spill
of a full factory share.

Expected values from mechanics.md, section 7, and DEC-41, item 8: a packet needs
``travel_ticks * 100 // supply.speed_pct`` ticks per road (150 % in the kept rulesets, roads have
no levels); recharge at most 1 charge per node and tick, the lowest group id first, not on edges,
not for a foreign group (DEC-14 default, #131); a packet on a road that is no longer internal is
lost, at the end of its path it fills the warehouse and the excess burns.

The map ``line6``: ``0 (capital of 0) - 1 - 2 | 3 - 4 - 5 (capital of 1)``; 2 and 3 start
neutral, ``_line6()`` gives them to 0 and 1. Every road ``e_i`` joins ``i`` and ``i + 1``,
30 ticks; plains.
"""

from pathlib import Path

import pytest

from gow_sim.maps import load_map
from gow_sim.ruleset import Ruleset, load_ruleset
from gow_sim.state import (
    AtNode,
    Event,
    GameState,
    Group,
    Mode,
    OnEdge,
    from_canonical,
    initial_state,
    state_hash,
    to_canonical,
)
from gow_sim.systems.capacity import change_owner, warehouse_capacities
from gow_sim.systems.flow import supply_flow
from gow_sim.systems.supply import (
    garrisons_by_node,
    move_packets,
    packet_dest,
    packet_ticks,
    recharge,
    send_packet,
)

TESTS_DIR = Path(__file__).resolve().parent
RULES: Ruleset = load_ruleset(TESTS_DIR.parents[2] / "rulesets" / "mvp-7.toml")


def _line6() -> GameState:
    state = initial_state(load_map(TESTS_DIR / "maps" / "line6.json"), RULES)
    state.nodes[2].owner = 0  # setup, not a capture: 2 and 3 start neutral
    state.nodes[3].owner = 1
    return state


def _group(state: GameState, owner: int, node: int, units: int, charged: int = 0) -> Group:
    gid = state.new_id()
    group = Group(gid, owner, units, charged, Mode.ATTACK, AtNode(node))
    state.groups[gid] = group
    return group


def test_packet_time() -> None:
    """DEC-41, item 8: 30 ticks at 150 % take 30 * 100 // 150 = 20 ticks."""
    state = _line6()
    assert state.map.edges[0].travel_ticks == 30
    assert RULES.supply.speed_pct == 150
    assert packet_ticks(state.map, RULES, 0) == 20


def test_recharge_is_limited_per_node_lowest_group_first() -> None:
    state = _line6()
    state.nodes[1].warehouse = 5
    first = _group(state, 0, 1, units=3)
    second = _group(state, 0, 1, units=3)
    enemy = _group(state, 1, 1, units=3)
    gid = state.new_id()
    state.groups[gid] = Group(gid, 0, 3, 0, Mode.ATTACK, OnEdge(edge=0, from_node=0, progress=500))
    for tick in (1, 2, 3, 4):
        state.tick = tick
        recharge(state, RULES, garrisons_by_node(state))
    # 1 charge per tick (supply.recharge_per_tick = 1): 4 ticks, 4 charges; group 1 first.
    assert (first.charged, second.charged, state.nodes[1].warehouse) == (3, 1, 1)
    assert enemy.charged == 0 and state.groups[gid].charged == 0  # not the owner; on an edge


def test_a_packet_passes_own_nodes_and_lands_at_its_end() -> None:
    state = _line6()
    state.tick = 1
    packet = send_packet(state, 0, 0, (0, 1), (20, 20), 2)
    assert packet_dest(state, packet) == 2
    capacities = warehouse_capacities(state, RULES)
    landed: list[Event] = []
    for tick in range(2, 42):
        state.tick = tick
        landed += move_packets(state, capacities)
    # 20 ticks on e0 (leaves at 1, at node 1 in tick 21), on at once, 20 more on e1: tick 41.
    assert [(e.tick, e.kind, e.get("node"), e.get("charges")) for e in landed] == [
        (41, "packet_delivered", 2, 2)
    ]
    assert state.nodes[2].warehouse == 2
    assert not state.packets


def test_a_packet_on_a_lost_road_is_lost() -> None:
    state = _line6()
    state.tick = 1
    send_packet(state, 0, 0, (0, 1), (20, 20), 1)
    state.tick = 5
    change_owner(state, 1, 1)
    events = move_packets(state, warehouse_capacities(state, RULES))
    assert [(e.kind, e.get("charges")) for e in events] == [("packet_lost", 1)]
    assert not state.packets


def test_a_full_warehouse_burns_the_excess() -> None:
    state = _line6()
    capacities = warehouse_capacities(state, RULES)
    state.nodes[2].warehouse = capacities[2] - 1
    state.tick = 1
    send_packet(state, 0, 1, (1,), (20,), 3)
    state.tick = 21
    events = move_packets(state, capacities)
    assert [(e.kind, e.get("charges")) for e in events] == [
        ("packet_delivered", 1),
        ("charges_overflow", 2),
    ]
    assert state.nodes[2].warehouse == capacities[2]


def _charges(state: GameState) -> int:
    return (
        sum(n.warehouse for n in state.nodes.values())
        + sum(p.charges for p in state.packets.values())
        + sum(g.charged for g in state.groups.values())
    )


def _sunk(events: list[Event]) -> int:
    sinks = ("packet_lost", "charges_overflow", "warehouse_lost", "starvation")
    return sum(
        int(e.get("charges") or 0)
        if e.kind != "starvation"
        else int(e.get("warehouse") or 0) + int(e.get("units") or 0)
        for e in events
        if e.kind in sinks
    )


def test_supply_flow_conserves_charges_except_documented_sinks() -> None:
    state = _line6()
    state.nodes[0].warehouse = 6
    state.nodes[5].warehouse = 6
    _group(state, 0, 2, units=6)
    _group(state, 1, 3, units=6)
    sent = 0
    for tick in range(1, 301):
        state.tick = tick
        before = _charges(state)
        events = change_owner(state, 1, 1) if tick == 150 else []  # cut the road to 2
        events += supply_flow(state, RULES)
        sent += sum(e.kind == "packet_sent" for e in events)
        assert before - _charges(state) == _sunk(events), tick
    assert sent > 5


@pytest.mark.parametrize("ticks", [15, 25])
def test_canonical_roundtrip_with_packets_in_flight(ticks: int) -> None:
    state = _line6()
    state.nodes[0].warehouse = 6
    _group(state, 0, 2, units=5)
    for tick in range(1, ticks + 1):
        state.tick = tick
        supply_flow(state, RULES)
    assert state.packets
    restored = from_canonical(to_canonical(state))
    assert restored == state
    assert state_hash(restored) == state_hash(state)
