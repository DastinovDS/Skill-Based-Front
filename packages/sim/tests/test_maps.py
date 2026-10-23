"""Map loader (MAP-01): accepts the test maps, rejects malformed ones with a clear error."""

import copy
import json
from pathlib import Path
from typing import Any

import pytest

from gow_sim.maps import MapDef, MapFormatError, Terrain, load_map, parse_map

MAPS_DIR = Path(__file__).parent / "maps"
TEST_MAPS = ["line3", "diamond", "choke"]


def _raw(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((MAPS_DIR / f"{name}.json").read_text(encoding="utf-8"))
    return data


@pytest.mark.parametrize("name", TEST_MAPS)
def test_test_maps_load(name: str) -> None:
    mapdef = load_map(MAPS_DIR / f"{name}.json")
    assert mapdef.meta.name == name
    assert mapdef.meta.symmetry == "rot180"
    assert [n.id for n in mapdef.nodes] == list(range(len(mapdef.nodes)))
    # The two capitals are each other's mirror.
    assert mapdef.mirror_nodes[mapdef.capital(0)] == mapdef.capital(1)


def test_line3_values() -> None:
    mapdef = load_map(MAPS_DIR / "line3.json")
    assert len(mapdef.nodes) == 3
    assert len(mapdef.edges) == 2
    capital = mapdef.nodes[0]
    assert capital.capital_of == 0
    assert capital.start_owner == 0
    assert capital.terrain is Terrain.MOUNTAINS
    assert (capital.start_units, capital.start_charged, capital.start_stock) == (3, 3, 4)
    middle = mapdef.nodes[1]
    assert middle.start_owner is None
    assert middle.capital_of is None
    assert mapdef.mirror_nodes == (2, 1, 0)
    assert mapdef.mirror_edges == (1, 0)
    assert mapdef.incident == ((0,), (0, 1), (1,))
    assert mapdef.edges[1].other(2) == 1


def test_node_key_uses_mirror_for_player_1() -> None:
    mapdef = load_map(MAPS_DIR / "diamond.json")
    assert [mapdef.node_key(0, n) for n in range(4)] == [0, 1, 2, 3]
    assert [mapdef.node_key(1, n) for n in range(4)] == [3, 2, 1, 0]
    # The mirrored choice of player 1 has the same key as the original choice of player 0.
    for n in range(4):
        assert mapdef.node_key(1, mapdef.mirror_nodes[n]) == mapdef.node_key(0, n)


def test_mapdef_is_frozen() -> None:
    mapdef = load_map(MAPS_DIR / "line3.json")
    assert isinstance(mapdef, MapDef)
    with pytest.raises(AttributeError):
        mapdef.meta = mapdef.meta  # type: ignore[misc]


_DELETE = object()
"""Marks a key to remove instead of a value to set."""

Path_ = tuple[str | int, ...]

BROKEN: list[tuple[str, Path_, object, str]] = [
    # Broken references.
    ("edge to missing node", ("edges", 0, "b"), 7, "edges[0].b: 7 is out of range [0..2]"),
    ("self loop", ("edges", 0, "b"), 0, "edges[0]: an edge must join two different nodes"),
    ("mirror to missing node", ("mirror", "nodes", "1"), 5, "mirror.nodes[1]: 5 is out of range"),
    ("mirror key missing node", ("mirror", "nodes", "9"), 0, "mirror.nodes: key 9 does not exist"),
    ("mirror incomplete", ("mirror", "edges", "1"), _DELETE, "mirror.edges: no mirror for ids [1]"),
    ("mirror not involution", ("mirror", "nodes", "1"), 0, "mirror.nodes: not an involution"),
    ("mirror key not id", ("mirror", "nodes", "x"), 0, "mirror.nodes: key 'x' is not an id"),
    ("duplicate edge", ("edges", 1, "a"), 0, "edges[1]: duplicates edges[0] between nodes 0 and 1"),
    # Non-integer numbers.
    ("float vp", ("nodes", 1, "vp"), 1.5, "nodes[1].vp: expected an integer, got 1.5"),
    ("integral float", ("nodes", 1, "x"), 200.0, "nodes[1].x: expected an integer, got 200.0"),
    ("string", ("edges", 1, "travel_ticks"), "30", "edges[1].travel_ticks: expected an integer"),
    ("bool", ("nodes", 0, "start_units"), True, "nodes[0].start_units: expected an integer"),
    ("float mirror", ("mirror", "edges", "0"), 1.0, "mirror.edges[0]: expected an integer"),
    ("float version", ("meta", "version"), 1.0, "meta.version: expected an integer"),
    # Ranges.
    ("negative stock", ("nodes", 0, "start_stock"), -1, "nodes[0].start_stock: -1 is out of range"),
    (
        "charged > units",
        ("nodes", 0, "start_charged"),
        4,
        "start_charged: 4 is out of range [0..3]",
    ),
    # DEC-23, table of examples: rows 5, 6, 10, 12; and the old road fields (item 9).
    ("border 50", ("edges", 0, "border_permille"), 50, "edges[0].border_permille: 50 is out of"),
    ("border 901", ("edges", 0, "border_permille"), 901, "edges[0].border_permille: 901 is out"),
    ("no border", ("edges", 0, "border_permille"), _DELETE, "missing keys ['border_permille']"),
    ("base_capacity", ("nodes", 1, "base_capacity"), 4, "nodes[1]: unknown keys ['base_capacity']"),
    ("max_level 4", ("edges", 0, "max_level"), 4, "edges[0].max_level: 4 is out of range [1..3]"),
    ("max_level 0", ("edges", 0, "max_level"), 0, "edges[0].max_level: 0 is out of range [1..3]"),
    ("base_width", ("edges", 0, "base_width"), 1, "edges[0]: unknown keys ['base_width']"),
    ("max_width", ("edges", 0, "max_width"), 3, "edges[0]: unknown keys ['max_width']"),
    ("no name", ("nodes", 1, "name"), _DELETE, "nodes[1]: missing keys ['name']"),
    ("name not str", ("nodes", 1, "name"), 7, "nodes[1].name: expected a string, got 7"),
    ("unknown kind", ("nodes", 1, "kind"), "town", "nodes[1].kind: expected one of"),
    ("capital kind", ("nodes", 1, "kind"), "capital", "nodes[1].kind: 'capital' exactly for"),
    ("not capital kind", ("nodes", 0, "kind"), "city_large", "nodes[0].kind: 'capital' exactly"),
    # DEC-23, table of examples, row 1 (row 2 and 3: tests below).
    ("province vp", ("nodes", 1, "kind"), "province", "nodes[1]: a province has vp 0"),
    ("zero travel", ("edges", 0, "travel_ticks"), 0, "edges[0].travel_ticks: 0 is out of range"),
    ("outside map", ("nodes", 2, "x"), 401, "nodes[2].x: 401 is out of range [0..400]"),
    (
        "bad player",
        ("nodes", 1, "start_owner"),
        2,
        "nodes[1].start_owner: expected null or a player",
    ),
    ("bad terrain", ("nodes", 1, "terrain"), "swamp", "nodes[1].terrain: expected one of"),
    ("bad symmetry", ("meta", "symmetry"), "rot90", "meta.symmetry: expected one of ['rot180']"),
    ("bad name", ("meta", "name"), "", "meta.name: expected a non-empty"),
    ("id out of order", ("nodes", 1, "id"), 5, "nodes[1].id: node ids must be 0..N-1"),
    # Structure and invariants the simulation relies on.
    ("unknown key", ("nodes", 1, "vpp"), 1, "nodes[1]: unknown keys ['vpp']"),
    ("missing key", ("edges", 0, "max_level"), _DELETE, "edges[0]: missing keys ['max_level']"),
    (
        "second capital",
        ("nodes", 2, "capital_of"),
        0,
        "nodes[2].start_owner: the capital of player 0",
    ),
    ("capital not owned", ("nodes", 0, "start_owner"), None, "the capital of player 0 must start"),
    ("no capital", ("nodes", 2, "capital_of"), None, "nodes[2].kind: 'capital' exactly for"),
    (
        "neutral garrison",
        ("nodes", 1, "start_units"),
        1,
        "nodes[1]: a neutral node has no garrison",
    ),
    ("neutral stock", ("nodes", 1, "start_stock"), 1, "nodes[1]: a neutral node has no garrison"),
    ("nodes not a list", ("nodes",), {}, "nodes: expected a list, got dict"),
]


def _broken(path: Path_, value: object) -> dict[str, Any]:
    data = copy.deepcopy(_raw("line3"))
    target: Any = data
    for key in path[:-1]:
        target = target[key]
    if value is _DELETE:
        del target[path[-1]]
    else:
        target[path[-1]] = value
    return data


@pytest.mark.parametrize(("case", "path", "value", "message"), BROKEN, ids=[c[0] for c in BROKEN])
def test_broken_map_is_rejected(case: str, path: Path_, value: object, message: str) -> None:
    with pytest.raises(MapFormatError) as info:
        parse_map(_broken(path, value))
    assert message in str(info.value), case


def test_two_capitals_of_one_player_are_rejected() -> None:
    data = _broken(("nodes", 1, "capital_of"), 0)
    data["nodes"][1].update(start_owner=0, start_units=1, start_charged=1, kind="capital")
    with pytest.raises(
        MapFormatError, match=r"player 0 must have exactly one capital, found \[0, 1\]"
    ):
        parse_map(data)


def test_load_map_error_names_the_file(tmp_path: Path) -> None:
    path = tmp_path / "bad.json"
    data = _broken(("nodes", 1, "vp"), 0.5)
    path.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(MapFormatError, match=r"bad\.json: nodes\[1\]\.vp: expected an integer"):
        load_map(path)


def test_invalid_json_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / "bad.json"
    path.write_text("{", encoding="utf-8")
    with pytest.raises(MapFormatError, match="invalid JSON"):
        load_map(path)


def test_province_with_a_garrison_is_rejected() -> None:
    # DEC-23, table of examples, row 2: a province with start_units = 2.
    data = _broken(("nodes", 1, "kind"), "province")
    data["nodes"][1].update(vp=0, start_owner=0, start_units=2, start_charged=2)
    with pytest.raises(MapFormatError, match=r"nodes\[1\]: a province has vp 0 and no garrison"):
        parse_map(data)


def test_capital_kind_without_capital_of_is_rejected() -> None:
    # DEC-23, table of examples, row 3.
    data = _broken(("nodes", 1, "kind"), "capital")
    with pytest.raises(MapFormatError, match=r"nodes\[1\]\.kind: 'capital' exactly"):
        parse_map(data)


def test_names_and_border_points_are_read() -> None:
    # DEC-23, items 4 and 5; the example fragment of the DEC-23 block.
    data = _raw("line3")
    data["nodes"][1].update(kind="province", vp=0, name="Брод", start_owner=0)
    data["edges"][0]["border_permille"] = 400
    mapdef = parse_map(data)
    assert mapdef.nodes[1].name == "Брод"
    assert (mapdef.edges[0].border_permille, mapdef.edges[1].border_permille) == (400, 500)
    assert (mapdef.edges[0].max_level, mapdef.edges[0].travel_ticks) == (3, 30)
