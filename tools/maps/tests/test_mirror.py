"""Mirroring script (MAP-03): any valid half gives a map that passes the symmetry check."""

import copy
import json
from pathlib import Path
from typing import Any

import pytest
from hypothesis import given
from hypothesis import strategies as st

from gow_maps.cli import main
from gow_maps.mirror import HalfFormatError, dump_map, mirror_half
from gow_maps.validate import check_border, check_symmetry, load_config, validate
from gow_sim.maps import parse_map

HALVES = Path(__file__).parent / "halves"
TEST_MAPS = Path(__file__).parents[3] / "packages/sim/tests/maps"
CONFIG = load_config()


def _json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.mark.parametrize("name", ["line3", "pass"])
def test_half_reproduces_hand_made_test_map(name: str) -> None:
    # The MAP-01 test maps were written by hand with the same id scheme.
    full = mirror_half(_json(HALVES / f"{name}.half.json"), CONFIG)
    assert full == _json(TEST_MAPS / f"{name}.json")


def test_cross_edges_join_a_node_with_the_mirror() -> None:
    full = mirror_half(_json(HALVES / "diamond.half.json"), CONFIG)
    mapdef = parse_map(full)
    # capital 0, north 1, south (mirror of north) 2, capital of player 1 is 3.
    assert [(e.a, e.b) for e in mapdef.edges] == [(0, 1), (3, 2), (0, 2), (1, 3)]
    assert mapdef.mirror_edges == (1, 0, 3, 2)
    assert mapdef.mirror_nodes == (3, 2, 1, 0)
    assert validate(mapdef, CONFIG) == []


def test_self_mirrored_cross_edge() -> None:
    half = _json(HALVES / "line3.half.json")
    # Drop the centre node: the road now goes straight from capital to capital.
    half["nodes"].pop()
    half["edges"] = []
    half["cross_edges"] = [{"a": "capital", "b": "capital", "max_level": 1}]
    mapdef = parse_map(mirror_half(half, CONFIG))
    assert [(e.a, e.b, e.travel_ticks) for e in mapdef.edges] == [(0, 1, 60)]
    assert mapdef.mirror_edges == (0,)
    assert check_symmetry(mapdef) == []


def test_names_of_the_half_and_the_copy() -> None:
    # DEC-23, item 8: the half node has name and mirror_name, the centre node only name.
    mapdef = parse_map(mirror_half(_json(HALVES / "pass.half.json"), CONFIG))
    half = _json(HALVES / "pass.half.json")["nodes"]
    names = [n.name for n in mapdef.nodes]
    assert names[:3] == [n["name"] for n in half[:3]]
    assert names[4:] == [n["mirror_name"] for n in reversed(half[:3])]
    assert names[3] == half[3]["name"]  # the centre (pass)


def test_border_of_the_copies() -> None:
    # DEC-23, item 8: a plain copy keeps border_permille, a cross copy gets 1000 - border.
    half = _json(HALVES / "diamond.half.json")
    half["edges"][0]["border_permille"] = 300
    half["cross_edges"][0]["border_permille"] = 700
    mapdef = parse_map(mirror_half(half, CONFIG))
    # e0 capital -> north, e1 its copy from the mirror of capital; e2 capital -> mirror of north,
    # e3 its copy north -> mirror of capital (from the mirror of the far end of e2).
    assert [(e.a, e.b, e.border_permille) for e in mapdef.edges] == [
        (0, 1, 300),
        (3, 2, 300),
        (0, 2, 700),
        (1, 3, 300),
    ]
    assert check_border(mapdef) == []


def test_border_is_500_without_the_field() -> None:
    mapdef = parse_map(mirror_half(_json(HALVES / "diamond.half.json"), CONFIG))
    assert {e.border_permille for e in mapdef.edges} == {500}


def test_self_mirrored_road_needs_500() -> None:
    # DEC-23, item 8: a cross_edge with a == b requires 500.
    half = _json(HALVES / "line3.half.json")
    half["nodes"].pop()
    half["edges"] = []
    half["cross_edges"] = [{"a": "capital", "b": "capital", "max_level": 1, "border_permille": 400}]
    with pytest.raises(HalfFormatError, match="a self-mirrored road needs border_permille 500"):
        mirror_half(half, CONFIG)
    half["cross_edges"][0]["border_permille"] = 500
    assert parse_map(mirror_half(half, CONFIG)).edges[0].border_permille == 500


def test_free_position_of_the_copy() -> None:
    # DEC-27, item 6: mirror_x and mirror_y place the copy anywhere; the graph stays mirrored.
    half = _json(HALVES / "diamond.half.json")
    half["nodes"][1] |= {"mirror_x": 190, "mirror_y": 310}
    full = mirror_half(half, CONFIG)
    mapdef = parse_map(full)
    assert (mapdef.nodes[2].x, mapdef.nodes[2].y) == (190, 310)
    assert (mapdef.nodes[1].x, mapdef.nodes[1].y) == (200, 100)
    assert (mapdef.nodes[3].x, mapdef.nodes[3].y) == (300, 200)  # default: (w - x, h - y)
    assert validate(mapdef, CONFIG) == []


def test_missing_travel_ticks_from_the_mean_length() -> None:
    # Copies of different drawn length share one travel_ticks: from the mean of both lengths.
    half = _json(HALVES / "line3.half.json")
    half["nodes"][1] |= {"self_mirror": True, "x": 210}
    assert "travel_ticks" not in half["edges"][0]
    half["nodes"][0] |= {"mirror_x": 300, "mirror_y": 100}
    mapdef = parse_map(mirror_half(half, CONFIG))
    # Lengths 110 (capital -> middle) and 90 (mirror -> middle): mean 100, 30 ticks.
    assert [e.travel_ticks for e in mapdef.edges] == [30, 30]
    assert check_symmetry(mapdef) == []


def test_self_mirror_flag() -> None:
    # DEC-27, item 6: a self-mirrored node anywhere, not only at the exact centre.
    half = _json(HALVES / "pass.half.json")
    half["nodes"][3] |= {"self_mirror": True, "x": 320, "y": 190}  # the pass, off the centre
    mapdef = parse_map(mirror_half(half, CONFIG))
    assert len(mapdef.nodes) == 7
    assert mapdef.mirror_nodes[3] == 3
    assert (mapdef.nodes[3].x, mapdef.nodes[3].y) == (320, 190)
    assert check_symmetry(mapdef) == [] and check_border(mapdef) == []


def test_road_between_two_self_mirrored_nodes_is_written_once() -> None:
    half = _json(HALVES / "pass.half.json")
    second = {**half["nodes"][3], "id": "ridge", "name": "ridge", "x": 300, "y": 300}
    half["nodes"].append(second | {"self_mirror": True})
    half["edges"].append({"a": "pass", "b": "ridge", "max_level": 1})
    mapdef = parse_map(mirror_half(half, CONFIG))
    # Half nodes 0..2, the self-mirrored pass 3 and ridge 4, mirrors 5..7.
    assert mapdef.mirror_nodes[3:5] == (3, 4)
    road = mapdef.edges[-1]
    assert ((road.a, road.b), mapdef.mirror_edges[road.id]) == ((3, 4), road.id)
    assert check_symmetry(mapdef) == [] and check_border(mapdef) == []


def test_dump_map_round_trips() -> None:
    full = mirror_half(_json(HALVES / "pass.half.json"), CONFIG)
    assert json.loads(dump_map(full)) == full


_DROP = object()
"""Marks a key to remove instead of a value to set."""


def _edit(path: tuple[str | int, ...], value: object) -> dict[str, Any]:
    half = copy.deepcopy(_json(HALVES / "diamond.half.json"))
    target: Any = half
    for key in path[:-1]:
        target = target[key]
    if value is _DROP:
        del target[path[-1]]
    else:
        target[path[-1]] = value
    return half


BROKEN: list[tuple[tuple[str | int, ...], object, str]] = [
    (("edges", 0, "b"), "nowhere", "edges[0].b: unknown node label 'nowhere'"),
    (("cross_edges", 0, "a"), "nowhere", "cross_edges[0].a: unknown node label 'nowhere'"),
    (("nodes", 1, "id"), "capital", "nodes[1].id: duplicate label 'capital'"),
    (("nodes", 1, "id"), 7, "nodes[1].id: expected a non-empty string label"),
    (("nodes", 1, "x"), 200.5, "nodes[1].x: expected an integer"),
    (("meta", "symmetry"), "rot180", "meta: unknown keys ['symmetry']"),
    (("nodes", 1, "mirror_name"), _DROP, "nodes[1]: missing key mirror_name"),
    (("nodes", 1, "self_mirror"), "yes", "nodes[1].self_mirror: expected true or false"),
    (("nodes", 1, "self_mirror"), True, "a self-mirrored node has no copy, remove ['mirror_name']"),
    (("edges", 0, "base_width"), 1, "edges[0]: unknown keys ['base_width']"),
    (("edges", 0, "border_permille"), 4.5, "edges[0].border_permille: expected an integer"),
]


@pytest.mark.parametrize(("path", "value", "message"), BROKEN, ids=[b[2][:30] for b in BROKEN])
def test_broken_half_is_rejected(path: tuple[str | int, ...], value: object, message: str) -> None:
    with pytest.raises(HalfFormatError) as info:
        mirror_half(_edit(path, value), CONFIG)
    assert message in str(info.value)


def test_duplicate_cross_edge_is_rejected() -> None:
    # (north, mirror of capital) is the same road as the mirror of (capital, mirror of north).
    half = _json(HALVES / "diamond.half.json")
    half["cross_edges"].append({"a": "north", "b": "capital", "max_level": 3})
    with pytest.raises(HalfFormatError, match="duplicates the road between 'north'"):
        mirror_half(half, CONFIG)


def test_centre_node_in_cross_edge_is_rejected() -> None:
    half = _json(HALVES / "pass.half.json")
    half["cross_edges"] = [{"a": "front", "b": "pass", "max_level": 1}]
    with pytest.raises(HalfFormatError, match="the centre node joins the other half"):
        mirror_half(half, CONFIG)


def test_two_centre_nodes_are_rejected() -> None:
    half = _json(HALVES / "pass.half.json")
    half["nodes"].append({**half["nodes"][3], "id": "second"})
    with pytest.raises(HalfFormatError, match="only one node can stand at the centre"):
        mirror_half(half, CONFIG)


# --- property: any valid half mirrors into a symmetric map ------------------------------------

_TERRAINS = ["plains", "forest", "mountains"]
_CITY_KINDS = ["city_large", "city_medium", "city_small"]


@st.composite
def halves(draw: st.DrawFn) -> dict[str, Any]:
    width = 2 * draw(st.integers(10, 600))
    height = 2 * draw(st.integers(10, 600))
    count = draw(st.integers(1, 8))
    # Half nodes stay left of the centre line, so no rotated copy lands on a half node.
    points = st.tuples(st.integers(0, width // 2 - 1), st.integers(0, height))
    positions = draw(st.lists(points, min_size=count, max_size=count, unique=True))
    capital = draw(st.integers(0, count - 1))
    nodes: list[dict[str, Any]] = []
    for i, (x, y) in enumerate(positions):
        owner = 0 if i == capital else draw(st.sampled_from([None, 0, 1]))
        units = 0 if owner is None else draw(st.integers(0, 6))
        nodes.append(
            {
                "id": f"n{i}",
                "name": f"left{i}",
                "mirror_name": f"right{i}",
                "x": x,
                "y": y,
                "terrain": draw(st.sampled_from(_TERRAINS)),
                "vp": draw(st.integers(0, 3)),
                "kind": "capital" if i == capital else draw(st.sampled_from(_CITY_KINDS)),
                "capital_of": 0 if i == capital else None,
                "start_owner": owner,
                "start_units": units,
                "start_charged": draw(st.integers(0, units)),
                "start_stock": 0 if owner is None else draw(st.integers(0, 6)),
            }
        )
    for node in nodes:
        if draw(st.booleans()):  # DEC-27, item 6: the copy anywhere in the right half
            node |= {
                "mirror_x": draw(st.integers(width // 2 + 1, width)),
                "mirror_y": draw(st.integers(0, height)),
            }
    side = [n["id"] for n in nodes]
    if draw(st.booleans()):
        nodes.append(
            {
                **{k: v for k, v in nodes[0].items() if not k.startswith("mirror_")},
                "id": "centre",
                "name": "centre",
                "x": width // 2,
                "y": height // 2,
                "kind": "city_medium",
                "capital_of": None,
                "start_owner": None,
                "start_units": 0,
                "start_charged": 0,
                "start_stock": 0,
            }
        )
    labels = [n["id"] for n in nodes]
    pairs = [(a, b) for i, a in enumerate(labels) for b in labels[i + 1 :]]
    cross_pairs = [(a, b) for i, a in enumerate(side) for b in side[i:]]

    def roads(candidates: list[tuple[str, str]]) -> list[dict[str, Any]]:
        chosen = draw(st.lists(st.sampled_from(candidates), unique=True)) if candidates else []
        result: list[dict[str, Any]] = []
        for a, b in chosen:
            road: dict[str, Any] = {"a": a, "b": b, "max_level": draw(st.integers(1, 3))}
            if a != b:  # a self-mirrored cross road keeps 500
                road["border_permille"] = draw(st.integers(100, 900))
            if draw(st.booleans()):
                road["travel_ticks"] = draw(st.integers(1, 500))
            result.append(road)
        return result

    return {
        "meta": {"name": "random", "version": 1, "width": width, "height": height},
        "nodes": nodes,
        "edges": roads(pairs),
        "cross_edges": roads(cross_pairs),
    }


@given(halves())
def test_any_valid_half_gives_a_symmetric_map(half: dict[str, Any]) -> None:
    mapdef = parse_map(mirror_half(half, CONFIG))
    assert check_symmetry(mapdef) == []
    assert check_border(mapdef) == []
    assert len(mapdef.nodes) == 2 * len(half["nodes"]) - (half["nodes"][-1]["id"] == "centre")
    edges = len(half["edges"]) * 2 + sum(1 if c["a"] == c["b"] else 2 for c in half["cross_edges"])
    assert len(mapdef.edges) == edges


# --- CLI ------------------------------------------------------------------------------------


def test_cli_mirror_writes_and_validates(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    out = tmp_path / "diamond.json"
    assert main(["mirror", str(HALVES / "diamond.half.json"), "-o", str(out)]) == 0
    assert f"OK   {out}" in capsys.readouterr().out
    assert parse_map(_json(out)).meta.name == "diamond"


def test_cli_mirror_reports_an_invalid_result(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    half = _json(HALVES / "line3.half.json")
    half["nodes"][1]["vp"] = 2  # a valuable city behind a single road
    src = tmp_path / "bad.half.json"
    src.write_text(json.dumps(half), encoding="utf-8")
    out = tmp_path / "bad.json"
    assert main(["mirror", str(src), "-o", str(out)]) == 1
    assert "[disjoint_paths]" in capsys.readouterr().out
    assert out.exists()


def test_cli_mirror_reports_a_broken_half(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    src = tmp_path / "bad.half.json"
    src.write_text(json.dumps({"meta": {}}), encoding="utf-8")
    assert main(["mirror", str(src), "-o", str(tmp_path / "x.json")]) == 1
    assert "[half] half: unknown keys [], missing keys ['nodes', 'edges', 'cross_edges']" in (
        capsys.readouterr().out
    )
