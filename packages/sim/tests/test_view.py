"""Projection (SIM-14): PlayerView by DEC-04, opaque ids, resolve(), determinism.

Every rule of DEC-04 (mechanics.md, section 10) has its own test below, plus the list of what a
view must not contain (AGENTS.md, section 4.4) and the #112 default. Expected detail levels are
worked out by hand from DEC-04 and the map file:

- line6: 0 (capital of 0) -e0- 1 -e1- 2 -e2- 3 -e3- 4 -e4- 5 (capital of 1); player 0 owns 0 and
  1, player 1 owns 4 and 5, nodes 2 and 3 are neutral; widths 1, ``max_width`` 5.
  Player 0 at the start: nodes 0, 1 exact, 2 presence, 3..5 fog; edges e0, e1 presence, e2..e4 fog.
"""

import dataclasses
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest
from hypothesis import given
from hypothesis import strategies as st

from gow_sim.commands import (
    Merge,
    Move,
    Recruit,
    Reject,
    RejectCode,
    SetMode,
    Split,
    validate,
)
from gow_sim.maps import load_map
from gow_sim.ruleset import Ruleset, Stance, load_ruleset
from gow_sim.state import (
    PROGRESS_SCALE,
    AtNode,
    Detail,
    Event,
    GameState,
    Group,
    Intent,
    IntentKind,
    Mode,
    OnEdge,
    Order,
    Packet,
    initial_state,
    state_hash,
)
from gow_sim.systems.capacity import city_capacity
from gow_sim.systems.vision import vision
from gow_sim.view import (
    EdgeView,
    GroupView,
    IntentView,
    NodeView,
    PlayerView,
    SelfView,
    opaque_id,
    project,
    resolve,
)

TESTS_DIR = Path(__file__).resolve().parent
MVP0 = TESTS_DIR.parents[2] / "rulesets" / "mvp-0.toml"
TEST_MAPS = ("line3", "diamond", "pass", "line6", "fork", "siege")
KEY = bytes(range(32))
OTHER_KEY = bytes(range(1, 33))
WIRE_ID = re.compile(r"[A-Za-z0-9_-]{1,32}")

E, P, F = Detail.EXACT, Detail.PRESENCE, Detail.FOG


@pytest.fixture(scope="module")
def rules() -> Ruleset:
    return load_ruleset(MVP0)


def _state(name: str, rules: Ruleset) -> GameState:
    return initial_state(load_map(TESTS_DIR / "maps" / f"{name}.json"), rules)


def _add(
    state: GameState,
    owner: int,
    location: AtNode | OnEdge,
    units: int = 3,
    charged: int = 2,
    mode: Mode = Mode.ATTACK,
) -> Group:
    gid = state.new_id()
    group = Group(gid, owner, units=units, charged=charged, mode=mode, location=location)
    state.groups[gid] = group
    return group


def _view(state: GameState, rules: Ruleset, player: int = 0) -> PlayerView:
    return project(state, rules, player, KEY)


# DEC-04, rule by rule -------------------------------------------------------------------------


def test_dec04_geography_and_road_widths_are_public(rules: Ruleset) -> None:
    state = _state("line6", rules)
    state.edges[3].width = 4  # e3 is in fog for player 0
    view = _view(state, rules)
    assert [e.id for e in view.edges] == [0, 1, 2, 3, 4]
    assert [e.width for e in view.edges] == [1, 1, 1, 4, 1]
    assert [e.detail for e in view.edges] == [P, P, F, F, F]


def test_dec04_ownership_and_capacity_of_all_nodes_are_public(rules: Ruleset) -> None:
    state = _state("line6", rules)
    view = _view(state, rules)
    assert [n.id for n in view.nodes] == [0, 1, 2, 3, 4, 5]
    assert [n.detail for n in view.nodes] == [E, E, P, F, F, F]
    assert [n.owner for n in view.nodes] == [0, 0, None, None, 1, 1]
    assert [n.capacity for n in view.nodes] == [city_capacity(state, rules, n) for n in range(6)]


def test_dec04_vp_of_both_players_are_public(rules: Ruleset) -> None:
    state = _state("line6", rules)
    state.players[0].vp = 7
    state.players[1].vp = 11
    assert _view(state, rules, 0).vp == (7, 11)
    assert _view(state, rules, 1).vp == (7, 11)


def test_dec04_intents_are_public_without_group_id_or_size(rules: Ruleset) -> None:
    state = _state("line6", rules)
    enemy = _add(state, 1, AtNode(5), units=9, charged=9)
    iid = state.new_id()
    state.intents[iid] = Intent(iid, 1, IntentKind.PLANNED_MOVE, 5, 3, created_tick=0)
    enemy.intent = iid
    bid = state.new_id()
    state.intents[bid] = Intent(bid, 1, IntentKind.BUILD, 4, 5, created_tick=0)
    view = _view(state, rules)  # nodes 3..5 are in fog for player 0
    assert sorted((i.origin, i.owner, i.kind, i.target) for i in view.intents) == [
        (4, 1, IntentKind.BUILD, 5),
        (5, 1, IntentKind.PLANNED_MOVE, 3),
    ]
    fields = {f.name for f in dataclasses.fields(IntentView)}
    assert fields == {"id", "owner", "kind", "origin", "target", "created_tick"}
    assert all(i.id not in (enemy.id, iid, bid) for i in view.intents)


def test_dec04_exact_in_own_nodes_and_nodes_with_own_groups(rules: Ruleset) -> None:
    state = _state("line6", rules)
    state.nodes[1].warehouse = 5
    state.nodes[3].warehouse = 6
    _add(state, 1, AtNode(1), units=4, charged=1)
    _add(state, 1, AtNode(1), units=2, charged=2, mode=Mode.DEFENSE)
    _add(state, 0, AtNode(3), units=1, charged=1)  # own group makes neutral node 3 exact
    _add(state, 1, AtNode(3), units=7, charged=3)
    view = _view(state, rules)
    one, three = view.nodes[1], view.nodes[3]
    assert (one.detail, one.warehouse, three.detail, three.warehouse) == (E, 5, E, 6)
    assert one.seen is not None and three.seen is not None
    assert (one.seen.enemy_units, one.seen.enemy_charged) == (6, 3)
    assert one.seen.enemy_modes == (Mode.ATTACK, Mode.DEFENSE)
    assert (three.seen.enemy_units, three.seen.enemy_charged) == (7, 3)


def test_dec04_presence_in_neighbour_nodes_and_edges_without_numbers(rules: Ruleset) -> None:
    state = _state("line6", rules)
    state.nodes[2].warehouse = 9
    _add(state, 1, AtNode(2), units=8, charged=8, mode=Mode.DEFENSE)
    _add(state, 1, OnEdge(edge=1, from_node=2, progress=300), units=5, charged=5)
    view = _view(state, rules)
    node, edge = view.nodes[2], view.edges[1]
    assert (node.detail, node.warehouse, edge.detail) == (P, None, P)
    assert node.seen is not None and edge.seen is not None
    assert node.seen.level is P and node.seen.enemy_modes == (Mode.DEFENSE,)
    assert (node.seen.enemy_units, node.seen.enemy_charged) == (None, None)
    assert edge.seen.enemy_modes == (Mode.ATTACK,)
    assert (edge.seen.enemy_units, edge.seen.enemy_charged) == (None, None)
    assert view.groups == ()  # enemy groups are never entities of the view


def test_dec04_target_of_an_enemy_normal_order_is_not_shown(rules: Ruleset) -> None:
    state = _state("line6", rules)
    enemy = _add(state, 1, AtNode(2))  # presence for player 0
    before = _view(state, rules)
    enemy.order = Order(path=(1, 0), planned=False, depart_tick=0)
    after = _view(state, rules)
    assert after == before
    assert after.intents == ()


def test_dec04_fog_keeps_the_last_sighting(rules: Ruleset) -> None:
    state = _state("line6", rules)
    scout = _add(state, 0, AtNode(3))
    enemy = _add(state, 1, AtNode(4), units=6, charged=4)
    state.tick = 5
    vision(state, rules)  # player 0 sees node 4 as presence at tick 5
    scout.location = AtNode(1)
    enemy.units, enemy.mode = 20, Mode.DEFENSE
    state.tick = 9
    view = _view(state, rules)
    four, five = view.nodes[4], view.nodes[5]
    assert four.detail is F and four.warehouse is None
    assert four.seen is not None
    assert (four.seen.tick, four.seen.level, four.seen.enemy_modes) == (5, P, (Mode.ATTACK,))
    assert four.seen.enemy_units is None
    assert five.detail is F and five.seen is None  # never seen


def test_dec04_vision_does_not_depend_on_group_size(rules: Ruleset) -> None:
    small, big = _state("line6", rules), _state("line6", rules)
    _add(small, 0, AtNode(2), units=1, charged=1)
    _add(big, 0, AtNode(2), units=50, charged=50)
    for state in (small, big):
        assert [n.detail for n in _view(state, rules).nodes] == [E, E, E, P, F, F]


# #112 default ---------------------------------------------------------------------------------


def test_own_group_on_an_edge_gives_no_vision(rules: Ruleset) -> None:
    state = _state("line6", rules)
    _add(state, 0, OnEdge(edge=2, from_node=2, progress=900))
    view = _view(state, rules)
    assert [n.detail for n in view.nodes] == [E, E, P, F, F, F]
    assert [e.detail for e in view.edges] == [P, P, F, F, F]


def test_enemy_packets_are_never_visible(rules: Ruleset) -> None:
    state = _state("line6", rules)
    state.nodes[2].owner = 1
    state.nodes[3].owner = 1  # e2 is an internal edge of player 1
    _add(state, 0, AtNode(2))  # an own group in node 2 puts e2 in presence
    pid = state.new_id()
    state.packets[pid] = Packet(pid, 1, 2, from_node=3, charges=4, depart_tick=0, arrive_tick=9)
    view = _view(state, rules)
    assert view.edges[2].detail is P
    assert view.packets == ()


# What a view never has (AGENTS.md, section 4.4) ----------------------------------------------


def test_no_enemy_cp_stance_production_or_counters(rules: Ruleset) -> None:
    state = _state("line6", rules)
    before = _view(state, rules)
    enemy = state.players[1]
    enemy.cp, enemy.stance, enemy.charge_acc, enemy.stance_changed_tick = 999, Stance.WAR, 77, 3
    state.nodes[5].warehouse = 42  # enemy capital production piles up in fog
    state.nodes[5].recruited_tick = 1
    assert _view(state, rules) == before
    assert {f.name for f in dataclasses.fields(SelfView)} == {"cp", "stance"}
    assert before.me == SelfView(cp=state.players[0].cp, stance=state.players[0].stance)


def test_no_events_in_the_view(rules: Ruleset) -> None:
    state = _state("line6", rules)
    before = _view(state, rules)
    state.events.append(Event(tick=0, kind="fight", data=(("node", 5),)))
    assert _view(state, rules) == before
    assert "events" not in {f.name for f in dataclasses.fields(PlayerView)}


def test_own_entities_are_exact(rules: Ruleset) -> None:
    state = _state("line6", rules)
    g = _add(state, 0, AtNode(1), units=5, charged=3, mode=Mode.BUILD)
    g.build_edge, g.build_since = 0, 0
    w = _add(state, 0, AtNode(0), units=2, charged=1)
    w.order = Order(path=(1, 2), planned=True, depart_tick=30)
    m = _add(state, 0, OnEdge(edge=1, from_node=1, progress=250, back=True), units=1, charged=0)
    pid = state.new_id()
    state.packets[pid] = Packet(pid, 0, 0, from_node=0, charges=2, depart_tick=1, arrive_tick=8)
    view = _view(state, rules)
    by_id = {v.id: v for v in view.groups}
    assert by_id[opaque_id(KEY, 0, g.id)] == GroupView(
        opaque_id(KEY, 0, g.id), 5, 3, Mode.BUILD, AtNode(1), None, build_edge=0
    )
    order = by_id[opaque_id(KEY, 0, w.id)].order
    assert order is not None and (order.dest, order.path, order.planned) == (2, (1, 2), True)
    assert order.depart_tick == 30
    assert by_id[opaque_id(KEY, 0, m.id)].location == m.location
    [packet] = view.packets
    assert (packet.id, packet.edge, packet.charges, packet.arrive_tick) == (
        opaque_id(KEY, 0, pid),
        0,
        2,
        8,
    )


def test_upgrade_gain_only_on_own_internal_edges(rules: Ruleset) -> None:
    state = _state("line6", rules)
    state.edges[0].width = 2
    view0, view1 = _view(state, rules, 0), _view(state, rules, 1)
    gains, speeds = rules.capacity.width_gain_centi, rules.supply.packet_speed_pct
    gain = view0.edges[0].upgrade_gain
    assert gain is not None
    assert gain.capacity_centi == gains.of(3) - gains.of(2)
    assert gain.packet_speed_pct == speeds.of(3) - speeds.of(2)
    assert [e.upgrade_gain is not None for e in view0.edges] == [True, False, False, False, False]
    assert [e.upgrade_gain is not None for e in view1.edges] == [False, False, False, False, True]
    state.edges[0].width = state.map.edges[0].max_width
    assert _view(state, rules, 0).edges[0].upgrade_gain is None


# Opaque ids and resolve() ---------------------------------------------------------------------


def test_opaque_ids_are_keyed_per_player_and_fit_the_wire(rules: Ruleset) -> None:
    ids = [opaque_id(KEY, 0, i) for i in range(100)]
    assert len(set(ids)) == 100
    assert ids != sorted(ids)  # not sequential
    assert all(0 <= i < 2**63 and WIRE_ID.fullmatch(str(i)) for i in ids)
    assert opaque_id(KEY, 0, 5) != opaque_id(KEY, 1, 5)
    assert opaque_id(KEY, 0, 5) != opaque_id(OTHER_KEY, 0, 5)
    assert opaque_id(KEY, 0, 5) == opaque_id(KEY, 0, 5)


@pytest.mark.parametrize("key", [b"", b"short", bytes(65)])
def test_match_key_must_be_a_real_secret(rules: Ruleset, key: bytes) -> None:
    state = _state("line3", rules)
    with pytest.raises(ValueError, match="match_key"):
        project(state, rules, 0, key)
    with pytest.raises(ValueError, match="match_key"):
        opaque_id(key, 0, 1)


def test_resolve_maps_own_opaque_ids_to_internal_ids(rules: Ruleset) -> None:
    state = _state("line3", rules)
    a = _add(state, 0, AtNode(0))
    b = _add(state, 0, AtNode(0))
    oa, ob = opaque_id(KEY, 0, a.id), opaque_id(KEY, 0, b.id)
    assert resolve(state, 0, Move(oa, 1, True), KEY) == Move(a.id, 1, True)
    assert resolve(state, 0, Merge((ob, oa)), KEY) == Merge((b.id, a.id))
    assert resolve(state, 0, Recruit(0), KEY) == Recruit(0)
    view_ids = {v.id for v in _view(state, rules).groups}
    assert {oa, ob} <= view_ids


def test_resolve_unknown_ids_are_not_found_or_hidden(rules: Ruleset) -> None:
    state = _state("line3", rules)
    own = _add(state, 0, AtNode(0))
    enemy = _add(state, 1, AtNode(1))  # visible to player 0 (presence)
    guesses = [
        own.id,  # an internal id is not an opaque id
        enemy.id,
        opaque_id(KEY, 1, enemy.id),  # the enemy's own opaque id
        opaque_id(OTHER_KEY, 0, own.id),
        12345,
    ]
    for guess in guesses:
        for cmd in (Move(guess, 1), Split(guess, 1), SetMode(guess, Mode.DEFENSE)):
            resolved = resolve(state, 0, cmd, KEY)
            assert validate(state, rules, 0, resolved) == Reject(RejectCode.NOT_FOUND_OR_HIDDEN)
    merge = resolve(state, 0, Merge((opaque_id(KEY, 0, own.id), 1, 2)), KEY)
    assert validate(state, rules, 0, merge) == Reject(RejectCode.NOT_FOUND_OR_HIDDEN)
    repeated = resolve(state, 0, Merge((7, 7)), KEY)
    assert validate(state, rules, 0, repeated) == Reject(RejectCode.INVALID_ARGUMENT)


# Purity and determinism -----------------------------------------------------------------------


def test_project_does_not_change_the_state(rules: Ruleset) -> None:
    state = _state("diamond", rules)
    _add(state, 1, AtNode(1))
    before = state_hash(state)
    _view(state, rules, 0)
    _view(state, rules, 1)
    assert state_hash(state) == before


_HASH_SCRIPT = """
from pathlib import Path
from gow_sim.maps import load_map
from gow_sim.ruleset import load_ruleset
from gow_sim.state import AtNode, Group, Mode, initial_state
from gow_sim.systems.vision import vision
from gow_sim.view import project, view_hash
tests = Path({tests!r})
rules = load_ruleset(tests.parents[2] / "rulesets" / "mvp-0.toml")
state = initial_state(load_map(tests / "maps" / "diamond.json"), rules)
gid = state.new_id()
state.groups[gid] = Group(gid, 1, 4, 2, Mode.DEFENSE, AtNode(1))
vision(state, rules)
print(*(view_hash(project(state, rules, p, bytes(range(32)))) for p in (0, 1)))
"""


def test_view_hash_is_the_same_in_fresh_processes() -> None:
    script = _HASH_SCRIPT.format(tests=str(TESTS_DIR))
    outputs = {
        subprocess.run(
            [sys.executable, "-c", script],
            env={**os.environ, "PYTHONHASHSEED": seed},
            capture_output=True,
            text=True,
            check=True,
        ).stdout
        for seed in ("0", "12345")
    }
    assert len(outputs) == 1
    assert len(outputs.pop().split()) == 2


# Property: nothing from places the player does not see ----------------------------------------


def _levels(state: GameState, player: int) -> tuple[list[Detail], list[Detail]]:
    """DEC-04 levels computed independently of ``systems.vision``."""
    mapdef = state.map
    exact = [state.nodes[n].owner == player for n in range(len(mapdef.nodes))]
    for g in state.groups.values():
        if g.owner == player and isinstance(g.location, AtNode):
            exact[g.location.node] = True
    near = [
        exact[n] or any(exact[mapdef.edges[e].other(n)] for e in mapdef.incident[n])
        for n in range(len(mapdef.nodes))
    ]
    nodes = [E if exact[n] else P if near[n] else F for n in range(len(mapdef.nodes))]
    edges = [P if exact[e.a] or exact[e.b] else F for e in mapdef.edges]
    return nodes, edges


_MAPS = {name: load_map(TESTS_DIR / "maps" / f"{name}.json") for name in TEST_MAPS}
_RULES = load_ruleset(MVP0)


def _location(draw: st.DrawFn, state: GameState) -> AtNode | OnEdge:
    mapdef = state.map
    if draw(st.booleans()):
        return AtNode(draw(st.integers(0, len(mapdef.nodes) - 1)))
    edge = mapdef.edges[draw(st.integers(0, len(mapdef.edges) - 1))]
    return OnEdge(
        edge=edge.id,
        from_node=draw(st.sampled_from([edge.a, edge.b])),
        progress=draw(st.integers(0, PROGRESS_SCALE)),
        back=draw(st.booleans()),
    )


def _random_group(draw: st.DrawFn, state: GameState, owner: int) -> None:
    units = draw(st.integers(1, 20))
    g = _add(
        state,
        owner,
        _location(draw, state),
        units=units,
        charged=draw(st.integers(0, units)),
        mode=draw(st.sampled_from(list(Mode))),
    )
    if draw(st.booleans()):
        path = draw(st.lists(st.integers(0, len(state.map.nodes) - 1), min_size=1, max_size=3))
        g.order = Order(tuple(path), draw(st.booleans()), draw(st.integers(0, 50)))


@st.composite
def _states(draw: st.DrawFn) -> tuple[GameState, int]:
    """A random state on a scenario map, with fog memory from a few earlier ticks."""
    state = initial_state(_MAPS[draw(st.sampled_from(TEST_MAPS))], _RULES)
    for node in state.nodes.values():
        node.owner = draw(st.sampled_from([None, 0, 1]))
        node.warehouse = draw(st.integers(0, 30))
    for edge in state.edges.values():
        edge.width = draw(st.integers(1, state.map.edges[edge.id].max_width))
    for _ in range(draw(st.integers(0, 3))):  # earlier ticks leave fog memory
        state.groups = {}
        for _ in range(draw(st.integers(0, 6))):
            _random_group(draw, state, draw(st.sampled_from([0, 1])))
        vision(state, _RULES)
        state.tick += draw(st.integers(1, 20))
    state.groups = {}
    for _ in range(draw(st.integers(0, 8))):
        _random_group(draw, state, draw(st.sampled_from([0, 1])))
    for _ in range(draw(st.integers(0, 4))):
        edge = state.map.edges[draw(st.integers(0, len(state.map.edges) - 1))]
        pid = state.new_id()
        state.packets[pid] = Packet(
            pid, draw(st.sampled_from([0, 1])), edge.id, edge.a, draw(st.integers(1, 5)), 0, 5
        )
    for _ in range(draw(st.integers(0, 3))):
        iid = state.new_id()
        kind = draw(st.sampled_from(list(IntentKind)))
        target = None if kind is IntentKind.DEFENSE else 1
        state.intents[iid] = Intent(iid, draw(st.sampled_from([0, 1])), kind, 0, target, 0)
    return state, draw(st.sampled_from([0, 1]))


def _hide(data: st.DataObject, state: GameState, player: int) -> None:
    """Change only what ``player`` must not know; the view must stay the same."""
    draw = data.draw
    nodes, edges = _levels(state, player)
    enemy = 1 - player
    for gid in sorted(state.groups):
        g = state.groups[gid]
        if g.owner != enemy:
            continue
        match g.location:
            case AtNode(node=node):
                level = nodes[node]
            case OnEdge(edge=edge):
                level = edges[edge]
        if level is F and draw(st.booleans()):
            del state.groups[gid]  # a group in fog may vanish
        elif level is not E:  # presence and fog: sizes and orders are hidden
            g.units = g.units + draw(st.integers(0, 5))
            g.charged = draw(st.integers(0, g.units))
            g.order = None
    for _ in range(draw(st.integers(0, 3))):  # new enemy groups deep in fog
        fogged = [n for n, level in enumerate(nodes) if level is F]
        if fogged:
            _add(state, enemy, AtNode(draw(st.sampled_from(fogged))), draw(st.integers(1, 9)), 0)
    for n, level in enumerate(nodes):
        if level is not E:
            state.nodes[n].warehouse = draw(st.integers(0, 30))
    for pid in sorted(state.packets):
        if state.packets[pid].owner == enemy:
            state.packets[pid].charges = draw(st.integers(1, 9))
    other = state.players[enemy]
    other.cp = draw(st.integers(0, 10_000))
    other.stance = draw(st.sampled_from(list(Stance)))
    other.charge_acc = draw(st.integers(0, 99))
    state.events = [Event(state.tick, "fight", (("node", 0),))]


@given(data=st.data())
def test_property_nothing_leaks_from_places_out_of_sight(data: st.DataObject) -> None:
    state, player = data.draw(_states())
    view = project(state, _RULES, player, KEY)
    nodes, edges = _levels(state, player)

    assert [n.detail for n in view.nodes] == nodes
    assert [e.detail for e in view.edges] == edges
    own = [g for g in state.groups.values() if g.owner == player]
    assert sorted(g.id for g in view.groups) == sorted(opaque_id(KEY, player, g.id) for g in own)
    own_packets = [p.id for p in state.packets.values() if p.owner == player]
    assert sorted(p.id for p in view.packets) == sorted(
        opaque_id(KEY, player, pid) for pid in own_packets
    )
    memory = state.vision_memory[player]
    for n in view.nodes:
        _check_place(n, memory.nodes.get(n.id))
    for e in view.edges:
        _check_place(e, memory.edges.get(e.id))

    _hide(data, state, player)
    assert project(state, _RULES, player, KEY) == view


def _check_place(place: NodeView | EdgeView, memory: object) -> None:
    if place.detail is F:
        assert place.seen == memory
        if isinstance(place, NodeView):
            assert place.warehouse is None
        return
    assert place.seen is not None and place.seen.level is place.detail
    if place.detail is P:
        assert (place.seen.enemy_units, place.seen.enemy_charged) == (None, None)
