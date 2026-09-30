"""Map background baker (MAP-05): terrain biomes, sea, determinism, committed PNGs."""

import json
import math
import struct
import zlib
from functools import cache
from pathlib import Path

import pytest

from gow_maps.bake import (
    INFLUENCE_RADIUS,
    STEP,
    TERRAIN_BIOMES,
    WARP,
    Biome,
    Cell,
    background_path,
    bake_cells,
    encode_png,
    map_seed,
    render_rgb,
)
from gow_maps.cli import main
from gow_sim.maps import MapDef, load_map

ROOT = Path(__file__).parents[3]
MAPS = ROOT / "maps"
TEST_MAPS = ROOT / "packages" / "sim" / "tests" / "maps"
POOL = ["arteriya", "pautina", "pereval"]
ALL_MAPS = [MAPS / f"{name}.json" for name in POOL] + sorted(TEST_MAPS.glob("*.json"))
MAX_PNG_BYTES = 1_500_000  # issue MAP-05: every background is at most 1.5 MB
SEA = {Biome.DEEP_SEA, Biome.SHALLOW_SEA}


@cache
def _map(path: Path) -> MapDef:
    return load_map(path)


@cache
def _cells(path: Path) -> list[list[Cell]]:
    return bake_cells(_map(path))


def _decode_png(data: bytes) -> tuple[int, int, bytes]:
    """Width, height and RGB pixels of an 8-bit RGB PNG whose rows all use filter 0."""
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    pos, idat, header = 8, b"", b""
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        kind, body = data[pos + 4 : pos + 8], data[pos + 8 : pos + 8 + length]
        if kind == b"IHDR":
            header = body
        elif kind == b"IDAT":
            idat += body
        pos += 12 + length
    width, height, depth, colour_type = struct.unpack(">IIBB", header[:10])
    assert (depth, colour_type) == (8, 2)
    raw = zlib.decompress(idat)
    stride = width * 3 + 1
    assert all(raw[r * stride] == 0 for r in range(height))
    return width, height, b"".join(raw[r * stride + 1 : (r + 1) * stride] for r in range(height))


def _centre(gx: int, gy: int) -> tuple[float, float]:
    return gx * STEP + STEP / 2, gy * STEP + STEP / 2


def _segment_distance(px: float, py: float, a: tuple[int, int], b: tuple[int, int]) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(0.0, min(1.0, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy)))
    return math.hypot(a[0] + t * dx - px, a[1] + t * dy - py)


@pytest.mark.parametrize("path", ALL_MAPS, ids=lambda p: p.stem)
def test_grid_covers_the_world_rectangle(path: Path) -> None:
    mapdef, cells = _map(path), _cells(path)
    assert len(cells) == mapdef.meta.height // STEP
    assert {len(row) for row in cells} == {mapdef.meta.width // STEP}


@pytest.mark.parametrize("path", ALL_MAPS, ids=lambda p: p.stem)
def test_node_area_has_the_node_terrain(path: Path) -> None:
    # Near a node (closer than half the distance to any other node, minus the border warp)
    # every land cell belongs to that node's area, so its biome comes from the node's terrain.
    mapdef, cells = _map(path), _cells(path)
    for node in mapdef.nodes:
        others = min(
            math.hypot(node.x - o.x, node.y - o.y) for o in mapdef.nodes if o.id != node.id
        )
        reach = others / 2 - WARP - STEP
        assert reach > STEP  # the check below looks at some cells around every node
        allowed = TERRAIN_BIOMES[node.terrain] | {Biome.BEACH} | SEA
        for gy, row in enumerate(cells):
            for gx, cell in enumerate(row):
                x, y = _centre(gx, gy)
                if math.hypot(node.x - x, node.y - y) < reach:
                    assert cell.biome in allowed, (node.id, gx, gy, cell.biome)
        # The city itself always stands on land of its own terrain.
        own = cells[min(node.y // STEP, len(cells) - 1)][min(node.x // STEP, len(cells[0]) - 1)]
        assert own.biome in TERRAIN_BIOMES[node.terrain]


@pytest.mark.parametrize("path", ALL_MAPS, ids=lambda p: p.stem)
def test_far_from_cities_and_roads_is_sea(path: Path) -> None:
    mapdef, cells = _map(path), _cells(path)
    points = [(n.x, n.y) for n in mapdef.nodes]
    roads = [(points[e.a], points[e.b]) for e in mapdef.edges]
    far = 0
    # Every third cell in each direction: enough to cover the sea, fast enough for CI.
    for gy in range(0, len(cells), 3):
        for gx in range(0, len(cells[0]), 3):
            cell, (x, y) = cells[gy][gx], _centre(gx, gy)
            near_city = any(math.hypot(px - x, py - y) < INFLUENCE_RADIUS for px, py in points)
            near_road = any(_segment_distance(x, y, a, b) < INFLUENCE_RADIUS for a, b in roads)
            if not near_city and not near_road:
                far += 1
                assert cell.biome in SEA, (gx, gy, cell.biome)
    assert far > 0
    assert cells[0][0].biome in SEA


@pytest.mark.parametrize("path", ALL_MAPS, ids=lambda p: p.stem)
def test_background_is_rot180_symmetric(path: Path) -> None:
    cells = _cells(path)
    flat = [cell for row in cells for cell in row]
    assert flat == flat[::-1]


def test_bake_is_deterministic() -> None:
    mapdef = _map(TEST_MAPS / "line3.json")
    assert render_rgb(mapdef) == render_rgb(mapdef)
    assert render_rgb(mapdef, seed=1) == render_rgb(mapdef, seed=1)
    assert render_rgb(mapdef, seed=1) != render_rgb(mapdef, seed=2)


def test_default_seed_depends_on_name_and_version(tmp_path: Path) -> None:
    data = json.loads((TEST_MAPS / "line3.json").read_text(encoding="utf-8"))
    seeds: set[int] = set()
    for name, version in [("line3", 1), ("line3", 2), ("other", 1)]:
        data["meta"]["name"], data["meta"]["version"] = name, version
        path = tmp_path / f"{name}-{version}.json"
        path.write_text(json.dumps(data), encoding="utf-8")
        seeds.add(map_seed(load_map(path)))
    assert len(seeds) == 3


def test_png_has_the_map_size_and_pixels() -> None:
    mapdef = _map(TEST_MAPS / "line3.json")
    rgb = render_rgb(mapdef)
    assert len(rgb) == mapdef.meta.width * mapdef.meta.height * 3
    png = encode_png(mapdef.meta.width, mapdef.meta.height, rgb)
    assert _decode_png(png) == (mapdef.meta.width, mapdef.meta.height, rgb)


def test_width_must_be_a_multiple_of_step(tmp_path: Path) -> None:
    data = json.loads((TEST_MAPS / "line3.json").read_text(encoding="utf-8"))
    data["meta"]["width"] += 2
    for node in data["nodes"]:
        node["x"] += 1  # keep the rot180 mirror table valid for the new width
    path = tmp_path / "line3.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(ValueError, match="multiples of 4"):
        bake_cells(load_map(path))
    assert main(["bake", str(path)]) == 1


@pytest.mark.parametrize("name", POOL)
def test_committed_background_is_up_to_date(name: str) -> None:
    path = MAPS / f"{name}.json"
    png = background_path(path).read_bytes()
    assert len(png) <= MAX_PNG_BYTES
    mapdef = _map(path)
    # Compared as pixels, not bytes: zlib builds may compress the same pixels differently.
    assert _decode_png(png) == (mapdef.meta.width, mapdef.meta.height, render_rgb(mapdef))


def test_cli_bake_writes_next_to_the_map(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "line3.json"
    path.write_bytes((TEST_MAPS / "line3.json").read_bytes())
    assert main(["bake", str(tmp_path / "*.json"), "--seed", "7"]) == 0
    out = tmp_path / "line3.bg.png"
    assert background_path(path) == out
    assert f"wrote {out}" in capsys.readouterr().out
    mapdef = load_map(path)
    assert _decode_png(out.read_bytes())[2] == render_rgb(mapdef, seed=7)
