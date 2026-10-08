"""Vision (SIM-03): detail levels of DEC-04 on the test maps, is_visible, fog memory.

Expected levels are worked out by hand from DEC-04 (mechanics.md, section 10) and the map files:

- line3: 0 (capital of 0) - e0 - 1 (neutral) - e1 - 2 (capital of 1);
- diamond: 0 (capital of 0) joins 1 and 2 by e0 and e1; 3 (capital of 1) joins 2 and 1 by e2, e3;
- pass: 0 -e0- 1 -e1- 3, then 3 -e2- 2, 3 -e5- 4, 3 -e4- 5 -e3- 6; player 0 owns 0 and 1,
  player 1 owns 5 and 6, nodes 2, 3, 4 are neutral.
"""

from pathlib import Path

import pytest

from gow_sim.maps import load_map
from gow_sim.ruleset import Ruleset, load_ruleset
from gow_sim.state import (
    AtNode,
    Detail,
    GameState,
    Group,
    Intent,
    IntentKind,
    Mode,
    OnEdge,
    Packet,
    Sighting,
    initial_state,
)
from gow_sim.systems.vision import (
    compute_vision,
    detail_level,
    edge_detail_level,
    is_visible,
    visible_edges,
    visible_nodes,
    vision,
)

TESTS_DIR = Path(__file__).resolve().parent
MVP0 = TESTS_DIR.parents[2] / "rulesets" / "mvp-0.toml"

E, P, F = Detail.EXACT, Detail.PRESENCE, Detail.FOG


@pytest.fixture(scope="module")
def rules() -> Ruleset:
    return load_ruleset(MVP0)


def _state(name: str, rules: Ruleset) -> GameState:
    return initial_state(load_map(TESTS_DIR / "maps" / f"{name}.json"), rules)


def _add(
    state: GameState, owner: int, location: AtNode | OnEdge, mode: Mode = Mode.ATTACK
) -> Group:
    gid = state.new_id()
    group = Group(gid, owner, units=3, charged=2, mode=mode, location=location)
    state.groups[gid] = group
    return group


def _levels(state: GameState, player: int) -> tuple[list[Detail], list[Detail]]:
    v = compute_vision(state, player)
    return list(v.nodes), list(v.edges)


# Detail levels -------------------------------------------------------------------------------


def test_line3_start(rules: Ruleset) -> None:
    state = _state("line3", rules)
    # Own capital exact, the neutral neighbour presence, the enemy capital two steps away fog.
    assert _levels(state, 0) == ([E, P, F], [P, F])
    assert _levels(state, 1) == ([F, P, E], [F, P])


def test_diamond_start(rules: Ruleset) -> None:
    state = _state("diamond", rules)
    assert _levels(state, 0) == ([E, P, P, F], [P, P, F, F])
    assert _levels(state, 1) == ([F, P, P, E], [F, F, P, P])


def test_pass_start(rules: Ruleset) -> None:
    state = _state("pass", rules)
    assert _levels(state, 0) == ([E, E, F, P, F, F, F], [P, P, F, F, F, F])
    assert _levels(state, 1) == ([F, F, F, P, F, E, E], [F, F, F, P, P, F])


def test_standing_group_makes_its_node_exact(rules: Ruleset) -> None:
    # A group of player 0 stands in the neutral pass node 3 (ownership unchanged).
    state = _state("pass", rules)
    _add(state, 0, AtNode(3))
    assert state.nodes[3].owner is None
    assert _levels(state, 0) == ([E, E, P, E, P, P, F], [P, P, P, F, P, P])
    # The enemy's view does not change from a foreign group.
    assert _levels(state, 1) == ([F, F, F, P, F, E, E], [F, F, F, P, P, F])


def test_group_on_edge_gives_no_vision(rules: Ruleset) -> None:
    # TODO(#112): default of the question, literal DEC-04. Player 0 lost both of its nodes; its
    # group on e1 (1 -> 3) stands nowhere, so it sees nothing, not even its own edge.
    state = _state("pass", rules)
    state.nodes[0].owner = 1
    state.nodes[1].owner = 1
    state.groups.clear()
    own = _add(state, 0, OnEdge(edge=1, from_node=1, progress=500))
    enemy = _add(state, 1, OnEdge(edge=1, from_node=3, progress=100))
    assert _levels(state, 0) == ([F] * 7, [F] * 6)
    assert is_visible(state, 0, own)
    assert not is_visible(state, 0, enemy)


def test_single_node_and_edge_queries(rules: Ruleset) -> None:
    state = _state("diamond", rules)
    assert [detail_level(state, 0, n) for n in range(4)] == [E, P, P, F]
    assert [edge_detail_level(state, 1, e) for e in range(4)] == [F, F, P, P]
    assert visible_nodes(state, 0) == (0, 1, 2)
    assert visible_edges(state, 0) == (0, 1)
    assert visible_nodes(state, 1) == (1, 2, 3)
    assert visible_edges(state, 1) == (2, 3)


def test_levels_are_mirror_symmetric(rules: Ruleset) -> None:
    for name in ("line3", "diamond", "pass"):
        state = _state(name, rules)
        mapdef = state.map
        v0, v1 = compute_vision(state, 0), compute_vision(state, 1)
        assert [v1.nodes[mapdef.mirror_nodes[n]] for n in range(len(mapdef.nodes))] == list(
            v0.nodes
        )
        assert [v1.edges[mapdef.mirror_edges[e]] for e in range(len(mapdef.edges))] == list(
            v0.edges
        )


# is_visible ----------------------------------------------------------------------------------


def test_enemy_groups_in_nodes(rules: Ruleset) -> None:
    state = _state("pass", rules)
    in_presence = _add(state, 1, AtNode(3))  # neighbour of own node 1
    in_fog = _add(state, 1, AtNode(4))
    in_exact = _add(state, 1, AtNode(1))  # enemy group inside own node 1
    enemy_garrison = state.groups[3]  # ids by node_key: 0 -> 0, 1 -> 1, 6 -> 2, 5 -> 3
    assert enemy_garrison.location == AtNode(5)  # fog for player 0
    assert is_visible(state, 0, in_presence)
    assert is_visible(state, 0, in_exact)
    assert not is_visible(state, 0, in_fog)
    assert not is_visible(state, 0, enemy_garrison)


def test_enemy_groups_on_edges(rules: Ruleset) -> None:
    state = _state("pass", rules)
    on_adjacent = _add(state, 1, OnEdge(edge=1, from_node=3, progress=200))  # e1 touches node 1
    on_far = _add(state, 1, OnEdge(edge=4, from_node=5, progress=200))  # e4: 3 - 5
    assert is_visible(state, 0, on_adjacent)
    assert not is_visible(state, 0, on_far)
    # A cached Vision gives the same answers.
    cached = compute_vision(state, 0)
    assert is_visible(state, 0, on_adjacent, cached)
    assert not is_visible(state, 0, on_far, cached)


def test_own_entities_are_always_visible(rules: Ruleset) -> None:
    state = _state("pass", rules)
    far_group = _add(state, 0, OnEdge(edge=3, from_node=5, progress=10))  # e3: 5 - 6, fog
    pid = state.new_id()
    packet = Packet(pid, 0, edge=3, from_node=5, charges=1, depart_tick=0, arrive_tick=5)
    assert edge_detail_level(state, 0, 3) is F
    assert is_visible(state, 0, far_group)
    assert is_visible(state, 0, packet)


def test_enemy_packets_are_never_visible(rules: Ruleset) -> None:
    # TODO(#112): default of the question. e0 joins the two own nodes of player 0.
    state = _state("pass", rules)
    packet = Packet(state.new_id(), 1, edge=0, from_node=0, charges=2, depart_tick=0, arrive_tick=9)
    assert edge_detail_level(state, 0, 0) is P
    assert not is_visible(state, 0, packet)


def test_intents_are_public(rules: Ruleset) -> None:
    state = _state("pass", rules)
    far = Intent(state.new_id(), 1, IntentKind.PLANNED_MOVE, origin=6, target=5, created_tick=0)
    defense = Intent(state.new_id(), 1, IntentKind.DEFENSE, origin=6, target=None, created_tick=0)
    assert detail_level(state, 0, 6) is F
    assert is_visible(state, 0, far)
    assert is_visible(state, 0, defense)


# Fog memory ----------------------------------------------------------------------------------


def test_vision_records_sightings(rules: Ruleset) -> None:
    state = _state("pass", rules)
    state.tick = 40
    _add(state, 1, AtNode(3), Mode.DEFENSE)
    _add(state, 1, AtNode(3), Mode.ATTACK)
    _add(state, 1, AtNode(3), Mode.DEFENSE)
    _add(state, 1, OnEdge(edge=1, from_node=3, progress=100), Mode.DEFENSE)
    assert vision(state, rules) == []
    memory = state.vision_memory[0]
    # PRESENCE: enemy modes (distinct, sorted), no numbers.
    assert memory.nodes[3] == Sighting(40, P, (Mode.ATTACK, Mode.DEFENSE), None, None)
    # Edges also record their width (DEC-17); nodes have none.
    assert memory.edges[1] == Sighting(40, P, (Mode.DEFENSE,), None, None, width=1)
    assert memory.edges[0] == Sighting(40, P, (), None, None, width=1)
    # EXACT: own nodes, enemy totals are known (none here).
    assert memory.nodes[0] == Sighting(40, E, (), 0, 0)
    assert memory.nodes[1] == Sighting(40, E, (), 0, 0)
    # Fog is not recorded.
    assert sorted(memory.nodes) == [0, 1, 3]
    assert sorted(memory.edges) == [0, 1]


def test_exact_sighting_has_enemy_totals(rules: Ruleset) -> None:
    state = _state("pass", rules)
    state.tick = 7
    _add(state, 1, AtNode(1), Mode.ATTACK)  # 3 units, 2 charged
    _add(state, 1, AtNode(1), Mode.DEFENSE)
    vision(state, rules)
    assert state.vision_memory[0].nodes[1] == Sighting(7, E, (Mode.ATTACK, Mode.DEFENSE), 6, 4)


def test_memory_keeps_last_sighting_in_fog(rules: Ruleset) -> None:
    state = _state("pass", rules)
    state.tick = 10
    _add(state, 1, AtNode(3), Mode.DEFENSE)
    vision(state, rules)
    seen = state.vision_memory[0].nodes[3]
    assert seen == Sighting(10, P, (Mode.DEFENSE,), None, None)
    # Player 0 loses node 1 with its garrison: node 3 goes into fog. The enemy leaves node 3;
    # memory keeps the sighting of tick 10.
    state.nodes[1].owner = 1
    state.groups = {
        gid: g for gid, g in state.groups.items() if g.location not in (AtNode(1), AtNode(3))
    }
    state.tick = 20
    vision(state, rules)
    assert detail_level(state, 0, 3) is F
    assert state.vision_memory[0].nodes[3] == seen
    # Node 1 is now enemy-owned and a neighbour of own node 0: refreshed at presence level.
    assert state.vision_memory[0].nodes[1] == Sighting(20, P, (), None, None)


def test_memory_is_per_player(rules: Ruleset) -> None:
    state = _state("diamond", rules)
    state.tick = 5
    vision(state, rules)
    m0, m1 = state.vision_memory[0], state.vision_memory[1]
    assert sorted(m0.nodes) == [0, 1, 2]
    assert sorted(m1.nodes) == [1, 2, 3]
    assert sorted(m0.edges) == [0, 1]
    assert sorted(m1.edges) == [2, 3]
    # Each capital sees the other's garrison nowhere: both are in fog.
    assert 3 not in m0.nodes and 0 not in m1.nodes
