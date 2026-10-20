"""Scenarios of SIM-08 (#24) under DEC-28: transit through a city, road level, cut road.

Maps, rules and hand computations: see ``packages/sim/tests/test_supply.py`` (``line6``: roads
of 30 ticks, packet time 30 on level 1; DEC-26: a road of any level carries 1 charge per
period, an upgraded one only faster). Dispatch every 10 ticks, ``rear_min = 1``, no markers
unless a test sets one, recharge 1 per tick (SIM-01 starting values). Tick convention: step ``t``
runs with ``state.tick == t``; a packet sent at tick ``t`` is delivered at ``t + packet time``.
The scenario "no packet moves towards the capital" of SIM-08 is gone: DEC-28 donors give in
any direction (example 7).
"""

import dataclasses
from pathlib import Path

from gow_sim.maps import load_map
from gow_sim.ruleset import LevelTable, Ruleset, load_ruleset
from gow_sim.state import AtNode, Event, GameState, Group, Mode, initial_state
from gow_sim.systems.capacity import change_owner
from gow_sim.systems.supply import supply

TESTS_DIR = Path(__file__).resolve().parents[1]
ROOT = TESTS_DIR.parents[2]
MVP0: Ruleset = load_ruleset(ROOT / "rulesets" / "mvp-0.toml")
RULES: Ruleset = dataclasses.replace(
    MVP0,
    capacity=dataclasses.replace(
        MVP0.capacity,
        by_kind=dataclasses.replace(MVP0.capacity.by_kind, capital=40, city_large=30),
    ),
    supply=dataclasses.replace(
        MVP0.supply,
        base_speed_pct=100,
        base_amount=1,
        fast_speed_pct=LevelTable((150, 200)),
    ),
)
"""As in ``test_supply.py``: capacity never limits ``line6``; the DEC-22 road numbers."""


def _line6() -> GameState:
    state = initial_state(load_map(TESTS_DIR / "maps" / "line6.json"), RULES)
    state.nodes[2].owner = 0  # setup, not a capture: 2 and 3 start neutral
    state.nodes[3].owner = 1
    return state


def _group(state: GameState, owner: int, node: int, units: int) -> Group:
    gid = state.new_id()
    group = Group(gid, owner, units, 0, Mode.ATTACK, AtNode(node))
    state.groups[gid] = group
    return group


def _step(state: GameState) -> list[Event]:
    state.tick += 1
    return supply(state, RULES)


def test_chain_charges_reach_b_through_a() -> None:
    state = _line6()
    state.nodes[0].warehouse = 10
    state.nodes[1].warehouse = 2  # A: target 1 (rear_min), so a donor of 1
    b = _group(state, 0, 2, units=5)
    events: list[Event] = []
    for _ in range(39):
        events += _step(state)
    # Tick 10: B lacks 1; the nearest donor is A (30 ticks, K: 60): A -> B 1, arrives 40.
    assert b.charged == 0
    assert state.nodes[1].warehouse == 1
    events += _step(state)
    assert b.charged == 1  # delivered at 40 and recharged in the same tick
    # Tick 40: B lacks 1 again; A holds its target, so K sends through A (transit, DEC-28,
    # item 1): one packet of 60 ticks, A's warehouse untouched.
    sent = [
        (e.tick, e.get("from_node"), e.get("to_node"), e.get("charges"))
        for e in events
        if e.kind == "packet_sent"
    ]
    assert sent == [(10, 1, 2, 1), (40, 0, 2, 1)]
    for _ in range(59):
        events += _step(state)
    assert b.charged == 1 and state.nodes[1].warehouse == 1
    _step(state)
    assert b.charged == 2  # tick 100


def _delivered(level: int) -> int:
    """Charges delivered into node 1 during ticks 41..140 over road 0 of the given level."""
    state = _line6()
    state.edges[0].width = level
    state.nodes[0].warehouse = 200
    _group(state, 0, 1, units=60)  # demand far above what the road carries
    state.players[0].fronts = (1, None)  # DEC-28: the marker city fills up to the capacity
    total = 0
    for _ in range(140):
        for e in _step(state):
            if e.kind == "packet_delivered" and e.get("node") == 1 and e.tick > 40:
                total += int(e.get("charges") or 0)
    return total


def test_an_upgraded_road_is_faster_not_wider() -> None:
    # One packet of at most `amount` charges per road per 10-tick period: 10 periods in the window.
    assert _delivered(1) == 10
    assert _delivered(3) == 10  # faster, not more (DEC-26, item 7)


def test_cut_road_stops_refill_and_recharge_behind_it() -> None:
    state = _line6()
    state.nodes[0].warehouse = 30
    b = _group(state, 0, 2, units=30)
    for _ in range(100):
        _step(state)
    assert b.charged > 0
    state.tick = 100
    events = change_owner(state, 1, 1)  # the enemy takes 1: roads 0-1 and 1-2 are buffers
    for _ in range(200):
        events += _step(state)
    assert any(e.kind == "packet_lost" for e in events)
    assert not any(e.kind == "packet_delivered" and e.get("node") == 2 for e in events)
    assert state.nodes[2].warehouse == 0
    charged = b.charged
    for _ in range(100):
        _step(state)
    assert b.charged == charged < b.units  # nothing left to recharge from
