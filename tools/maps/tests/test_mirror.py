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
from gow_maps.validate import check_symmetry, load_config, validate
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
    half["cross_edges"] = [{"a": "capital", "b": "capital", "base_width": 1, "max_width": 1}]
    mapdef = parse_map(mirror_half(half, CONFIG))
    assert [(e.a, e.b, e.travel_ticks) for e in mapdef.edges] == [(0, 1, 60)]
    assert mapdef.mirror_edges == (0,)
    assert check_symmetry(mapdef) == []


def test_dump_map_round_trips() -> None:
    full = mirror_half(_json(HALVES / "pass.half.json"), CONFIG)
    assert json.loads(dump_map(full)) == full


def _edit(path: tuple[str | int, ...], value: object) -> dict[str, Any]:
    half = copy.deepcopy(_json(HALVES / "diamond.half.json"))
    target: Any = half
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    return half


BROKEN: list[tuple[tuple[str | int, ...], object, str]] = [
    (("edges", 0, "b"), "nowhere", "edges[0].b: unknown node label 'nowhere'"),
    (("cross_edges", 0, "a"), "nowhere", "cross_edges[0].a: unknown node label 'nowhere'"),
    (("nodes", 1, "id"), "capital", "nodes[1].id: duplicate label 'capital'"),
    (("nodes", 1, "id"), 7, "nodes[1].id: expected a non-empty string label"),
    (("nodes", 1, "x"), 200.5, "nodes[1].x: expected an integer"),
    (("meta", "symmetry"), "rot180", "meta: unknown keys ['symmetry']"),
]


@pytest.mark.parametrize(("path", "value", "message"), BROKEN, ids=[b[2][:30] for b in BROKEN])
def test_broken_half_is_rejected(path: tuple[str | int, ...], value: object, message: str) -> None:
    with pytest.raises(HalfFormatError) as info:
        mirror_half(_edit(path, value), CONFIG)
    assert message in str(info.value)


def test_duplicate_cross_edge_is_rejected() -> None:
    # (north, mirror of capital) is the same road as the mirror of (capital, mirror of north).
    half = _json(HALVES / "diamond.half.json")
    half["cross_edges"].append({"a": "north", "b": "capital", "base_width": 1, "max_width": 3})
    with pytest.raises(HalfFormatError, match="duplicates the road between 'north'"):
        mirror_half(half, CONFIG)


def test_centre_node_in_cross_edge_is_rejected() -> None:
    half = _json(HALVES / "pass.half.json")
    half["cross_edges"] = [{"a": "front", "b": "pass", "base_width": 1, "max_width": 1}]
    with pytest.raises(HalfFormatError, match="the centre node joins the other half"):
        mirror_half(half, CONFIG)


def test_two_centre_nodes_are_rejected() -> None:
    half = _json(HALVES / "pass.half.json")
    half["nodes"].append({**half["nodes"][3], "id": "second"})
    with pytest.raises(HalfFormatError, match="only one node can stand at the centre"):
        mirror_half(half, CONFIG)


# --- property: any valid half mirrors into a symmetric map ------------------------------------

_TERRAINS = ["plains", "forest", "mountains"]


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
                "x": x,
                "y": y,
                "terrain": draw(st.sampled_from(_TERRAINS)),
                "vp": draw(st.integers(0, 3)),
                "base_capacity": draw(st.integers(0, 6)),
                "capital_of": 0 if i == capital else None,
                "start_owner": owner,
                "start_units": units,
                "start_charged": draw(st.integers(0, units)),
                "start_stock": 0 if owner is None else draw(st.integers(0, 6)),
            }
        )
    side = [n["id"] for n in nodes]
    if draw(st.booleans()):
        nodes.append(
            {
                **nodes[0],
                "id": "centre",
                "x": width // 2,
                "y": height // 2,
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
            max_width = draw(st.integers(1, 5))
            road: dict[str, Any] = {
                "a": a,
                "b": b,
                "base_width": draw(st.integers(1, max_width)),
                "max_width": max_width,
            }
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
