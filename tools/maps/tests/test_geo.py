"""Map geography (DEC-36, #537): the baker's areas, water, rivers, bridges, the check `geography`.

Expected values come from the text of DEC-36 (mechanics.md, section 9) and its table of worked
examples (rows 1-8), the owner's decision of 2026-10-29 (W4 Painted, no dark line along water) and
map-format.md, "Format changes under DEC-36". The small map is the test map `diamond` scaled by 2:
capitals 0 and 3 west and east, cities 1 and 2 north and south, roads 0-1, 0-2, 3-1, 3-2; the
pairs 0-3 and 1-2 have no road.
"""

import json
import math
import time
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from gow_maps import geo
from gow_maps.bake import STEP, background_path
from gow_maps.cli import main
from gow_maps.validate import (
    ValidatorConfig,
    check_geography,
    load_config,
    validate,
    validate_file,
)
from gow_sim.maps import MapDef, load_map

ROOT = Path(__file__).parents[3]
DIAMOND = ROOT / "packages" / "sim" / "tests" / "maps" / "diamond.json"
RIDGE = ROOT / "maps" / "ridge.json"
RIDGE_MOCKUP = ROOT / "docs" / "design" / "mockups" / "src" / "ridge.geography.json"
BAKE_SECONDS = 10  # map-format.md, "Map background": baking one map takes up to 10 s

# Example 6 (a river from the middle to a sea in the south-east corner): it passes the road 3-2.
SEA_AND_RIVER: dict[str, Any] = {
    "water": [{"kind": "sea", "x": 900, "y": 900, "r": 260}],
    "rivers": [{"from": [400, 400]}],
}


@pytest.fixture(scope="module")
def config() -> ValidatorConfig:
    return load_config()


def _diamond(tmp: Path, spec: dict[str, Any] | None, border: int = 500) -> Path:
    """``tmp/maps/diamond2.json`` (diamond x2) and, given ``spec``, its authored geography."""
    data = json.loads(DIAMOND.read_text(encoding="utf-8"))
    data["meta"].update(name="diamond2", width=800, height=800)
    for node in data["nodes"]:
        node["x"] *= 2
        node["y"] *= 2
    for edge in data["edges"]:
        edge["travel_ticks"] = 85  # 283 units: 85 ticks (DEC-27, item 4)
    # Edge 0 (0-1) and its mirror 2 (3-2) keep one direction, so one border point (DEC-23, item 7).
    data["edges"][0]["border_permille"] = data["edges"][2]["border_permille"] = border
    maps = tmp / "maps"
    (maps / "src").mkdir(parents=True, exist_ok=True)
    path = maps / "diamond2.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    if spec is not None:
        geo_spec = {"map": "diamond2", **spec}
        (maps / "src" / "diamond2.geo.json").write_text(json.dumps(geo_spec), encoding="utf-8")
    return path


def _computed(path: Path) -> tuple[MapDef, geo.Geography]:
    mapdef = load_map(path)
    spec = geo.find_spec(path)
    assert spec is not None
    return mapdef, geo.compute(mapdef, spec)


def _messages(issues: list[Any]) -> list[str]:
    return [str(issue) for issue in issues]


# ---- areas (item 2) and the adjacency rule (item 3) --------------------------------------------
def test_example_1_and_3_areas_touch_only_along_roads(tmp_path: Path) -> None:
    # Rows 1 and 3: the road pairs share land; 0-3 and 1-2 (no road) are cut apart by a stream.
    _, g = _computed(_diamond(tmp_path, {"water": []}))
    assert set(geo.land_contacts(g.labels)) == {(0, 1), (0, 2), (1, 3), (2, 3)}
    assert len(g.streams) >= 1
    assert (g.labels == geo.RIVER).any()


def test_a_road_runs_through_its_own_two_areas_and_the_border_is_at_its_border_point(
    tmp_path: Path,
) -> None:
    # Item 2: the site of a node is its point and its road halves up to the border point, so the
    # border of the two areas crosses the road at its border point (here 300 permille of 0-1).
    mapdef, g = _computed(_diamond(tmp_path, {"water": []}, border=300))
    for edge in mapdef.edges:
        a, b = mapdef.nodes[edge.a], mapdef.nodes[edge.b]
        length = math.hypot(b.x - a.x, b.y - a.y)
        last_a = 0.0
        for k in range(int(length) + 1):
            x, y = a.x + (b.x - a.x) * k / length, a.y + (b.y - a.y) * k / length
            label = int(g.labels[int(y // STEP), int(x // STEP)])
            assert label in (edge.a, edge.b), (edge.id, k, label)
            if label == edge.a:
                last_a = k
        # The change of area lies at the border point, within one cell diagonal.
        assert abs(last_a - length * edge.border_permille / 1000) <= STEP * math.sqrt(2) + 1


def test_every_area_is_one_piece_around_its_node(tmp_path: Path) -> None:
    mapdef, g = _computed(_diamond(tmp_path, SEA_AND_RIVER))
    for node in mapdef.nodes:
        comp, pieces = geo.components(g.labels == node.id)
        assert pieces == 1
        assert comp[node.y // STEP, node.x // STEP] == 0


def test_a_piece_cut_off_from_its_node_becomes_the_water_around_it() -> None:
    # Item 3: no slivers, no exclaves. Node 0 stands at cell (1, 1); its second piece at the right
    # is cut off by the lake w0 and becomes that lake.
    w0 = geo.WATER_BASE
    labels = np.array(
        [
            [0, 0, w0, 0],
            [0, 0, w0, 0],
            [1, 1, w0, w0],
        ],
        dtype=np.int32,
    )
    stub = _StubMap(nodes=[_StubNode(0, 1 * STEP, 1 * STEP), _StubNode(1, 0, 2 * STEP)])
    geo.fill_islands(labels, stub)  # pyright: ignore[reportArgumentType]
    assert labels.tolist() == [[0, 0, w0, w0], [0, 0, w0, w0], [1, 1, w0, w0]]


class _StubNode:
    def __init__(self, node_id: int, x: int, y: int) -> None:
        self.id, self.x, self.y = node_id, x, y


class _StubMap:
    def __init__(self, nodes: list[_StubNode]) -> None:
        self.nodes = nodes


# ---- long rivers and bridges (item 4) ----------------------------------------------------------
def test_example_6_a_long_river_passes_a_road_at_its_border_point_a_bridge(
    tmp_path: Path, config: ValidatorConfig
) -> None:
    mapdef, g = _computed(_diamond(tmp_path, SEA_AND_RIVER))
    assert len(g.rivers) == 1
    assert g.bridges, "the river from the middle to the sea must pass a road"
    for bridge in g.bridges:
        assert (bridge.x, bridge.y) == geo.border_point(mapdef, bridge.edge)
    # A and B of a bridged road may share no land at all, and that is fine.
    assert check_geography(mapdef, g, config) == []


def test_example_8_mirrored_roads_one_with_a_bridge_one_without(
    tmp_path: Path, config: ValidatorConfig
) -> None:
    # The picture is free (item 8): the river bridges one road, its mirror has no bridge, and the
    # whole validator (symmetry included) passes.
    mapdef, g = _computed(_diamond(tmp_path, SEA_AND_RIVER))
    bridged = {b.edge for b in g.bridges}
    assert any(mapdef.mirror_edges[e] not in bridged for e in bridged)
    assert validate(mapdef, config) == []
    assert check_geography(mapdef, g, config) == []


# ---- water cells (item 1) ----------------------------------------------------------------------
def test_water_keeps_clear_of_nodes_and_roads(tmp_path: Path, config: ValidatorConfig) -> None:
    # A lake authored right on a city: the city keeps its ground (water_clearance, 60) and the
    # roads keep theirs; the rest of the lake stays.
    mapdef, g = _computed(
        _diamond(tmp_path, {"water": [{"kind": "lake", "x": 400, "y": 200, "r": 120}]})
    )
    assert (g.labels == geo.WATER_BASE).any()
    assert check_geography(mapdef, g, config) == []


def test_spec_kinds_and_defaults() -> None:
    spec = geo.parse_spec(
        {
            "map": "m",
            "water": [{"kind": "sea", "x": -150, "y": 1360, "r": 330}],
            "rivers": [{"from": [800, 885], "to": 0, "w0": 6, "w1": 11}, {"from": [1, 2]}],
        }
    )
    assert spec.water == (geo.WaterCell("sea", -150, 1360, 330),)
    assert spec.rivers[0] == geo.RiverSpec((800, 885), 0, 6.0, 11.0)
    assert spec.rivers[1] == geo.RiverSpec((1, 2), None, *geo.RIVER_HW)


@pytest.mark.parametrize(
    ("raw", "fragment"),
    [
        ({"map": "m", "water": [{"kind": "ocean", "x": 0, "y": 0, "r": 1}]}, "sea or lake"),
        ({"map": "m", "water": [{"kind": "sea", "x": 0.5, "y": 0, "r": 1}]}, "integer"),
        ({"map": "m", "rivers": [{"from": [0, 0]}]}, "needs a water cell"),
        ({"map": "m", "water": [], "lakes": []}, "keys must be"),
        (
            {"map": "m", "water": [{"kind": "sea", "x": 0, "y": 0, "r": 1}], "rivers": [
                {"from": [0, 0], "to": 3}]},
            "index of a water cell",
        ),
    ],
)  # fmt: skip
def test_spec_errors(raw: dict[str, Any], fragment: str) -> None:
    with pytest.raises(geo.GeoFormatError, match=fragment):
        geo.parse_spec(raw)


# ---- the check `geography` on hand-made label grids (rows 2, 4, 5, 7) ---------------------------
def _grid(mapdef: MapDef, fill: dict[int, list[tuple[int, int, int, int]]]) -> np.ndarray[Any, Any]:
    """Voronoi of the plain node points, then rectangles ``(c0, r0, c1, r1)`` set to a label."""
    rows, cols = mapdef.meta.height // STEP, mapdef.meta.width // STEP
    y, x = np.mgrid[0:rows, 0:cols] * STEP + STEP / 2
    dist = np.stack([np.hypot(x - n.x, y - n.y) for n in mapdef.nodes])
    labels = dist.argmin(0).astype(np.int32)
    for label, boxes in fill.items():
        for c0, r0, c1, r1 in boxes:
            labels[r0:r1, c0:c1] = label
    return labels


def _geography(labels: np.ndarray[Any, Any], bridges: tuple[geo.Bridge, ...] = ()) -> geo.Geography:
    return geo.Geography(labels, ("lake",), (), (), bridges)


def test_example_2_areas_share_land_without_a_road_fail(
    tmp_path: Path, config: ValidatorConfig
) -> None:
    mapdef = load_map(_diamond(tmp_path, None))
    # The plain Voronoi cells of the four nodes meet in the middle: 0-3 or 1-2 share land.
    issues = _messages(check_geography(mapdef, _geography(_grid(mapdef, {})), config))
    assert any(
        i.startswith(f"[geography] the areas of nodes {a} and {b} share land without a road")
        for i in issues
        for a, b in ((0, 3), (1, 2))
    )
    assert all(i.startswith("[geography]") for i in issues)


def test_example_3_a_stream_between_them_is_ok(tmp_path: Path, config: ValidatorConfig) -> None:
    mapdef = load_map(_diamond(tmp_path, None))
    # A stream along both diagonals of the middle: the four areas meet only along their roads.
    labels = _grid(mapdef, {})
    rows, cols = labels.shape
    y, x = np.mgrid[0:rows, 0:cols]
    cx, cy = cols / 2 - 0.5, rows / 2 - 0.5
    near_diagonal = (np.abs((x - cx) - (y - cy)) < 2) | (np.abs((x - cx) + (y - cy)) < 2)
    labels[near_diagonal & (np.hypot(x - cx, y - cy) < 12)] = geo.RIVER
    contacts = set(geo.land_contacts(labels))
    assert (0, 3) not in contacts and (1, 2) not in contacts
    assert check_geography(mapdef, _geography(labels), config) == []


def test_example_4_an_area_in_two_pieces_fail(tmp_path: Path, config: ValidatorConfig) -> None:
    mapdef = load_map(_diamond(tmp_path, None))
    w0 = geo.WATER_BASE
    # A moat of lake around a corner of the area of node 1, far from every node: two pieces.
    labels = _grid(mapdef, {})
    labels = _with_stream(mapdef, labels)
    labels[0:30, 85:115] = w0
    labels[5:25, 90:110] = 1
    issues = _messages(check_geography(mapdef, _geography(labels), config))
    assert "[geography] the area of node 1 is in 2 pieces" in issues


def _with_stream(mapdef: MapDef, labels: np.ndarray[Any, Any]) -> np.ndarray[Any, Any]:
    """The plain Voronoi with the road-less contacts of the middle turned into a stream."""
    rows, cols = labels.shape
    y, x = np.mgrid[0:rows, 0:cols]
    middle = np.hypot(x - cols / 2, y - rows / 2) < 14
    out = labels.copy()
    out[middle & (np.abs(np.abs(x - cols / 2) - np.abs(y - rows / 2)) < 3)] = geo.RIVER
    assert not {(0, 3), (1, 2)} & set(geo.land_contacts(out)), mapdef.meta.name
    return out


def test_example_5_a_road_crosses_a_lake_fail(tmp_path: Path, config: ValidatorConfig) -> None:
    mapdef = load_map(_diamond(tmp_path, None))
    labels = _with_stream(mapdef, _grid(mapdef, {}))
    # A lake on the road 0-1 (from (200, 400) to (400, 200)) around (260, 340), no bridge.
    labels[80:90, 60:70] = geo.WATER_BASE
    issues = _messages(check_geography(mapdef, _geography(labels), config))
    assert any(i.startswith("[geography] edge 0 crosses water away from a bridge") for i in issues)
    # A river 16 units wide across the same road next to a bridge of that road: a crossing (row 6).
    river = _with_stream(mapdef, _grid(mapdef, {}))
    river[83:87, 63:67] = geo.RIVER
    bridged = _geography(river, (geo.Bridge(0, 260.0, 340.0),))
    assert not any(
        "edge 0 crosses" in i for i in _messages(check_geography(mapdef, bridged, config))
    )


def test_example_7_a_node_closer_than_water_clearance_fail(
    tmp_path: Path, config: ValidatorConfig
) -> None:
    mapdef = load_map(_diamond(tmp_path, None))
    labels = _with_stream(mapdef, _grid(mapdef, {}))
    # A lake 40 units north of node 1 (400, 200): cells around (400, 160), off the roads.
    labels[38:41, 99:102] = geo.WATER_BASE
    issues = _messages(check_geography(mapdef, _geography(labels), config))
    assert any(
        i.startswith("[geography] node 1 is") and "need 60 (water_clearance)" in i for i in issues
    )
    assert config.water_clearance == 60  # map-format.md, DEC-36: 60 units


# ---- files, the CLI and the validator ------------------------------------------------------------
def test_validator_skips_a_map_without_a_geography(tmp_path: Path, config: ValidatorConfig) -> None:
    # The fixtures and the current pool keep the land-only background (item 10): no check.
    path = _diamond(tmp_path, None)
    assert geo.find_spec(path) is None
    assert validate_file(path, config) == []


def test_bake_writes_the_vector_file_and_the_validator_wants_it_fresh(
    tmp_path: Path, config: ValidatorConfig, capsys: pytest.CaptureFixture[str]
) -> None:
    path = _diamond(tmp_path, SEA_AND_RIVER)
    vectors = geo.vector_path(path)
    assert vectors == tmp_path / "maps" / "geo" / "diamond2.json"
    assert _messages(validate_file(path, config)) == [
        f"[geography] {vectors} is missing or broken: run gow-maps bake"
    ]
    assert main(["bake", str(path)]) == 0
    assert f"wrote {vectors}" in capsys.readouterr().out
    assert background_path(path).is_file()
    assert validate_file(path, config) == []
    data = json.loads(vectors.read_text(encoding="utf-8"))
    assert (data["map"], data["version"], data["step"]) == ("diamond2", 1, STEP)
    assert data["water"] == [{"kind": "sea"}]
    # A map edit without a new bake (item 12): the vector file is stale.
    raw = json.loads(path.read_text(encoding="utf-8"))
    raw["meta"]["version"] = 2
    path.write_text(json.dumps(raw), encoding="utf-8")
    assert any("run gow-maps bake" in m for m in _messages(validate_file(path, config)))


def test_validator_reports_a_broken_or_foreign_geography(
    tmp_path: Path, config: ValidatorConfig
) -> None:
    path = _diamond(tmp_path, {"water": [{"kind": "pond", "x": 0, "y": 0, "r": 1}]})
    assert any("sea or lake" in m for m in _messages(validate_file(path, config)))
    path = _diamond(tmp_path, {"water": []})
    spec = geo.spec_path(path)
    spec.write_text(json.dumps({"map": "ridge", "water": []}), encoding="utf-8")
    assert any("not 'diamond2'" in m for m in _messages(validate_file(path, config)))


def test_vector_chains_are_the_borders_of_the_label_grid(tmp_path: Path) -> None:
    mapdef, g = _computed(_diamond(tmp_path, SEA_AND_RIVER))
    data = geo.vector_file(mapdef, g)
    assert data["bridges"] == [{"edge": b.edge, "x": b.x, "y": b.y} for b in g.bridges]

    def out(label: int) -> int | str:
        if label >= geo.WATER_BASE:
            return f"w{label - geo.WATER_BASE}"
        return "river" if label == geo.RIVER else label

    # Every pair of neighbouring regions (and the map edge) has a chain, and nothing else.
    labels = g.labels
    pairs: set[frozenset[int | str]] = set()
    for a, b in ((labels[:, 1:], labels[:, :-1]), (labels[1:, :], labels[:-1, :])):
        diff = a != b
        pairs |= {
            frozenset((out(i), out(j)))
            for i, j in zip(a[diff].tolist(), b[diff].tolist(), strict=True)
        }
    edge = np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]])
    pairs |= {frozenset((out(int(v)), -1)) for v in np.unique(edge)}
    chains = {frozenset((c["l"], c["r"])) for c in data["chains"]}
    assert chains == pairs
    for chain in data["chains"]:
        pts = chain["pts"]
        assert len(pts) >= 4 and len(pts) % 2 == 0
        assert all(isinstance(v, int) and v % STEP == 0 for v in pts)  # cell corners


def test_geography_is_deterministic(tmp_path: Path) -> None:
    # Item 12: the same map and seed give the same labels, vectors and pixels.
    path = _diamond(tmp_path, SEA_AND_RIVER)
    mapdef, first = _computed(path)
    _, second = _computed(path)
    assert np.array_equal(first.labels, second.labels)
    assert geo.dump_vector_file(geo.vector_file(mapdef, first)) == geo.dump_vector_file(
        geo.vector_file(mapdef, second)
    )
    assert np.array_equal(geo.render(mapdef, first), geo.render(mapdef, second))


# ---- the look: W4 Painted, no dark line along water (owner, 2026-10-29) --------------------------
@pytest.fixture(scope="module")
def ridge(tmp_path_factory: pytest.TempPathFactory) -> tuple[MapDef, geo.Geography, float]:
    """The pool map `ridge` with the geography of the mockup (without its node moves)."""
    spec = json.loads(RIDGE_MOCKUP.read_text(encoding="utf-8"))
    spec.pop("moves")
    mapdef = load_map(RIDGE)
    started = time.process_time()
    geography = geo.compute(mapdef, geo.parse_spec({"map": "ridge", **spec}))
    return mapdef, geography, time.process_time() - started


def test_ridge_mockup_geography_passes_the_check(
    ridge: tuple[MapDef, geo.Geography, float], config: ValidatorConfig
) -> None:
    mapdef, g, _ = ridge
    assert check_geography(mapdef, g, config) == []
    # Item 11: about a fifth of the map is water (two seas, bays, four lakes, rivers, streams).
    assert 0.15 < float(geo.is_water(g.labels).mean()) < 0.25
    # Item 4: the long rivers pass roads only on bridges, at the border points.
    assert g.bridges
    for bridge in g.bridges:
        assert (bridge.x, bridge.y) == geo.border_point(mapdef, bridge.edge)


def test_no_dark_line_along_water_and_the_water_is_blue(
    ridge: tuple[MapDef, geo.Geography, float],
) -> None:
    mapdef, g, compute_seconds = ridge
    started = time.process_time()
    pixels = geo.render(mapdef, g).astype(np.float64)
    assert compute_seconds + time.process_time() - started < BAKE_SECONDS
    # Land right beside the water is not darker than the land a little farther away: no dark
    # stroke, halo or bank line where an area border runs along water.
    water = geo.is_water(g.labels)
    dist = geo.distance_to(water)
    lum = pixels.mean(axis=2)
    cells = (
        lum[: g.labels.shape[0] * STEP, : g.labels.shape[1] * STEP]
        .reshape(g.labels.shape[0], STEP, g.labels.shape[1], STEP)
        .mean(axis=(1, 3))
    )
    beside = cells[(dist > 0) & (dist <= 8)].mean()
    farther = cells[(dist > 16) & (dist <= 32)].mean()
    assert beside >= farther - 2.0, (beside, farther)
    # W4 water is blue: blue above red in the water, unlike the land palette.
    rgb = pixels.reshape(g.labels.shape[0], STEP, g.labels.shape[1], STEP, 3).mean(axis=(1, 3))
    lakes = rgb[g.labels >= geo.WATER_BASE]
    assert (lakes[:, 2] - lakes[:, 0]).mean() > 40
