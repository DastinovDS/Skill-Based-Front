"""Capacity (SIM-07): supplied territory, capacity table, cache, owner change, attrition rules.

Expected values are worked out by hand from mechanics.md, section 9: capacity = base_capacity +
road gains of the internal roads into the supplied territory, gains by width
+1.0 / +1.5 / +2.0 / +2.3 / +2.6, rounded down. Attrition details: #118 default.

The map ``fork`` (rot180):

    0 (capital of 0, base 4) -e0 w2- 1 (base 2) -e2 w2- 3 (base 2) -e4 w1- 4 (base 2) ...
    0 -e1 w1- 2 (base 2) -e3 w3- 3
    mirrored: 4 -e6 w2- 6 -e8 w2- 7 (capital of 1), 4 -e5 w3- 5 -e7 w1- 7

Player 0 starts with 0, 1, 2; player 1 with 5, 6, 7; 3 and 4 are neutral. ``_fork(owned=True)``
gives 3 to player 0 and 4 to player 1 (setup, not a capture).
"""

import dataclasses
from pathlib import Path

from gow_sim.maps import load_map
from gow_sim.ruleset import CapacityRules, Ruleset, WidthTable, load_ruleset
from gow_sim.state import AtNode, GameState, Group, Mode, OnEdge, initial_state, to_canonical
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

# mechanics.md, section 9 (gains) and the SIM-07 starting values (attrition 30, grace 50).
RULES: Ruleset = dataclasses.replace(
    load_ruleset(MVP0),
    capacity=CapacityRules(
        attrition_ticks=30, grace_ticks=50, width_gain_centi=WidthTable((100, 150, 200, 230, 260))
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


# Territory and the capacity table ------------------------------------------------------------


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


def test_capacity_table_with_neutral_centre() -> None:
    # 0: 4 + 1.5 + 1.0 = 6.5 -> 6; 1: 2 + 1.5 (e2 buffer) = 3; 2: 2 + 1.0 (e3 buffer) = 3;
    # 3, 4 neutral: base 2.
    assert node_capacities(_fork(owned=False), RULES) == (6, 3, 3, 2, 2, 3, 3, 6)


def test_capacity_table_with_owned_centre() -> None:
    # 1: 2 + 1.5 + 1.5 = 5; 2: 2 + 1.0 + 2.0 = 5; 3: 2 + 1.5 + 2.0 = 5.5 -> 5 (e4 is a buffer).
    assert node_capacities(_fork(), RULES) == (6, 5, 5, 5, 5, 5, 5, 6)


def test_width_gains_by_table_and_rounding() -> None:
    state = _fork()
    # node 3: e2 w2 (+1.5) and e3 at every width of the table, rounded down.
    for width, expected in [(1, 4), (2, 5), (3, 5), (4, 5), (5, 6)]:
        state.edges[3].width = width  # 2 + 1.5 + {1.0, 1.5, 2.0, 2.3, 2.6}
        assert city_capacity(state, RULES, 3) == expected


def test_cut_off_node_has_only_base_capacity() -> None:
    state = _fork()
    state.nodes[1].owner = 1
    state.nodes[2].owner = 1
    # 3 is own but no longer connected to capital 0; 1 and 2 belong to 1 but not to its territory.
    assert node_capacities(state, RULES) == (4, 2, 2, 2, 5, 5, 5, 6)


def test_lost_capital_leaves_only_base_capacity() -> None:
    state = _fork()
    state.nodes[0].owner = 1
    assert supplied_territory(state, 0) == (False,) * 8
    # 0 now belongs to 1 but is not connected to capital 7: base 4; 1, 2, 3 are cut off: base 2.
    assert node_capacities(state, RULES)[:4] == (4, 2, 2, 2)


# Cache: recomputed only when owners or widths change ----------------------------------------


def test_cache_is_reused_while_owners_and_widths_stay() -> None:
    state = _fork()
    first = node_capacities(state, RULES)
    state.nodes[3].warehouse = 2
    _group(state, 0, 3, 1, 1)
    state.tick += 5
    assert node_capacities(state, RULES) is first


def test_cache_follows_owner_and_width_changes() -> None:
    state = _fork()
    assert city_capacity(state, RULES, 3) == 5
    state.edges[3].width = 5
    assert city_capacity(state, RULES, 3) == 6  # 2 + 1.5 + 2.6 = 6.1
    change_owner(state, 2, 1)
    assert city_capacity(state, RULES, 3) == 3  # 2 + 1.5
    other_rules = dataclasses.replace(
        RULES,
        capacity=dataclasses.replace(RULES.capacity, width_gain_centi=WidthTable((0,) * 5)),
    )
    assert city_capacity(state, other_rules, 3) == 2


def test_cache_is_not_part_of_the_state() -> None:
    state = _fork()
    fresh = _fork()
    node_capacities(state, RULES)
    assert state.capacity_cache is not None
    assert state == fresh
    assert to_canonical(state) == to_canonical(fresh)


# Owner change --------------------------------------------------------------------------------


def test_change_owner_empties_the_warehouse_and_keeps_widths() -> None:
    state = _fork()
    state.tick = 40
    state.nodes[3].warehouse = 4
    state.nodes[3].over_ticks = 12
    state.edges[2].width = 3
    events = change_owner(state, 3, 1)
    node = state.nodes[3]
    assert (node.owner, node.warehouse, node.over_ticks, node.captured_tick) == (1, 0, 0, 40)
    assert [e.width for e in state.edges.values()] == [2, 1, 3, 3, 1, 3, 2, 1, 2]
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
    group = _group(state, 0, 3, 6, 6)  # capacity 5
    _run(state, 29)
    assert state.nodes[3].over_ticks == 29
    group.units, group.charged = 5, 5
    _run(state, 1)
    assert state.nodes[3].over_ticks == 0
    group.units, group.charged = 6, 6
    assert _run(state, 29) == []  # the count starts again from zero
    assert _run(state, 1) == ["attrition"]


def test_discharged_unit_of_the_lowest_id_group_dies_first() -> None:
    state = _fork()
    g1 = _group(state, 0, 3, 3, 3)
    g2 = _group(state, 0, 3, 2, 1)
    g3 = _group(state, 0, 3, 2, 1)
    _run(state, 30)  # 7 units, capacity 5
    assert [(g.units, g.charged) for g in (g1, g2, g3)] == [(3, 3), (1, 1), (2, 1)]


def test_charged_unit_of_the_largest_group_dies_when_none_is_discharged() -> None:
    state = _fork()
    g1 = _group(state, 0, 3, 2, 2)
    g2 = _group(state, 0, 3, 4, 4)
    _run(state, 30)  # 6 units, capacity 5
    assert [(g.units, g.charged) for g in (g1, g2)] == [(2, 2), (3, 3)]


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
