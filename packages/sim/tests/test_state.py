"""Game state (SIM-02): initial state, canonical roundtrip, stable hash, no floats.

Expected initial values come from the map files (packages/sim/tests/maps) and the SIM-01 table
of mvp-0 (cp.start = 300), not from the code.
"""

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, cast

import pytest
from hypothesis import given
from hypothesis import strategies as st

from gow_sim.canonical import canonical_json
from gow_sim.maps import MapDef, load_map, map_to_data, parse_map
from gow_sim.ruleset import Ruleset, Stance, load_ruleset
from gow_sim.state import (
    PROGRESS_SCALE,
    AtNode,
    Build,
    Detail,
    GameState,
    Group,
    Intent,
    IntentKind,
    Mode,
    OnEdge,
    Order,
    Packet,
    RoadKind,
    Sighting,
    StateFormatError,
    event,
    from_canonical,
    initial_state,
    state_hash,
    to_canonical,
)

TESTS_DIR = Path(__file__).resolve().parent
MAPS_DIR = TESTS_DIR / "maps"
TEST_MAPS = ["line3", "diamond", "pass"]
MVP0 = TESTS_DIR.parents[2] / "rulesets" / "mvp-0.toml"


@pytest.fixture(scope="module")
def rules() -> Ruleset:
    return load_ruleset(MVP0)


def _map(name: str) -> MapDef:
    return load_map(MAPS_DIR / f"{name}.json")


def _rich_state(rules: Ruleset) -> GameState:
    """diamond at tick 137 with every kind of entity, built by hand."""
    state = initial_state(_map("diamond"), rules)
    state.tick = 137
    state.players[0].cp = 250
    state.players[1].stance = Stance.WAR
    state.players[1].charge_acc = 50
    state.players[1].stance_changed_tick = 101
    state.players[0].vp = 12
    state.nodes[1].owner = 0
    state.nodes[1].warehouse = 3
    state.nodes[1].over_ticks = 7
    state.nodes[1].captured_tick = 120
    state.nodes[1].recruited_tick = 125
    state.edges[0].width = 2
    state.edges[0].kind = RoadKind.FREIGHT
    gid = state.new_id()
    state.groups[gid] = Group(gid, 0, 2, 1, Mode.DEFENSE, OnEdge(edge=1, from_node=0, progress=333))
    gid = state.new_id()
    state.groups[gid] = Group(gid, 1, 1, 0, Mode.ATTACK, AtNode(3))
    state.nodes[1].build = Build(edge=0, owner=0, since=130, kind=RoadKind.FREIGHT)
    gid = state.new_id()
    state.groups[gid] = Group(
        gid,
        1,
        2,
        2,
        Mode.ATTACK,
        AtNode(3),
        order=Order((1, 0), planned=True, depart_tick=150),
        intent=state.next_id + 1,
        bonus=2,
        bonus_tick=150,
    )
    state.players[1].forfeited = True
    pid = state.new_id()
    state.packets[pid] = Packet(
        pid, 0, edge=0, from_node=0, charges=2, depart_tick=130, arrive_tick=172
    )
    iid = state.new_id()
    state.intents[iid] = Intent(
        iid, 1, IntentKind.PLANNED_MOVE, origin=3, target=2, created_tick=120
    )
    iid = state.new_id()
    state.intents[iid] = Intent(iid, 0, IntentKind.DEFENSE, origin=1, target=None, created_tick=100)
    state.vision_memory[0].nodes[3] = Sighting(90, Detail.PRESENCE, (Mode.ATTACK,), None, None)
    state.vision_memory[1].nodes[0] = Sighting(12, Detail.EXACT, (Mode.ATTACK, Mode.DEFENSE), 4, 2)
    state.vision_memory[1].edges[2] = Sighting(
        40, Detail.PRESENCE, (), None, None, width=2, road=RoadKind.FAST
    )
    state.events.append(event(137, "packet_lost", edge=3, charges=1, owner=1, note=None))
    state.events.append(event(137, "captured", node=1, player=0, neutral=True))
    return state


@pytest.mark.parametrize("name", TEST_MAPS)
def test_initial_state_follows_map_and_ruleset(name: str, rules: Ruleset) -> None:
    raw = json.loads((MAPS_DIR / f"{name}.json").read_text(encoding="utf-8"))
    state = initial_state(_map(name), rules)
    assert state.tick == 0
    assert state.events == []
    assert sorted(state.players) == [0, 1]
    for player in state.players.values():
        assert player.cp == 300  # cp.start of mvp-0 (SIM-01)
        assert player.stance is Stance.BALANCE  # economy.start_stance, question #104
        assert (player.charge_acc, player.vp) == (0, 0)
    for node in raw["nodes"]:
        assert state.nodes[node["id"]].owner == node["start_owner"]
        assert state.nodes[node["id"]].warehouse == node["start_stock"]
    for edge in raw["edges"]:
        assert state.edges[edge["id"]].width == edge["base_width"]
    mirror = {int(k): v for k, v in raw["mirror"]["nodes"].items()}
    garrisons = sorted(
        (n for n in raw["nodes"] if n["start_units"] > 0),
        key=lambda n: (n["start_owner"], n["id"] if n["start_owner"] == 0 else mirror[n["id"]]),
    )
    assert len(state.groups) == len(garrisons)
    # One group per garrison, ids player by player in node_key order (mirror-symmetric id
    # tie-breaks, DEC-07 rule 7), in the normal mode «Атака» (DEC-08).
    for gid, node in enumerate(garrisons):
        group = state.groups[gid]
        assert group.location == AtNode(node["id"])
        assert (group.owner, group.units, group.charged) == (
            node["start_owner"],
            node["start_units"],
            node["start_charged"],
        )
        assert group.mode is Mode.ATTACK
    assert state.next_id == len(garrisons)
    assert state.packets == {} and state.intents == {}
    assert all(not m.nodes and not m.edges for m in state.vision_memory.values())


def test_line3_initial_garrisons(rules: Ruleset) -> None:
    # line3.json: capitals 0 and 2 with 3 units, all charged; neutral middle node is empty.
    state = initial_state(_map("line3"), rules)
    assert [(g.owner, g.units, g.charged, g.location) for g in state.groups.values()] == [
        (0, 3, 3, AtNode(0)),
        (1, 3, 3, AtNode(2)),
    ]
    assert [n.owner for n in state.nodes.values()] == [0, None, 1]


@pytest.mark.parametrize("name", TEST_MAPS)
def test_map_to_data_is_the_file_data(name: str) -> None:
    raw = json.loads((MAPS_DIR / f"{name}.json").read_text(encoding="utf-8"))
    mapdef = _map(name)
    assert map_to_data(mapdef) == raw
    assert parse_map(map_to_data(mapdef)) == mapdef


@pytest.mark.parametrize("name", TEST_MAPS)
def test_roundtrip_initial_state(name: str, rules: Ruleset) -> None:
    state = initial_state(_map(name), rules)
    assert from_canonical(to_canonical(state)) == state


def test_roundtrip_rich_state(rules: Ruleset) -> None:
    state = _rich_state(rules)
    restored = from_canonical(to_canonical(state))
    assert restored == state
    assert state_hash(restored) == state_hash(state)
    # The canonical form survives a trip through JSON text as well.
    assert from_canonical(json.loads(canonical_json(to_canonical(state)))) == state


def _walk(value: object) -> list[object]:
    """All leaf values of JSON-like data."""
    if isinstance(value, dict):
        items: list[object] = list(cast(dict[str, object], value).values())
    elif isinstance(value, list):
        items = cast(list[object], value)
    else:
        return [value]
    return [leaf for item in items for leaf in _walk(item)]


def test_canonical_has_no_float(rules: Ruleset) -> None:
    leaves = _walk(to_canonical(_rich_state(rules)))
    assert leaves
    assert not [v for v in leaves if isinstance(v, float)]
    assert all(v is None or isinstance(v, bool | int | str) for v in leaves)


def test_float_in_state_is_rejected_by_the_hash(rules: Ruleset) -> None:
    state = _rich_state(rules)
    state.players[0].cp = 2.5  # pyright: ignore[reportAttributeAccessIssue]
    with pytest.raises(TypeError, match="float"):
        state_hash(state)


def test_hash_does_not_depend_on_dict_insertion_order(rules: Ruleset) -> None:
    state = _rich_state(rules)
    expected = state_hash(state)
    state.groups = dict(reversed(state.groups.items()))
    state.nodes = dict(reversed(state.nodes.items()))
    state.vision_memory = dict(reversed(state.vision_memory.items()))
    state.vision_memory[1].nodes = dict(reversed(state.vision_memory[1].nodes.items()))
    assert state_hash(state) == expected


def test_hash_changes_with_the_state(rules: Ruleset) -> None:
    state = _rich_state(rules)
    before = state_hash(state)
    state.groups[0].charged -= 1
    assert state_hash(state) != before


_HASH_SCRIPT = """
import json, sys
from gow_sim.maps import load_map
from gow_sim.ruleset import load_ruleset
from gow_sim.state import from_canonical, initial_state, state_hash
initial = initial_state(load_map(sys.argv[1]), load_ruleset(sys.argv[2]))
with open(sys.argv[3], encoding="utf-8") as f:
    rich = from_canonical(json.load(f))
print(state_hash(initial), state_hash(rich))
"""


def test_state_hash_is_the_same_in_fresh_processes(rules: Ruleset, tmp_path: Path) -> None:
    rich = _rich_state(rules)
    dump = tmp_path / "rich.json"
    dump.write_bytes(canonical_json(to_canonical(rich)))
    expected = f"{state_hash(initial_state(_map('diamond'), rules))} {state_hash(rich)}"
    for seed in ("0", "1", "4242"):
        out = subprocess.run(
            [
                sys.executable,
                "-c",
                _HASH_SCRIPT,
                str(MAPS_DIR / "diamond.json"),
                str(MVP0),
                str(dump),
            ],
            env={**os.environ, "PYTHONHASHSEED": seed},
            capture_output=True,
            text=True,
            check=True,
        )
        assert out.stdout.strip() == expected


_DELETE = object()
_GROUP0: dict[str, Any] = {
    "id": 0,
    "owner": 0,
    "units": 3,
    "charged": 3,
    "mode": "attack",
    "location": {"kind": "node", "node": 0},
    "order": None,
    "intent": None,
    "bonus": 0,
    "bonus_tick": 0,
}


def _set(data: Any, path: tuple[str | int, ...], value: object) -> None:
    for key in path[:-1]:
        data = data[key]
    last = path[-1]
    if value is _DELETE:
        del data[last]
    elif isinstance(last, int) and last == len(data):
        data.append(value)
    else:
        data[last] = value


@pytest.mark.parametrize(
    ("path", "value", "message"),
    [
        (("extra",), 1, r"state: unknown keys \['extra'\]"),
        (("tick",), _DELETE, r"state: missing keys \['tick'\]"),
        (("tick",), 1.0, r"state\.tick: expected an integer"),
        (("groups", 0, "charged"), 5, r"groups\[0\]\.charged: 5 is out of range"),
        (("groups", 0, "mode"), "sleep", r"groups\[0\]\.mode: expected one of"),
        (("groups", 2), _GROUP0, r"groups\[2\]\.id: duplicate id 0"),
        (("nodes", 0, "build"), {"edge": 0}, r"nodes\[0\]\.build: missing keys"),
        (("groups", 0, "bonus"), -1, r"groups\[0\]\.bonus: -1 is out of range"),
        (("groups", 0, "intent"), "x", r"groups\[0\]\.intent: expected an integer"),
        (
            ("groups", 0, "location"),
            {"kind": "air"},
            r"groups\[0\]\.location\.kind: expected 'node' or 'edge'",
        ),
        (
            ("groups", 0, "location"),
            {"kind": "edge", "edge": 0, "from_node": 0, "progress": 1001, "back": False},
            r"location\.progress: 1001 is out of range",
        ),
        (
            ("groups", 0, "order"),
            {"path": [1], "planned": 1, "depart_tick": 0},
            r"groups\[0\]\.order\.planned: expected a boolean",
        ),
        (("players", 0, "forfeited"), None, r"players\[0\]\.forfeited: expected a boolean"),
        (("map", "nodes"), [], r"state\.map: nodes: the map has no nodes"),
        (
            ("events", 0),
            {"tick": 0, "kind": "x", "data": {"v": 0.5}},
            r"events\[0\]\.data\.v: unsupported value",
        ),
    ],
)
def test_from_canonical_rejects_bad_data(
    path: tuple[str | int, ...], value: object, message: str, rules: Ruleset
) -> None:
    data = json.loads(canonical_json(to_canonical(initial_state(_map("diamond"), rules))))
    assert data["groups"][0] == _GROUP0
    _set(data, path, value)
    with pytest.raises(StateFormatError, match=message):
        from_canonical(data)


# Hypothesis: random states on the test maps survive the roundtrip ---------------------------

_small = st.integers(min_value=0, max_value=50)
_opt_small = st.none() | _small
_road_kinds = st.sampled_from(list(RoadKind))


@st.composite
def _states(draw: st.DrawFn) -> GameState:
    rules = load_ruleset(MVP0)
    mapdef = _map(draw(st.sampled_from(TEST_MAPS)))
    state = initial_state(mapdef, rules)
    nodes = st.integers(min_value=0, max_value=len(mapdef.nodes) - 1)
    edges = st.integers(min_value=0, max_value=len(mapdef.edges) - 1)
    players = st.sampled_from([0, 1])
    modes = st.sampled_from(list(Mode))
    state.tick = draw(st.integers(min_value=0, max_value=7200))
    for player in state.players.values():
        player.cp = draw(st.integers(min_value=0, max_value=500))
        player.stance = draw(st.sampled_from(list(Stance)))
        player.charge_acc = draw(st.integers(min_value=0, max_value=99))
        player.vp = draw(st.integers(min_value=0, max_value=1000))
        player.forfeited = draw(st.booleans())
        player.stance_changed_tick = draw(st.none() | st.integers(min_value=0, max_value=7200))
    for edge in state.edges.values():
        edge.width = draw(st.integers(min_value=1, max_value=3))
        edge.kind = RoadKind.NONE if edge.width == 1 else draw(_road_kinds)
    for node in state.nodes.values():
        node.owner = draw(st.none() | players)
        node.warehouse = draw(_small)
        node.over_ticks = draw(_small)
        node.captured_tick = draw(_opt_small)
        node.recruited_tick = draw(_opt_small)
        if draw(st.booleans()):
            node.build = Build(draw(edges), draw(players), draw(_small), draw(_road_kinds))
    for _ in range(draw(st.integers(min_value=0, max_value=6))):
        gid = state.new_id()
        units = draw(st.integers(min_value=1, max_value=20))
        location: AtNode | OnEdge
        if draw(st.booleans()):
            location = AtNode(draw(nodes))
        else:
            edge = mapdef.edges[draw(edges)]
            location = OnEdge(
                edge=edge.id,
                from_node=draw(st.sampled_from([edge.a, edge.b])),
                progress=draw(st.integers(min_value=0, max_value=PROGRESS_SCALE)),
            )
        state.groups[gid] = Group(
            gid,
            draw(players),
            units,
            draw(st.integers(min_value=0, max_value=units)),
            draw(modes),
            location,
            order=draw(
                st.none()
                | st.builds(
                    Order,
                    st.lists(nodes, max_size=4).map(tuple),
                    st.booleans(),
                    st.integers(min_value=0, max_value=7200),
                )
            ),
        )
        if draw(st.booleans()):
            state.groups[gid].intent = draw(_small)
            state.groups[gid].bonus = draw(_small)
            state.groups[gid].bonus_tick = draw(st.integers(min_value=0, max_value=7200))
    for _ in range(draw(st.integers(min_value=0, max_value=3))):
        pid = state.new_id()
        edge = mapdef.edges[draw(edges)]
        state.packets[pid] = Packet(
            pid, draw(players), edge.id, edge.a, draw(_small), 0, draw(_small)
        )
    for _ in range(draw(st.integers(min_value=0, max_value=3))):
        iid = state.new_id()
        state.intents[iid] = Intent(
            iid,
            draw(players),
            draw(st.sampled_from(list(IntentKind))),
            draw(nodes),
            draw(st.none() | nodes),
            draw(_small),
        )
    for memory in state.vision_memory.values():
        for key in draw(st.lists(nodes, max_size=3, unique=True)):
            memory.nodes[key] = Sighting(
                draw(_small),
                draw(st.sampled_from([Detail.EXACT, Detail.PRESENCE])),
                tuple(sorted(draw(st.lists(modes, max_size=3, unique=True)))),
                draw(_opt_small),
                draw(_opt_small),
            )
        for key in draw(st.lists(edges, max_size=2, unique=True)):
            memory.edges[key] = Sighting(
                draw(_small),
                Detail.PRESENCE,
                (),
                None,
                None,
                width=draw(st.integers(1, 3)),
                road=draw(_road_kinds),
            )
    for _ in range(draw(st.integers(min_value=0, max_value=3))):
        state.events.append(
            event(
                state.tick,
                draw(st.sampled_from(["a", "b"])),
                n=draw(_small),
                s=draw(st.text(max_size=3)),
                f=draw(st.none() | st.booleans()),
            )
        )
    return state


@given(_states())
def test_roundtrip_random_states(state: GameState) -> None:
    data = to_canonical(state)
    assert from_canonical(data) == state
    assert not [v for v in _walk(data) if isinstance(v, float)]
    assert from_canonical(json.loads(canonical_json(data))) == state
