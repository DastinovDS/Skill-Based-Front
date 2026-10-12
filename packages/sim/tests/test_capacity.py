"""Capacity (SIM-07, DEC-22): supplied territory, capacity by node kind, owner change, attrition.

Expected values are worked out by hand from DEC-22 (#234), item 1: the capacity of a node is
``capacity.by_kind[kind]`` (capital 10, large 8, medium 6, small 4, province 3) and does not depend
on roads, the owner or supply. Attrition details: #118 default.

The map ``fork`` (rot180), every road level 1:

    0 (capital of 0) -e0- 1 (small) -e2- 3 (small) -e4- 4 (small) ...
    0 -e1- 2 (small) -e3- 3
    mirrored: 4 -e6- 6 -e8- 7 (capital of 1), 4 -e5- 5 -e7- 7

Player 0 starts with 0, 1, 2; player 1 with 5, 6, 7; 3 and 4 are neutral. ``_fork(owned=True)``
gives 3 to player 0 and 4 to player 1 (setup, not a capture).
"""

import dataclasses
from pathlib import Path

import pytest

from gow_sim.maps import load_map
from gow_sim.ruleset import KindTable, Ruleset, load_ruleset
from gow_sim.state import (
    AtNode,
    GameState,
    Group,
    Mode,
    OnEdge,
    RoadKind,
    initial_state,
)
from gow_sim.systems.capacity import (
    capacity,
    change_owner,
    city_capacity,
    is_internal,
    node_capacities,
    standing_units,
    supplied_territory,
)

TESTS_DIR = Path(__file__).resolve().parent
MVP0 = TESTS_DIR.parents[2] / "rulesets" / "mvp-0.toml"

_BASE = load_ruleset(MVP0)
# DEC-22, item 1 (capacity by kind) and the SIM-07 starting values (attrition 30, grace 50).
RULES: Ruleset = dataclasses.replace(
    _BASE,
    capacity=dataclasses.replace(
        _BASE.capacity,
        attrition_ticks=30,
        grace_ticks=50,
        by_kind=KindTable(capital=10, city_large=8, city_medium=6, city_small=4, province=3),
    ),
)


def _fork(owned: bool = True) -> GameState:
    state = initial_state(load_map(TESTS_DIR / "maps" / "fork.json"), RULES)
    if owned:
        state.nodes[3].owner = 0
        state.nodes[4].owner = 1
    return state


def _group(state: GameState, owner: int, node: int, units: int, charged: int) -> Group:
    gid = state.new_id()
    group = Group(gid, owner, units, charged, Mode.ATTACK, AtNode(node))
    state.groups[gid] = group
    return group


def _run(state: GameState, ticks: int) -> list[str]:
    kinds: list[str] = []
    for _ in range(ticks):
        state.tick += 1
        kinds.extend(e.kind for e in capacity(state, RULES))
    return kinds


# Territory and capacity by node kind ---------------------------------------------------------


def test_supplied_territory() -> None:
    state = _fork()
    assert supplied_territory(state, 0) == (True, True, True, True, False, False, False, False)
    assert supplied_territory(state, 1) == (False, False, False, False, True, True, True, True)


def test_internal_and_buffer_edges() -> None:
    state = _fork()
    assert [is_internal(state, e) for e in range(9)] == [
        True,  # e0: 0-1
        True,  # e1: 0-2
        True,  # e2: 1-3
        True,  # e3: 2-3
        False,  # e4: 3-4, owners 0 and 1: buffer
        True,
        True,
        True,
        True,
    ]


FORK_CAPACITIES = (10, 4, 4, 4, 4, 4, 4, 10)
"""Capitals 10, small cities 4 (DEC-22, item 1)."""


def test_capacity_by_kind_with_neutral_and_owned_centre() -> None:
    assert node_capacities(_fork(owned=False), RULES) == FORK_CAPACITIES
    assert node_capacities(_fork(), RULES) == FORK_CAPACITIES


def test_roads_do_not_change_capacity() -> None:
    state = _fork()
    for eid in (2, 3):
        state.edges[eid].width, state.edges[eid].kind = 3, RoadKind.FREIGHT
    assert node_capacities(state, RULES) == FORK_CAPACITIES


def test_cut_off_node_keeps_its_capacity() -> None:
    state = _fork()
    state.nodes[1].owner = 1
    state.nodes[2].owner = 1
    # 3 is own but no longer connected to capital 0: no capacity drop (DEC-22, item 1; DEC-19).
    assert node_capacities(state, RULES) == FORK_CAPACITIES


def test_lost_capital_keeps_the_capacities() -> None:
    state = _fork()
    state.nodes[0].owner = 1
    assert supplied_territory(state, 0) == (False,) * 8
    assert node_capacities(state, RULES) == FORK_CAPACITIES


@pytest.mark.parametrize(
    ("kind", "expected"),
    [("capital", 10), ("city_large", 8), ("city_medium", 6), ("city_small", 4), ("province", 3)],
)
def test_capacity_follows_the_ruleset_table(kind: str, expected: int) -> None:
    state = _fork()
    nodes = list(state.map.nodes)
    nodes[3] = dataclasses.replace(nodes[3], kind=type(nodes[3].kind)(kind))
    state.map = dataclasses.replace(state.map, nodes=tuple(nodes))
    assert city_capacity(state, RULES, 3) == expected


# Owner change --------------------------------------------------------------------------------


def test_change_owner_empties_the_warehouse_and_keeps_roads() -> None:
    state = _fork()
    state.tick = 40
    state.nodes[3].warehouse = 4
    state.nodes[3].over_ticks = 12
    state.edges[2].width, state.edges[2].kind = 3, RoadKind.FAST
    events = change_owner(state, 3, 1)
    node = state.nodes[3]
    assert (node.owner, node.warehouse, node.over_ticks, node.captured_tick) == (1, 0, 0, 40)
    assert [e.width for e in state.edges.values()] == [1, 1, 3, 1, 1, 1, 1, 1, 1]
    assert state.edges[2].kind is RoadKind.FAST
    assert [(e.kind, e.get("node"), e.get("owner"), e.get("charges")) for e in events] == [
        ("warehouse_lost", 3, 0, 4)
    ]


def test_change_owner_to_the_same_owner_changes_nothing() -> None:
    state = _fork()
    state.nodes[3].warehouse = 4
    assert change_owner(state, 3, 0) == []
    assert (state.nodes[3].warehouse, state.nodes[3].captured_tick) == (4, None)


# Attrition rules -----------------------------------------------------------------------------


def test_standing_units_count_only_the_player_in_the_node() -> None:
    state = _fork()
    _group(state, 0, 3, 3, 1)
    _group(state, 0, 3, 2, 2)
    _group(state, 0, 1, 4, 4)
    gid = state.new_id()
    state.groups[gid] = Group(gid, 0, 5, 5, Mode.ATTACK, OnEdge(edge=2, from_node=1, progress=500))
    assert standing_units(state, 3, 0) == 5
    assert standing_units(state, 3, 1) == 0


def test_counter_resets_when_the_garrison_fits() -> None:
    state = _fork()
    group = _group(state, 0, 3, 5, 5)  # capacity 4
    _run(state, 29)
    assert state.nodes[3].over_ticks == 29
    group.units, group.charged = 4, 4
    _run(state, 1)
    assert state.nodes[3].over_ticks == 0
    group.units, group.charged = 5, 5
    assert _run(state, 29) == []  # the count starts again from zero
    assert _run(state, 1) == ["attrition"]


def test_discharged_unit_of_the_lowest_id_group_dies_first() -> None:
    state = _fork()
    g1 = _group(state, 0, 3, 2, 2)
    g2 = _group(state, 0, 3, 2, 1)
    g3 = _group(state, 0, 3, 2, 1)
    _run(state, 30)  # 6 units, capacity 4
    assert [(g.units, g.charged) for g in (g1, g2, g3)] == [(2, 2), (1, 1), (2, 1)]


def test_charged_unit_of_the_largest_group_dies_when_none_is_discharged() -> None:
    state = _fork()
    g1 = _group(state, 0, 3, 2, 2)
    g2 = _group(state, 0, 3, 3, 3)
    _run(state, 30)  # 5 units, capacity 4
    assert [(g.units, g.charged) for g in (g1, g2)] == [(2, 2), (2, 2)]


def test_largest_group_tie_goes_to_the_lowest_id() -> None:
    state = _fork()
    g1 = _group(state, 0, 3, 3, 3)
    g2 = _group(state, 0, 3, 3, 3)
    _run(state, 30)
    assert [(g.units, g.charged) for g in (g1, g2)] == [(2, 2), (3, 3)]


def test_empty_group_is_removed() -> None:
    state = _fork()
    g1 = _group(state, 0, 3, 1, 0)
    g2 = _group(state, 0, 3, 5, 5)
    state.tick = 29
    state.nodes[3].over_ticks = 29
    state.tick += 1
    events = capacity(state, RULES)
    assert g1.id not in state.groups
    assert g2.id in state.groups
    assert [
        (
            e.kind,
            e.get("node"),
            e.get("player"),
            e.get("group"),
            e.get("charged"),
            e.get("destroyed"),
        )
        for e in events
    ] == [("attrition", 3, 0, g1.id, False, True)]


def test_units_of_another_player_do_not_count() -> None:
    state = _fork()
    _group(state, 1, 3, 9, 0)  # enemy units in 0's node: combat's business, not attrition
    _group(state, 0, 2, 9, 0)
    state.nodes[2].owner = None  # a neutral node: nobody's garrison
    assert _run(state, 100) == []
