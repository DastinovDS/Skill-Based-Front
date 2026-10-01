"""Map background baker (MAP-05): ``maps/<id>.json`` -> ``maps/<id>.bg.png``.

Formulas ported from the Pygame prototype map generator (git tag ``v0-pygame-prototype``,
path ``rts_core/game_logic/World/MapGenerator.py``):

- land is a metaball field: every city and every road adds density inside ``INFLUENCE_RADIUS``,
  a cell is sea where the density plus a wave noise stays below a density-dependent threshold;
- a thin band above the threshold is the shore;
- the prototype temperature/moisture climate is replaced by the terrain of the nearest city
  (Voronoi area of the node): plains, forest, mountains. The prototype moisture and detail noise
  only pick a variant inside that terrain and shade it.

The picture covers exactly the world rectangle ``[0, width] x [0, height]`` at one pixel per world
unit, so the client stretches nothing: the sprite sits at ``(0, 0)`` with the map's own size.
The field is sampled on a ``STEP`` grid (as in the prototype) and every cell is a
``STEP x STEP`` block.

The result is deterministic: noise offsets come from ``random.Random`` seeded by the map name and
version (or an explicit seed), and the second half of the picture is the first half turned by
180 degrees, the same symmetry as the map itself. The PNG is written with the standard library
(zlib), no image library is needed.
"""

import hashlib
import math
import random
import struct
import zlib
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

from gow_sim.maps import MapDef, Terrain

STEP = 4  # world units per sampled cell (prototype MapGenerator.STEP)
INFLUENCE_RADIUS = 95.0  # prototype MapGenerator.INFLUENCE_RADIUS
LAND_THRESHOLD = 0.15  # prototype MapGenerator.LAND_THRESHOLD
SHORE_BAND = 0.05  # prototype: total density below LAND_THRESHOLD + 0.05 is the shore
SHALLOW_BAND = 0.06  # sea this close to the threshold is drawn as shallow water
NODE_WEIGHT = 0.35  # prototype: a city adds 0.35 of a road's density
SNOW_MOISTURE = 0.7  # mountain cells this moist are snow (prototype: cold and moist is snow)
WARP = 40.0  # world units: how far the borders between node areas wander


class Biome(StrEnum):
    DEEP_SEA = "deep_sea"
    SHALLOW_SEA = "shallow_sea"
    BEACH = "beach"
    STEPPE = "steppe"
    SAVANNA = "savanna"
    FOREST = "forest"
    JUNGLE = "jungle"
    ROCK = "rock"
    SNOW = "snow"


# Prototype palette (rts_core/system/ChunkManager.py) where a prototype biome fits.
BIOME_COLOUR: dict[Biome, tuple[int, int, int]] = {
    Biome.DEEP_SEA: (0, 105, 148),
    Biome.SHALLOW_SEA: (0, 133, 148),
    Biome.BEACH: (238, 214, 175),
    Biome.STEPPE: (140, 170, 90),
    Biome.SAVANNA: (180, 190, 100),
    Biome.FOREST: (34, 139, 34),
    Biome.JUNGLE: (0, 100, 80),
    Biome.ROCK: (125, 115, 100),
    Biome.SNOW: (235, 238, 240),
}

# Land biomes each terrain may produce; the shore (BEACH) belongs to every terrain.
TERRAIN_BIOMES: dict[Terrain, frozenset[Biome]] = {
    Terrain.PLAINS: frozenset({Biome.STEPPE, Biome.SAVANNA}),
    Terrain.FOREST: frozenset({Biome.FOREST, Biome.JUNGLE}),
    Terrain.MOUNTAINS: frozenset({Biome.ROCK, Biome.SNOW}),
}


@dataclass(frozen=True, slots=True)
class Cell:
    biome: Biome
    shade: float  # brightness factor around 1.0 from the prototype detail noise


@dataclass(frozen=True, slots=True)
class _Noise:
    """Prototype noise fields, made continuous across the rot180 seam of the picture.

    The picture is mirrored at its centre, so a raw noise field would jump there. Every field is
    averaged with its own rot180 image (``symmetric``); the terrain warp is antisymmetric
    instead, so a point and its mirror look up mirrored nodes.
    """

    island: float
    x: float
    y: float
    width: int
    height: int

    def _wave(self, x: float, y: float) -> float:
        return math.sin(x * 0.04 + self.island) * math.cos(y * 0.04 - self.island) * 0.04

    def _detail(self, x: float, y: float) -> float:
        return (
            math.sin(x * 0.035 + y * 0.015 + self.x) * 0.4
            + math.cos(x * 0.012 - y * 0.042 + self.y) * 0.4
            + math.sin((x + y) * 0.071) * 0.2
        ) * 0.18

    def _moisture(self, x: float, y: float) -> float:
        mx = self.x + 3700
        base = (
            math.cos(x * 0.004 + mx) * math.sin(y * 0.004 + self.y) * 0.65
            + math.cos(y * 0.013 + self.y) * 0.35
        )
        return (base + 1.0) / 2.0 - self._detail(x, y)

    def _warp(self, x: float, y: float) -> tuple[float, float]:
        return (
            math.sin(y * 0.021 + self.x) * math.cos(x * 0.017 - self.y),
            math.cos(x * 0.019 + self.y) * math.sin(y * 0.023 - self.x),
        )

    def _symmetric(self, field: Callable[[float, float], float], x: float, y: float) -> float:
        return (field(x, y) + field(self.width - x, self.height - y)) / 2

    def wave(self, x: float, y: float) -> float:
        return self._symmetric(self._wave, x, y)

    def detail(self, x: float, y: float) -> float:
        return self._symmetric(self._detail, x, y)

    def moisture(self, x: float, y: float) -> float:
        return self._symmetric(self._moisture, x, y)

    def warp(self, x: float, y: float) -> tuple[float, float]:
        (ax, ay), (bx, by) = self._warp(x, y), self._warp(self.width - x, self.height - y)
        return (ax - bx) / 2 * WARP, (ay - by) / 2 * WARP


def background_path(map_path: str | Path) -> Path:
    """``maps/<id>.json`` -> ``maps/<id>.bg.png`` (served by the server, map-format.md)."""
    path = Path(map_path)
    return path.with_name(f"{path.stem}.bg.png")


def map_seed(mapdef: MapDef) -> int:
    """Default seed: stable across runs and Python versions (no ``hash()``)."""
    key = f"{mapdef.meta.name}:{mapdef.meta.version}".encode()
    return int.from_bytes(hashlib.blake2b(key, digest_size=8).digest(), "big")


def _density(mapdef: MapDef, cols: int, rows: int) -> list[float]:
    """Metaball density per cell: cities and roads splatted inside ``INFLUENCE_RADIUS``."""
    radius = INFLUENCE_RADIUS
    density = [0.0] * (cols * rows)

    def splat(x0: float, y0: float, x1: float, y1: float, weight: float) -> None:
        dx, dy = x1 - x0, y1 - y0
        seg_len_sq = dx * dx + dy * dy
        gx0 = max(0, int((min(x0, x1) - radius) // STEP))
        gx1 = min(cols - 1, int((max(x0, x1) + radius) // STEP))
        gy0 = max(0, int((min(y0, y1) - radius) // STEP))
        gy1 = min(rows - 1, int((max(y0, y1) + radius) // STEP))
        for gy in range(gy0, gy1 + 1):
            y = gy * STEP + STEP / 2
            for gx in range(gx0, gx1 + 1):
                x = gx * STEP + STEP / 2
                t = 0.0
                if seg_len_sq > 0:
                    t = max(0.0, min(1.0, ((x - x0) * dx + (y - y0) * dy) / seg_len_sq))
                d = math.hypot(x0 + t * dx - x, y0 + t * dy - y)
                if d < radius:
                    density[gy * cols + gx] += weight * (1.0 - (d / radius) ** 2) ** 2

    for node in mapdef.nodes:
        splat(node.x, node.y, node.x, node.y, NODE_WEIGHT)
    for edge in mapdef.edges:
        a, b = mapdef.nodes[edge.a], mapdef.nodes[edge.b]
        splat(a.x, a.y, b.x, b.y, 1.0)
    return density


def _cell(mapdef: MapDef, x: float, y: float, density: float, noise: _Noise) -> Cell:
    total = density + noise.wave(x, y)
    threshold = LAND_THRESHOLD - density * 0.15
    if total <= threshold:
        deep = total <= threshold - SHALLOW_BAND
        return Cell(Biome.DEEP_SEA if deep else Biome.SHALLOW_SEA, 1.0)

    detail = noise.detail(x, y)
    shade = 1.0 + detail * 0.5
    if total < LAND_THRESHOLD + SHORE_BAND:
        return Cell(Biome.BEACH, shade)
    # The area of a node is its Voronoi cell, with borders warped so they are not straight.
    dx, dy = noise.warp(x, y)
    wx, wy = x + dx, y + dy
    nearest = min(mapdef.nodes, key=lambda n: ((n.x - wx) ** 2 + (n.y - wy) ** 2, n.id))
    moisture = noise.moisture(x, y)
    if nearest.terrain is Terrain.PLAINS:
        return Cell(Biome.SAVANNA if moisture < 0.3 else Biome.STEPPE, shade)
    if nearest.terrain is Terrain.FOREST:
        return Cell(Biome.JUNGLE if moisture >= 0.65 else Biome.FOREST, shade)
    return Cell(Biome.SNOW if moisture >= SNOW_MOISTURE else Biome.ROCK, shade)


def bake_cells(mapdef: MapDef, seed: int | None = None) -> list[list[Cell]]:
    """Biome grid, ``height // STEP`` rows of ``width // STEP`` cells, row 0 at the top."""
    width, height = mapdef.meta.width, mapdef.meta.height
    if width % STEP or height % STEP:
        raise ValueError(
            f"{mapdef.meta.name}: width and height must be multiples of {STEP}, "
            f"got {width} x {height}"
        )
    cols, rows = width // STEP, height // STEP
    rng = random.Random(map_seed(mapdef) if seed is None else seed)
    offsets = (rng.uniform(0, 1000), rng.uniform(-5000, 5000), rng.uniform(-5000, 5000))
    noise = _Noise(*offsets, width, height)
    density = _density(mapdef, cols, rows)
    count = cols * rows
    # Cell i and cell count-1-i are turned into each other by rot180 (their centres are
    # (x, y) and (width - x, height - y)), so the second half is the first one reversed.
    half: list[Cell] = []
    for i in range((count + 1) // 2):
        gy, gx = divmod(i, cols)
        half.append(_cell(mapdef, gx * STEP + STEP / 2, gy * STEP + STEP / 2, density[i], noise))
    cells = half + half[: count // 2][::-1]
    return [cells[r * cols : (r + 1) * cols] for r in range(rows)]


def _colour(cell: Cell) -> bytes:
    return bytes(min(255, round(c * cell.shade)) for c in BIOME_COLOUR[cell.biome])


def render_rgb(mapdef: MapDef, seed: int | None = None) -> bytes:
    """RGB pixels, ``width x height``, row by row from the top: each cell is a STEP block."""
    rows: list[bytes] = []
    for cell_row in bake_cells(mapdef, seed):
        line = b"".join(_colour(cell) * STEP for cell in cell_row)
        rows += [line] * STEP
    return b"".join(rows)


def encode_png(width: int, height: int, rgb: bytes) -> bytes:
    """8-bit RGB PNG, filter 0 on every row, no metadata chunks."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    stride = width * 3
    raw = b"".join(b"\x00" + rgb[r * stride : (r + 1) * stride] for r in range(height))
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def bake_background(mapdef: MapDef, out: str | Path, seed: int | None = None) -> None:
    rgb = render_rgb(mapdef, seed)
    Path(out).write_bytes(encode_png(mapdef.meta.width, mapdef.meta.height, rgb))
