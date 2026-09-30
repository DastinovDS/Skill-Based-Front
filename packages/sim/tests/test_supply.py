"""Supply (SIM-08): packet time table, recharge, charge conservation, canonical form.

Expected values from mechanics.md, sections 7 and 8, and SIM-01 (#17): packet time
``travel_ticks * 100 // packet_speed_pct[width]`` with 100 / 125 / 150 / 175 / 200 percent for
widths 1..5; recharge at most 1 charge per node and tick; details: DEC-14 default (#131).

The map ``line6``: ``0 (capital of 0) - 1 - 2 | 3 - 4 - 5 (capital of 1)``; 2 and 3 start
neutral, ``_line6()`` gives them to 0 and 1. Every road ``e_i`` joins ``i`` and ``i + 1``,
width 1, 30 ticks; plains; base capacity 40 for capitals, 30 otherwise.
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
from gow_sim.systems.capacity import change_owner
from gow_sim.systems.supply import packet_ticks, supply, supply_tree

TESTS_DIR = Path(__file__).resolve().parent
RULES: Ruleset = load_ruleset(TESTS_DIR.parents[2] / "rulesets" / "mvp-0.toml")


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


@pytest.mark.parametrize(("width", "ticks"), [(1, 30), (2, 24), (3, 20), (4, 17), (5, 15)])
def test_packet_time_by_width(width: int, ticks: int) -> None:
    assert packet_ticks(_line6().map, RULES, 0, width) == ticks


def test_tree_is_the_own_territory_from_the_capital() -> None:
    state = _line6()
    tree = supply_tree(state, RULES, 0)
    assert tree.order == (0, 1, 2)
    assert tree.parent[:3] == (None, 0, 1)
    assert supply_tree(state, RULES, 1).order == (5, 4, 3)
    change_owner(state, 0, 1)  # capital lost: no tree
    assert supply_tree(state, RULES, 0).order == ()


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
        supply(state, RULES)
    # 1 charge per tick (supply.recharge_per_tick = 1): 4 ticks, 4 charges; group 1 first.
    assert (first.charged, second.charged, state.nodes[1].warehouse) == (3, 1, 1)
    assert enemy.charged == 0 and state.groups[gid].charged == 0  # not the owner; on an edge


def _charges(state: GameState) -> int:
    return (
        sum(n.warehouse for n in state.nodes.values())
        + sum(p.charges for p in state.packets.values())
        + sum(g.charged for g in state.groups.values())
    )


def _sunk(events: list[Event]) -> int:
    sinks = ("packet_lost", "charges_overflow", "warehouse_lost")
    return sum(int(e.get("charges") or 0) for e in events if e.kind in sinks)


def test_supply_conserves_charges_except_documented_sinks() -> None:
    state = _line6()
    state.nodes[0].warehouse = 30
    state.nodes[5].warehouse = 30
    _group(state, 0, 2, units=20)
    _group(state, 1, 3, units=20)
    sent = 0
    for tick in range(1, 301):
        state.tick = tick
        before = _charges(state)
        events = change_owner(state, 1, 1) if tick == 150 else []  # cut the road to 2
        events += supply(state, RULES)
        sent += sum(e.kind == "packet_sent" for e in events)
        assert before - _charges(state) == _sunk(events), tick
    assert sent > 10


def test_canonical_roundtrip_with_packets_in_flight() -> None:
    state = _line6()
    state.nodes[0].warehouse = 10
    _group(state, 0, 2, units=5)
    for tick in range(1, 16):
        state.tick = tick
        supply(state, RULES)
    assert state.packets
    restored = from_canonical(to_canonical(state))
    assert restored == state
    assert state_hash(restored) == state_hash(state)
