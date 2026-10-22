"""Movement (SIM-05): traversal time, path search, two-phase moves, capture of empty neutral nodes.

Expected values are worked out by hand from the rules:

- ``terrain.speed_pct`` of SIM-01 (#17): plains 125, forest 100, mountains 70, by zone (#253,
  mechanics.md, section 4: worked examples in ``test_terrain_zones.py``). An edge of one terrain
  takes ``travel_ticks * 100 // pct`` (rounded down); for ``travel_ticks = 30``: plains
  3000 // 125 = 24, forest 30, mountains 3000 // 70 = 42. An edge between terrains A and B with
  the border at 500: ``T = travel_ticks * 100 * d // (1000 * pa * pb)``,
  ``d = 500 * pb + 500 * pa``: forest - plains 27, forest - mountains 36, both ways.
- ``progress`` in thousandths of the edge (DEC-07, rule 6): on an edge of one terrain after ``k``
  of ``T`` ticks it is ``k * 1000 // T``.
- a path goes only through own nodes; the first foreign or neutral node is its end (SIM-05);
  an empty neutral node is captured on arrival; both players arriving at once is combat
  (DEC-07, rule 5, SIM-09), so movement leaves that node neutral.
- ties between equally fast paths: ``node_key(player, node)`` (AGENTS.md, section 4.1, rule 6).

Tick convention: step ``t`` runs with ``state.tick == t``; a ``Move`` applied at tick ``t`` makes
its first step in tick ``t`` (the commands are the first system of the tick).
"""

import dataclasses
from pathlib import Path
from typing import Any

import pytest

from gow_sim.commands import Move, PlayerCommand, apply_commands
from gow_sim.maps import MapDef, load_map, map_to_data, parse_map
from gow_sim.ruleset import Ruleset, TerrainRules, TerrainTable, load_ruleset
from gow_sim.state import (
    PROGRESS_SCALE,
    AtNode,
    GameState,
    Group,
    Mode,
    OnEdge,
    Order,
    initial_state,
)
from gow_sim.systems.movement import find_path, movement, traversal_ticks

TESTS_DIR = Path(__file__).resolve().parent
MVP0 = TESTS_DIR.parents[2] / "rulesets" / "mvp-0.toml"


def _rules() -> Ruleset:
    base = load_ruleset(MVP0)
    terrain = TerrainRules(
        defense_mod=base.terrain.defense_mod,
        speed_pct=TerrainTable(plains=125, forest=100, mountains=70),
    )
    return dataclasses.replace(base, terrain=terrain)


RULES = _rules()


def _node(i: int, terrain: str, owner: int | None, capital: int | None = None) -> dict[str, Any]:
    return {
        "id": i,
        "name": f"n{i}",
        "x": 10 * i,
        "y": 10,
        "terrain": terrain,
        "vp": 1,
        "kind": "city_small",
        "capital_of": capital,
        "start_owner": owner,
        "start_units": 0,
        "start_charged": 0,
        "start_stock": 0,
    }


def _line(terrains: list[str], owners: list[int | None], travel: list[int]) -> MapDef:
    """A path graph 0 - 1 - ... - n-1; capitals at both ends (player 0 left, 1 right)."""
    n = len(terrains)
    nodes = [_node(i, terrains[i], owners[i]) for i in range(n)]
    nodes[0]["capital_of"], nodes[-1]["capital_of"] = 0, 1
    nodes[0]["kind"] = nodes[-1]["kind"] = "capital"
    edges = [
        {
            "id": i,
            "a": i,
            "b": i + 1,
            "max_level": 3,
            "travel_ticks": travel[i],
            "border_permille": 500,
        }
        for i in range(n - 1)
    ]
    mirror = {
        "nodes": {str(i): n - 1 - i for i in range(n)},
        "edges": {str(i): n - 2 - i for i in range(n - 1)},
    }
    data = {
        "meta": {"name": "line", "version": 1, "symmetry": "rot180", "width": 1000, "height": 20},
        "nodes": nodes,
        "edges": edges,
        "mirror": mirror,
    }
    return parse_map(data)


def _group(state: GameState, owner: int, node: int, units: int = 2) -> int:
    gid = state.new_id()
    state.groups[gid] = Group(gid, owner, units, units, Mode.ATTACK, AtNode(node))
    return gid


def _step(state: GameState, commands: list[PlayerCommand] | None = None) -> None:
    state.tick += 1
    apply_commands(state, RULES, commands or [])
    movement(state, RULES)


# Traversal time -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("terrain", "expected"), [("plains", 24), ("forest", 30), ("mountains", 42)]
)
def test_edge_of_one_terrain_keeps_its_time(terrain: str, expected: int) -> None:
    mapdef = _line([terrain, terrain, "forest"], [0, 0, 1], [30, 30])
    assert traversal_ticks(mapdef, RULES, 0, 1) == expected
    state = initial_state(mapdef, RULES)
    gid = _group(state, 0, 0)
    _step(state, [PlayerCommand(0, 1, Move(gid, 1))])  # tick 1: the first step
    for k in range(1, expected):
        assert state.groups[gid].location == OnEdge(0, 0, k * PROGRESS_SCALE // expected)
        _step(state)
    assert state.tick == expected
    assert state.groups[gid].location == AtNode(1)
    assert state.groups[gid].order is None


def test_both_zones_count_in_both_directions() -> None:
    # 0 forest - 1 mountains, border 500: d = 500 * 70 + 500 * 100 = 85000,
    # T = 3000 * 85000 // (1000 * 100 * 70) = 36 both ways (#253).
    mapdef = _line(["forest", "mountains", "forest"], [0, 0, 1], [30, 30])
    assert traversal_ticks(mapdef, RULES, 0, 1) == 36
    assert traversal_ticks(mapdef, RULES, 0, 0) == 36


def test_a_path_takes_the_sum_of_its_edges() -> None:
    # 0 forest -> 1 plains (27) -> 2 forest (27) -> 3 mountains (36), all own but the last.
    mapdef = _line(["forest", "plains", "forest", "mountains"], [0, 0, 0, 1], [30, 30, 30])
    state = initial_state(mapdef, RULES)
    gid = _group(state, 0, 0)
    _step(state, [PlayerCommand(0, 1, Move(gid, 3))])
    reached: dict[int, int] = {}
    while state.tick < 200:
        match state.groups[gid].location:
            case AtNode(node=node) | OnEdge(from_node=node, progress=0):
                reached.setdefault(node, state.tick)
            case OnEdge():
                pass
        _step(state)
    assert reached == {1: 27, 2: 27 + 27, 3: 27 + 27 + 36}


def test_transit_never_stands_in_an_intermediate_node() -> None:
    """Between ticks a group passing an own node is on the next edge (#118: transit)."""
    mapdef = _line(["forest"] * 4, [0, 0, 0, 1], [30, 30, 30])
    state = initial_state(mapdef, RULES)
    gid = _group(state, 0, 0)
    _step(state, [PlayerCommand(0, 1, Move(gid, 3))])
    while state.tick < 90:
        assert not isinstance(state.groups[gid].location, AtNode), state.tick
        _step(state)
    assert state.groups[gid].location == AtNode(3)


def test_planned_order_departs_after_the_delay() -> None:
    mapdef = _line(["forest", "forest", "forest"], [0, 0, 1], [30, 30])
    state = initial_state(mapdef, RULES)
    gid = _group(state, 0, 0)
    _step(state, [PlayerCommand(0, 1, Move(gid, 1, planned=True))])  # applied at tick 1
    delay = RULES.orders.planned_delay_ticks  # DEC-08: 30 ticks
    while state.tick < delay:
        assert state.groups[gid].location == AtNode(0)
        _step(state)
    assert state.groups[gid].location == AtNode(0)  # tick 30: 30 ticks waited (1..30)
    _step(state)  # tick 31 = 1 + delay: departs and makes the first step
    assert state.groups[gid].location == OnEdge(0, 0, 1 * PROGRESS_SCALE // 30)


def test_too_long_edge_is_an_error() -> None:
    # One terrain: at most PROGRESS_SCALE ticks (70000 // 70 = 1000 fits, 70100 // 70 = 1001 not).
    mapdef = _line(["mountains", "mountains", "mountains", "forest"], [0, 0, 0, 1], [700, 701, 30])
    assert traversal_ticks(mapdef, RULES, 0, 1) == 1000
    with pytest.raises(ValueError, match="takes 1001 ticks: too slow"):
        traversal_ticks(mapdef, RULES, 1, 2)
    # Two zones: forest - mountains of 701: T = 70100 * 85000 // 7000000 = 851, and
    # 851 * 100 > 85000: the forest zone would not move a thousandth every tick.
    mapdef = _line(["forest", "mountains", "forest"], [0, 0, 1], [701, 30])
    with pytest.raises(ValueError, match="takes 851 ticks: too slow"):
        traversal_ticks(mapdef, RULES, 0, 1)


# Path search ----------------------------------------------------------------------------------


def _diamond(owner_of_sides: int | None) -> GameState:
    """tests/maps/diamond.json: 0 joins 1 and 2, 3 joins 1 and 2; all edges 42, forest sides."""
    state = initial_state(load_map(TESTS_DIR / "maps" / "diamond.json"), RULES)
    state.nodes[1].owner = state.nodes[2].owner = owner_of_sides
    return state


def test_equal_paths_break_ties_by_node_key() -> None:
    state = _diamond(0)
    # 0 -> 1 -> 3 and 0 -> 2 -> 3 take 42 + 42 * 100 // 70 each; node_key of player 0 is the id.
    assert find_path(state, RULES, 0, 0, 3) == (0, 1, 3)
    assert find_path(state, RULES, 0, 0, 3) == (0, 1, 3)  # the same every time
    # Player 1 on the mirrored position: node_key is the mirror id (1 <-> 2), so it takes the
    # mirror of player 0's path 0 -> 1 -> 3, that is 3 -> 2 -> 0.
    mirrored = _diamond(1)
    assert find_path(mirrored, RULES, 1, 3, 0) == (3, 2, 0)


def test_tie_break_does_not_depend_on_dict_order() -> None:
    state = _diamond(0)
    state.nodes = dict(reversed(list(state.nodes.items())))
    assert find_path(state, RULES, 0, 0, 3) == (0, 1, 3)


def test_path_goes_only_through_own_nodes() -> None:
    # 0 own - 1 neutral - 2 own - 3 enemy capital
    mapdef = _line(["forest"] * 4, [0, None, 0, 1], [30, 30, 30])
    state = initial_state(mapdef, RULES)
    assert find_path(state, RULES, 0, 0, 1) == (0, 1)  # the neutral node is the target
    assert find_path(state, RULES, 0, 0, 2) is None  # would pass the neutral node
    assert find_path(state, RULES, 0, 0, 3) is None


def test_faster_path_wins_over_fewer_edges() -> None:
    state = _diamond(0)
    # Make 0 -> 1 slow: 0 -> 2 -> 3 is then faster than 0 -> 1 -> 3.
    data: Any = map_to_data(state.map)
    data["edges"][0]["travel_ticks"] = 60
    state.map = parse_map(data)
    assert find_path(state, RULES, 0, 0, 3) == (0, 2, 3)


# Arrivals and captures ------------------------------------------------------------------------


def test_empty_neutral_node_is_captured_on_arrival() -> None:
    mapdef = _line(["forest"] * 3, [0, None, 1], [30, 30])
    state = initial_state(mapdef, RULES)
    gid = _group(state, 0, 0)
    _step(state, [PlayerCommand(0, 1, Move(gid, 1))])
    while state.tick < 30:
        assert state.nodes[1].owner is None
        _step(state)
    assert state.groups[gid].location == AtNode(1)
    assert state.nodes[1].owner == 0


def test_simultaneous_arrival_leaves_the_node_neutral() -> None:
    mapdef = _line(["forest"] * 3, [0, None, 1], [30, 30])
    state = initial_state(mapdef, RULES)
    g0, g1 = _group(state, 0, 0), _group(state, 1, 2)
    _step(state, [PlayerCommand(0, 1, Move(g0, 1)), PlayerCommand(1, 1, Move(g1, 1))])
    while state.tick < 30:
        _step(state)
    assert state.groups[g0].location == state.groups[g1].location == AtNode(1)
    assert state.nodes[1].owner is None  # a fight for SIM-09 (DEC-07, rule 5)


def test_arriving_at_a_neutral_node_held_by_the_enemy_is_no_capture() -> None:
    mapdef = _line(["forest"] * 3, [0, None, 1], [30, 30])
    state = initial_state(mapdef, RULES)
    gid = _group(state, 0, 0)
    _group(state, 1, 1)
    _step(state, [PlayerCommand(0, 1, Move(gid, 1))])
    while state.tick < 30:
        _step(state)
    assert state.nodes[1].owner is None


def test_group_stops_at_an_own_node_lost_on_the_way() -> None:
    mapdef = _line(["forest"] * 4, [0, 0, 0, 1], [30, 30, 30])
    state = initial_state(mapdef, RULES)
    gid = _group(state, 0, 0)
    _step(state, [PlayerCommand(0, 1, Move(gid, 3))])
    state.nodes[1].owner = 1  # lost while the group is on the edge 0 - 1
    while state.tick < 30:
        _step(state)
    assert state.groups[gid].location == AtNode(1)
    assert state.groups[gid].order is None
    _step(state)
    assert state.groups[gid].location == AtNode(1)


def test_groups_move_independently_of_their_ids() -> None:
    """Swapping the ids of two groups gives the same positions (phase 1 has no order effect)."""

    def run(first_owner: int) -> list[tuple[int, str]]:
        mapdef = _line(["forest"] * 3, [0, None, 1], [30, 30])
        state = initial_state(mapdef, RULES)
        owners = [first_owner, 1 - first_owner]
        gids = [_group(state, p, 0 if p == 0 else 2) for p in owners]
        cmds = [PlayerCommand(p, 1, Move(g, 1)) for p, g in zip(owners, gids, strict=True)]
        _step(state, cmds)
        for _ in range(40):
            _step(state)
        return sorted((g.owner, repr(g.location)) for g in state.groups.values())

    assert run(0) == run(1)


def test_on_edge_order_keeps_the_rest_of_the_path() -> None:
    mapdef = _line(["forest"] * 4, [0, 0, 0, 1], [30, 30, 30])
    state = initial_state(mapdef, RULES)
    gid = _group(state, 0, 0)
    _step(state, [PlayerCommand(0, 1, Move(gid, 3))])
    assert state.groups[gid].order == Order(path=(1, 2, 3), planned=False, depart_tick=1)
    while state.tick < 30:
        _step(state)
    assert state.groups[gid].location == OnEdge(edge=1, from_node=1, progress=0)
    assert state.groups[gid].order == Order(path=(2, 3), planned=False, depart_tick=1)


@pytest.mark.parametrize("name", ["pereval", "pautina", "arteriya"])
def test_mvp_maps_fit_the_progress_scale(name: str) -> None:
    """Every edge of the MVP maps, both ways, takes at most PROGRESS_SCALE ticks on mvp-0."""
    mapdef = load_map(TESTS_DIR.parents[2] / "maps" / f"{name}.json")
    rules = load_ruleset(MVP0)
    for e in mapdef.edges:
        for to_node in (e.a, e.b):
            assert 1 <= traversal_ticks(mapdef, rules, e.id, to_node) <= PROGRESS_SCALE
