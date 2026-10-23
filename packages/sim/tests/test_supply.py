"""Supply (SIM-08): packet time table, recharge, charge conservation, canonical form.

Expected values from mechanics.md, sections 7 and 8, SIM-01 (#17) and DEC-22 (#234), item 4
with DEC-26 (#265), item 7: packet time ``travel_ticks * 100 // speed_pct`` with speed 100 on
level 1, 150 / 200 on level 2 / 3 (no road types); recharge at most 1 charge per node and tick;
details: DEC-14 default (#131).

The map ``line6``: ``0 (capital of 0) - 1 - 2 | 3 - 4 - 5 (capital of 1)``; 2 and 3 start
neutral, ``_line6()`` gives them to 0 and 1. Every road ``e_i`` joins ``i`` and ``i + 1``,
level 1, 30 ticks; plains; ``RULES`` gives capitals capacity 40 and the large cities 30, so
capacity never limits these tests.
"""

import dataclasses
from pathlib import Path

import pytest

from gow_sim.maps import load_map
from gow_sim.ruleset import FullLevelTable, LevelTable, Ruleset, load_ruleset
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
from gow_sim.systems.supply import (
    all_packet_ticks,
    fastest_ways_to,
    packet_ticks,
    supply,
    supply_tree,
    transfer_route,
    way_from,
)

TESTS_DIR = Path(__file__).resolve().parent
_MVP0: Ruleset = load_ruleset(TESTS_DIR.parents[2] / "rulesets" / "mvp-0.toml")
RULES: Ruleset = dataclasses.replace(
    _MVP0,
    capacity=dataclasses.replace(
        _MVP0.capacity,
        by_kind=dataclasses.replace(_MVP0.capacity.by_kind, capital=40, city_large=30),
    ),
    supply=dataclasses.replace(
        _MVP0.supply,
        base_speed_pct=100,
        amount_by_level=FullLevelTable((1, 2, 3)),
        fast_speed_pct=LevelTable((150, 200)),
    ),
)


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


@pytest.mark.parametrize(
    ("level", "ticks"),
    [
        (1, 30),
        (2, 20),  # 30 * 100 // 150
        (3, 15),  # 30 * 100 // 200
    ],
)
def test_packet_time_by_level(level: int, ticks: int) -> None:
    assert packet_ticks(_line6().map, RULES, 0, level) == ticks


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
    state.players[0].fronts = (2, None)  # DEC-28: the garrison city fills up, a steady demand
    state.players[1].fronts = (3, None)
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


# The ways of a dispatch: one Dijkstra per city with a deficit (#306) --------------------------


@pytest.mark.parametrize("name", ["artery", "web", "pass"])
def test_fastest_ways_to_equal_transfer_route(name: str) -> None:
    """``fastest_ways_to``/``way_from`` give the way ``transfer_route`` gives (the fastest one,
    ties by the lexicographically smaller ``node_key`` sequence from the start) for every pair of
    own nodes, on random owners and road levels, for both players."""
    mapdef = load_map(TESTS_DIR.parents[2] / "maps" / f"{name}.json")
    seed = 306

    def draw(n: int) -> int:  # a fixed linear congruential sequence (no ``random`` here)
        nonlocal seed
        seed = (seed * 1103515245 + 12345) % 2**31
        return seed // 65536 % n

    for _ in range(20):
        state = initial_state(mapdef, _MVP0)
        for node in state.nodes.values():
            node.owner = (0, 0, 1, 1, None)[draw(5)]
        for road in state.edges.values():
            road.width = 1 + draw(mapdef.edges[road.id].max_level)
        ticks = all_packet_ticks(state, _MVP0)
        for player in (0, 1):
            own = [n for n in range(len(mapdef.nodes)) if state.nodes[n].owner == player]
            for dst in own:
                ways = fastest_ways_to(state, player, dst, ticks)
                for src in own:
                    expected = transfer_route(state, _MVP0, player, src, dst)
                    assert way_from(state, player, ways, src, ticks) == expected, (src, dst)
