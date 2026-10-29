"""Map background baker (MAP-05, DEC-27, #344): land biomes by terrain, no water, WebP."""

import io
import json
import math
import time
from functools import cache
from pathlib import Path

import numpy as np
import pytest
from numpy.typing import NDArray
from PIL import Image

from gow_maps.bake import (
    MAX_WEBP_BYTES,
    STEP,
    TERRAIN_BIOMES,
    WARP,
    Biome,
    background_path,
    bake_background,
    bake_cells,
    map_seed,
    render_background,
)
from gow_maps.cli import main
from gow_sim.maps import MapDef, load_map

ROOT = Path(__file__).parents[3]
MAPS = ROOT / "maps"
FIXTURES = MAPS / "fixtures"  # the MVP maps, frozen test fixtures (#372)
TEST_MAPS = ROOT / "packages" / "sim" / "tests" / "maps"
MENU = MAPS / "menu"  # the menu map, outside the server pool (#474)
POOL = ["artery", "ridge", "web", "crossroads", "pass", "highway", "valley"]
MVP = ["artery", "web", "pass"]
FILES = {
    name: (FIXTURES if name in MVP else MENU if name == "valley" else MAPS) / f"{name}.json"
    for name in POOL
}
ALL_MAPS = [FILES[name] for name in POOL] + sorted(TEST_MAPS.glob("*.json"))
BAKE_SECONDS = 10  # #344: baking one map takes at most 10 s (CPU time, a loaded machine is slower)
LAND = frozenset(biome for biomes in TERRAIN_BIOMES.values() for biome in biomes)


@cache
def _map(path: Path) -> MapDef:
    return load_map(path)


@cache
def _cells(path: Path) -> list[list[Biome]]:
    return bake_cells(_map(path))


def _decode(data: bytes) -> NDArray[np.uint8]:
    """Pixels (height x width x 3) of a WebP file; the format and the RGB mode are asserted."""
    with Image.open(io.BytesIO(data)) as image:
        assert image.format == "WEBP"
        assert image.mode == "RGB"
        return np.asarray(image)


def _centre(gx: int, gy: int) -> tuple[float, float]:
    return gx * STEP + STEP / 2, gy * STEP + STEP / 2


@pytest.mark.parametrize("path", ALL_MAPS, ids=lambda p: p.stem)
def test_grid_covers_the_world_rectangle(path: Path) -> None:
    mapdef, cells = _map(path), _cells(path)
    assert len(cells) == mapdef.meta.height // STEP
    assert {len(row) for row in cells} == {mapdef.meta.width // STEP}


@pytest.mark.parametrize("path", ALL_MAPS, ids=lambda p: p.stem)
def test_node_area_has_the_node_terrain(path: Path) -> None:
    # Near a node (closer than half the distance to any other node, minus the border warp)
    # every cell belongs to that node's area, so its biome comes from the node's terrain. The
    # warp moves a point by up to WARP on each axis, so by up to WARP * sqrt(2) in all.
    mapdef, cells = _map(path), _cells(path)
    checked = 0
    for node in mapdef.nodes:
        others = min(
            math.hypot(node.x - o.x, node.y - o.y) for o in mapdef.nodes if o.id != node.id
        )
        reach = others / 2 - WARP * math.sqrt(2) - STEP
        allowed = TERRAIN_BIOMES[node.terrain]
        checked += reach > STEP  # a node closer to a neighbour has no such guaranteed area
        for gy, row in enumerate(cells):
            for gx, biome in enumerate(row):
                x, y = _centre(gx, gy)
                if math.hypot(node.x - x, node.y - y) < reach:
                    assert biome in allowed, (node.id, gx, gy, biome)
        # The city itself always stands on land of its own terrain.
        own = cells[min(node.y // STEP, len(cells) - 1)][min(node.x // STEP, len(cells[0]) - 1)]
        assert own in TERRAIN_BIOMES[node.terrain]
    if path.parent in (MAPS, FIXTURES):  # the pool maps are roomy: most nodes have such an area
        assert checked * 2 > len(mapdef.nodes)


def test_there_is_no_water_biome() -> None:
    # DEC-27, item 3: no deep sea, shallow sea or beach, only the land biomes of the terrains.
    assert set(Biome) == LAND
    assert {biome.value for biome in Biome} == {
        "steppe",
        "savanna",
        "forest",
        "jungle",
        "rock",
        "snow",
    }


@pytest.mark.parametrize("path", ALL_MAPS, ids=lambda p: p.stem)
def test_every_cell_is_land(path: Path) -> None:
    assert {biome for row in _cells(path) for biome in row} <= LAND


def test_bake_is_deterministic() -> None:
    mapdef = _map(TEST_MAPS / "line3.json")
    first = render_background(mapdef)
    assert np.array_equal(first, render_background(mapdef))
    assert np.array_equal(render_background(mapdef, seed=1), render_background(mapdef, seed=1))
    assert not np.array_equal(render_background(mapdef, seed=1), render_background(mapdef, seed=2))


def test_default_seed_depends_on_name_and_version(tmp_path: Path) -> None:
    data = json.loads((TEST_MAPS / "line3.json").read_text(encoding="utf-8"))
    seeds: set[int] = set()
    for name, version in [("line3", 1), ("line3", 2), ("other", 1)]:
        data["meta"]["name"], data["meta"]["version"] = name, version
        path = tmp_path / f"{name}-{version}.json"
        path.write_text(json.dumps(data), encoding="utf-8")
        seeds.add(map_seed(load_map(path)))
    assert len(seeds) == 3


def test_picture_has_the_map_size_and_rgb_pixels() -> None:
    mapdef = _map(TEST_MAPS / "line3.json")
    pixels = render_background(mapdef)
    assert pixels.shape == (mapdef.meta.height, mapdef.meta.width, 3)
    assert pixels.dtype == np.uint8


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


@pytest.fixture(scope="module")
def fresh() -> dict[str, NDArray[np.uint8]]:
    """A fresh bake of every MVP map (about 5 s each), shared by the tests below."""
    return {name: render_background(_map(FILES[name])) for name in POOL}


def _blocks(pixels: NDArray[np.uint8], size: int = 16) -> NDArray[np.float64]:
    """Mean colour of every ``size x size`` block: lossy-coding noise averages out."""
    h, w, _ = pixels.shape
    cut = pixels[: h // size * size, : w // size * size].astype(np.float64)
    return cut.reshape(h // size, size, w // size, size, 3).mean(axis=(1, 3))


@pytest.mark.parametrize("name", POOL)
def test_committed_background_is_up_to_date(name: str, fresh: dict[str, NDArray[np.uint8]]) -> None:
    path = FILES[name]
    data = background_path(path).read_bytes()
    assert background_path(path).name == f"{name}.bg.webp"
    assert len(data) <= MAX_WEBP_BYTES  # #344: at most 0.5 MB
    mapdef = _map(path)
    committed = _decode(data)  # WebP, RGB
    assert committed.shape == (mapdef.meta.height, mapdef.meta.width, 3)
    # Compared as block means with a tolerance, not as bytes: libwebp of another Pillow wheel
    # may code the same pixels differently. A stale file (the map was edited without `bake`)
    # moves whole biome areas, which is far beyond the tolerance.
    diff = np.abs(_blocks(committed) - _blocks(fresh[name]))
    assert diff.mean() < 1.5
    assert diff.max() < 25


@pytest.mark.parametrize("name", POOL)
def test_committed_background_has_no_water_pixels(name: str) -> None:
    # Example 12 of DEC-27: not a single sea, shallow water or beach pixel. Water is blue (the
    # old deep and shallow sea (0, 105, 148) and (0, 133, 148)), a beach is sand (238, 214, 175);
    # the land palette has neither (snow is a cold white: blue exceeds red and green by 12 at most).
    pixels = _decode(background_path(FILES[name]).read_bytes()).astype(np.int16)
    red, green, blue = pixels[..., 0], pixels[..., 1], pixels[..., 2]
    assert not (blue - np.maximum(red, green) > 25).any()  # blue water
    assert not ((red > 215) & (red - blue > 40)).any()  # sand


def test_render_stays_within_the_time_budget() -> None:
    mapdef = _map(FILES["artery"])  # 1600 x 1000, the largest map of the pool
    started = time.process_time()
    pixels = render_background(mapdef)
    data = io.BytesIO()
    Image.fromarray(pixels, "RGB").save(data, "WEBP", quality=85, method=6)
    assert time.process_time() - started < BAKE_SECONDS


def test_bake_refuses_a_file_over_the_budget(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("gow_maps.bake.MAX_WEBP_BYTES", 100)
    out = tmp_path / "line3.bg.webp"
    with pytest.raises(ValueError, match="over the budget"):
        bake_background(_map(TEST_MAPS / "line3.json"), out)
    assert not out.exists()


def test_cli_bake_writes_next_to_the_map(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "line3.json"
    path.write_bytes((TEST_MAPS / "line3.json").read_bytes())
    assert main(["bake", str(tmp_path / "*.json"), "--seed", "7"]) == 0
    out = tmp_path / "line3.bg.webp"
    assert background_path(path) == out
    assert f"wrote {out}" in capsys.readouterr().out
    mapdef = load_map(path)
    decoded = _decode(out.read_bytes())
    assert decoded.shape == (mapdef.meta.height, mapdef.meta.width, 3)
    assert np.abs(_blocks(decoded) - _blocks(render_background(mapdef, seed=7))).mean() < 1.5
