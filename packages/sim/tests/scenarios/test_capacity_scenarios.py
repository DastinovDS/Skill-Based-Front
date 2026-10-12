"""Scenarios of SIM-07 (#23) on the map ``fork``: cut approach, attrition, captured warehouse.

Map: see ``packages/sim/tests/test_capacity.py``. Capacity by node kind (DEC-22, item 1): ``RULES``
pins a small city at 5, so city 3 holds 5 units whoever owns it and whatever is cut; attrition 30
ticks, grace 50 ticks (SIM-07 starting values, pinned below). Tick convention: step ``t`` runs
with ``state.tick == t``.
"""

import dataclasses
from pathlib import Path

from gow_sim.maps import load_map
from gow_sim.ruleset import CapacityRules, KindTable, Ruleset, load_ruleset
from gow_sim.state import AtNode, Event, GameState, Group, Mode, OnEdge, initial_state
from gow_sim.systems.capacity import capacity, change_owner, city_capacity, node_capacities

TESTS_DIR = Path(__file__).resolve().parents[1]
MVP0 = TESTS_DIR.parents[2] / "rulesets" / "mvp-0.toml"

RULES: Ruleset = dataclasses.replace(
    load_ruleset(MVP0),
    capacity=CapacityRules(
        attrition_ticks=30,
        grace_ticks=50,
        by_kind=KindTable(capital=10, city_large=8, city_medium=6, city_small=5, province=3),
    ),
)


def _fork() -> GameState:
    state = initial_state(load_map(TESTS_DIR / "maps" / "fork.json"), RULES)
    state.nodes[3].owner = 0
    state.nodes[4].owner = 1
    return state


def _group(state: GameState, owner: int, node: int, units: int, charged: int) -> Group:
    gid = state.new_id()
    group = Group(gid, owner, units, charged, Mode.ATTACK, AtNode(node))
    state.groups[gid] = group
    return group


def _step(state: GameState) -> list[Event]:
    state.tick += 1
    return capacity(state, RULES)


def _deaths(state: GameState, ticks: int) -> list[int]:
    """Ticks with an attrition death during the next ``ticks`` steps."""
    return [state.tick for _ in range(ticks) if any(e.kind == "attrition" for e in _step(state))]


def test_cut_approach_does_not_change_capacity() -> None:
    state = _fork()
    assert city_capacity(state, RULES, 3) == 5
    # Player 1 takes 2, then 1: 3 is cut off from the capital; capacities stay (DEC-22, item 1).
    change_owner(state, 2, 1)
    assert city_capacity(state, RULES, 3) == 5
    change_owner(state, 1, 1)
    assert node_capacities(state, RULES)[:4] == (10, 5, 5, 5)


def test_garrison_above_capacity_loses_units_at_the_rate_discharged_first() -> None:
    state = _fork()
    garrison = _group(state, 0, 3, units=7, charged=5)  # capacity 5: 2 too many
    # A group passing by on the road into 3 is in transit: it is not counted and does not lose.
    transit = Group(state.new_id(), 0, 4, 0, Mode.ATTACK, OnEdge(edge=2, from_node=1, progress=400))
    state.groups[transit.id] = transit
    assert _deaths(state, 200) == [30, 60]  # one unit per 30 ticks until it fits
    assert (garrison.units, garrison.charged) == (5, 5)  # the two discharged died
    assert (transit.units, transit.charged) == (4, 0)


def test_charged_units_die_after_the_discharged() -> None:
    state = _fork()
    garrison = _group(state, 0, 3, units=7, charged=6)
    assert _deaths(state, 30) == [30]
    assert (garrison.units, garrison.charged) == (6, 6)  # the discharged one
    assert _deaths(state, 30) == [60]
    assert (garrison.units, garrison.charged) == (5, 5)  # then a charged one


def test_cutting_an_approach_does_not_start_attrition() -> None:
    state = _fork()
    garrison = _group(state, 0, 3, units=5, charged=5)  # exactly the capacity 5
    assert _deaths(state, 100) == []
    change_owner(state, 2, 1)  # at tick 100; the capacity of 3 stays 5 (DEC-22)
    assert _deaths(state, 100) == []
    assert garrison.units == 5


def test_transit_group_does_not_push_the_garrison_over() -> None:
    state = _fork()
    _group(state, 0, 3, units=5, charged=5)
    gid = state.new_id()
    state.groups[gid] = Group(gid, 0, 3, 3, Mode.ATTACK, OnEdge(edge=3, from_node=2, progress=900))
    assert _deaths(state, 100) == []


def test_captured_city_warehouse_is_emptied_and_grace_applies() -> None:
    state = _fork()
    state.nodes[3].warehouse = 4
    state.tick = 10
    events = change_owner(state, 3, 1)  # player 1 takes 3 at tick 10
    assert state.nodes[3].warehouse == 0
    assert [(e.kind, e.get("charges")) for e in events] == [("warehouse_lost", 4)]
    assert city_capacity(state, RULES, 3) == 5  # the same for the new owner
    _group(state, 1, 3, units=6, charged=0)
    # Grace: ticks 10..59 do not count; counting starts at 60, the first death at 60 + 29 = 89.
    assert _deaths(state, 100) == [89]
