"""The terrain mark of a node in the view (#791, refs #776): ``NodeView.terrain_mark``.

Expected values come from DEC-24, item F2 and the rulesets: the defender of a node with a charged
unit standing in it gets ``terrain.defense_mod`` (``dec07.toml``: mountains +1, plains -1, forest
0); an attacker, a discharged group, a group on an edge and a node with a fight get nothing (item
F3: no terrain on edges). A fog test (AGENTS.md 4.4): the enemy's mark only where the view shows its
charges, ``EXACT``; the levels come from the terrain table of ``dec07.toml`` (``vision.by_terrain``:
from plains, plains are exact and mountains presence; from a forest, plains are a range).

The map is a line ``0 - 1 - 2``: capitals at the ends on ``home`` terrain, node 1 on ``terrain``.
"""

from pathlib import Path
from typing import Any

import pytest

from gow_sim.maps import PLAYERS, MapDef, parse_map
from gow_sim.match import Match
from gow_sim.ruleset import Ruleset, load_ruleset
from gow_sim.state import AtNode, Detail, GameState, Group, Mode, OnEdge, Order, initial_state
from gow_sim.systems.movement import leg
from gow_sim.view import project

TESTS_DIR = Path(__file__).resolve().parent
RULES = load_ruleset(TESTS_DIR / "rulesets" / "dec07.toml")
KEY = bytes(range(32))


def line(terrain: str, owner: int | None, home: str = "forest") -> MapDef:
    nodes: list[dict[str, Any]] = [
        {
            "id": i,
            "name": f"n{i}",
            "x": 10 * i,
            "y": 10,
            "terrain": terrain if i == 1 else home,
            "vp": 1,
            "kind": "capital" if i != 1 else "city_large",
            "capital_of": {0: 0, 2: 1}.get(i),
            "start_owner": {0: 0, 1: owner, 2: 1}[i],
            "start_units": 0,
            "start_charged": 0,
            "start_stock": 0,
        }
        for i in range(3)
    ]
    edges = [
        {"id": i, "a": i, "b": i + 1, "max_level": 3, "travel_ticks": 30, "border_permille": 500}
        for i in range(2)
    ]
    return parse_map(
        {
            "meta": {"name": "l", "version": 1, "symmetry": "rot180", "width": 100, "height": 20},
            "nodes": nodes,
            "edges": edges,
            "mirror": {"nodes": {"0": 2, "1": 1, "2": 0}, "edges": {"0": 1, "1": 0}},
        }
    )


def add(state: GameState, owner: int, units: int, charged: int, loc: AtNode | OnEdge) -> int:
    gid = state.new_id()
    state.groups[gid] = Group(gid, owner, units, charged, Mode.ATTACK, loc)
    return gid


def home(player: int) -> int:
    return 0 if player == 0 else 2


def mark(state: GameState, player: int, rules: Ruleset = RULES) -> int | None:
    return project(state, rules, player, KEY).nodes[1].terrain_mark


@pytest.mark.parametrize("defender", PLAYERS)
@pytest.mark.parametrize(("terrain", "expected"), [("mountains", 1), ("plains", -1)])
def test_a_charged_defender_carries_the_terrain(defender: int, terrain: str, expected: int) -> None:
    state = initial_state(line(terrain, defender), RULES)
    add(state, defender, 3, 2, AtNode(1))
    assert mark(state, defender) == expected


@pytest.mark.parametrize("defender", PLAYERS)
def test_a_forest_has_no_mark(defender: int) -> None:
    state = initial_state(line("forest", defender), RULES)
    add(state, defender, 3, 3, AtNode(1))
    assert mark(state, defender) is None


@pytest.mark.parametrize("terrain", ["mountains", "plains"])
def test_a_discharged_defender_has_no_mark(terrain: str) -> None:
    """Item F2: the condition is a charged unit at contact."""
    state = initial_state(line(terrain, 0), RULES)
    add(state, 0, 4, 0, AtNode(1))
    assert mark(state, 0) is None
    add(state, 0, 1, 1, AtNode(1))  # a second group of the owner brings the charge
    assert mark(state, 0) == RULES.terrain.defense_mod.of(state.map.nodes[1].terrain)


@pytest.mark.parametrize("terrain", ["mountains", "plains"])
def test_a_group_on_a_road_and_an_empty_node_have_no_mark(terrain: str) -> None:
    """Item F3: no terrain on edges; the node itself has no defender."""
    state = initial_state(line(terrain, 0), RULES)
    way = leg(state.map, RULES, 0, 1)
    add(state, 0, 3, 3, OnEdge(0, 0, way.progress(5)))
    assert mark(state, 0) is None


@pytest.mark.parametrize("terrain", ["mountains", "plains"])
def test_a_neutral_node_has_no_mark(terrain: str) -> None:
    state = initial_state(line(terrain, None), RULES)
    assert all(n.terrain_mark is None for p in PLAYERS for n in project(state, RULES, p, KEY).nodes)


@pytest.mark.parametrize("attacker", PLAYERS)
@pytest.mark.parametrize("terrain", ["mountains", "plains"])
def test_no_mark_in_a_fight_and_never_for_the_attacker(attacker: int, terrain: str) -> None:
    """In a fight the arena tells the terrain (``FightView``): no map mark for either side."""
    defender = 1 - attacker
    match = Match(line(terrain, defender), RULES, KEY)
    state = match.state
    add(state, defender, 2, 2, AtNode(1))
    assert mark(state, defender) is not None
    edge = 0 if attacker == 0 else 1
    way = leg(state.map, RULES, edge, 1)
    gid = add(state, attacker, 2, 2, OnEdge(edge, home(attacker), way.progress(way.ticks - 1)))
    state.groups[gid].order = Order((1,), False, 0)
    match.step()
    assert state.fights, "the attacker arrived and a fight started"
    for player in PLAYERS:
        assert mark(state, player) is None


@pytest.mark.parametrize("defender", PLAYERS)
@pytest.mark.parametrize(
    ("terrain", "source", "level"),
    [
        ("plains", "plains", Detail.EXACT),
        ("plains", "mountains", Detail.EXACT),
        ("plains", "forest", Detail.RANGE),
        ("mountains", "plains", Detail.PRESENCE),
        ("mountains", "mountains", Detail.RANGE),
        ("mountains", "forest", Detail.PRESENCE),
    ],
)
def test_the_enemy_mark_only_where_its_charges_are_seen(
    defender: int, terrain: str, source: str, level: Detail
) -> None:
    """A fog test: the viewer's group in its capital is the source; the mark of the enemy's node
    is there exactly when the view gives the enemy's charges there (``EXACT``)."""
    viewer = 1 - defender
    state = initial_state(line(terrain, defender, home=source), RULES)
    add(state, defender, 3, 2, AtNode(1))
    add(state, viewer, 1, 1, AtNode(home(viewer)))
    view = project(state, RULES, viewer, KEY).nodes[1]
    assert view.detail is level
    own = mark(state, defender)
    assert view.terrain_mark == (own if level is Detail.EXACT else None)
    if level is Detail.EXACT:
        assert view.seen is not None and view.seen.enemy_charged == 2


@pytest.mark.parametrize("defender", PLAYERS)
def test_no_enemy_mark_in_fog(defender: int) -> None:
    """Own nodes are no vision sources (DEC-35): without a group the enemy's node is in fog."""
    viewer = 1 - defender
    state = initial_state(line("plains", defender, home="plains"), RULES)
    add(state, defender, 3, 2, AtNode(1))
    view = project(state, RULES, viewer, KEY).nodes[1]
    assert view.detail is Detail.FOG
    assert view.terrain_mark is None
