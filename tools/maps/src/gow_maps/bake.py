"""Map background baker (MAP-05): ``maps/<id>.json`` -> ``maps/<id>.bg.png``.

Colours and noise formulas come from the Pygame prototype map generator (git tag
``v0-pygame-prototype``, path ``rts_core/game_logic/World/MapGenerator.py``). There is no water
(DEC-27, item 3: the owner finds it confusing): every cell is land. The biome comes from the
terrain of the nearest city (Voronoi area of the node, borders warped so they are not straight):
plains, forest, mountains. The prototype moisture and detail noise only pick a variant inside that
terrain (steppe or savanna, forest or jungle, rock or snow) and shade it.

The picture covers exactly the world rectangle ``[0, width] x [0, height]`` at one pixel per world
unit, so the client stretches nothing: the sprite sits at ``(0, 0)`` with the map's own size.
The field is sampled on a ``STEP`` grid (as in the prototype) and every cell is a
``STEP x STEP`` block.

The result is deterministic: noise offsets come from ``random.Random`` seeded by the map name and
version (or an explicit seed). The picture is not required to be symmetric (DEC-27, item 1): every
cell looks up its own nearest node. The PNG is written with the standard library (zlib), no image
library is needed.
"""

import hashlib
import math
import random
import struct
import zlib
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

from gow_sim.maps import MapDef, Terrain

STEP = 4  # world units per sampled cell (prototype MapGenerator.STEP)
SNOW_MOISTURE = 0.7  # mountain cells this moist are snow (prototype: cold and moist is snow)
WARP = 40.0  # world units: how far the borders between node areas wander


class Biome(StrEnum):
    STEPPE = "steppe"
    SAVANNA = "savanna"
    FOREST = "forest"
    JUNGLE = "jungle"
    ROCK = "rock"
    SNOW = "snow"


# Prototype palette (rts_core/system/ChunkManager.py) where a prototype biome fits.
BIOME_COLOUR: dict[Biome, tuple[int, int, int]] = {
    Biome.STEPPE: (140, 170, 90),
    Biome.SAVANNA: (180, 190, 100),
    Biome.FOREST: (34, 139, 34),
    Biome.JUNGLE: (25, 100, 45),  # prototype (0, 100, 80) is teal and reads as water (DEC-27)
    Biome.ROCK: (125, 115, 100),
    Biome.SNOW: (235, 238, 240),
}

# Land biomes each terrain may produce.
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
    """Prototype noise fields; ``x`` and ``y`` are the random offsets of the map."""

    x: float
    y: float

    def detail(self, x: float, y: float) -> float:
        return (
            math.sin(x * 0.035 + y * 0.015 + self.x) * 0.4
            + math.cos(x * 0.012 - y * 0.042 + self.y) * 0.4
            + math.sin((x + y) * 0.071) * 0.2
        ) * 0.18

    def moisture(self, x: float, y: float) -> float:
        mx = self.x + 3700
        base = (
            math.cos(x * 0.004 + mx) * math.sin(y * 0.004 + self.y) * 0.65
            + math.cos(y * 0.013 + self.y) * 0.35
        )
        return (base + 1.0) / 2.0 - self.detail(x, y)

    def warp(self, x: float, y: float) -> tuple[float, float]:
        return (
            math.sin(y * 0.021 + self.x) * math.cos(x * 0.017 - self.y) * WARP,
            math.cos(x * 0.019 + self.y) * math.sin(y * 0.023 - self.x) * WARP,
        )


def background_path(map_path: str | Path) -> Path:
    """``maps/<id>.json`` -> ``maps/<id>.bg.png`` (served by the server, map-format.md)."""
    path = Path(map_path)
    return path.with_name(f"{path.stem}.bg.png")


def map_seed(mapdef: MapDef) -> int:
    """Default seed: stable across runs and Python versions (no ``hash()``)."""
    key = f"{mapdef.meta.name}:{mapdef.meta.version}".encode()
    return int.from_bytes(hashlib.blake2b(key, digest_size=8).digest(), "big")


def _cell(mapdef: MapDef, x: float, y: float, noise: _Noise) -> Cell:
    shade = 1.0 + noise.detail(x, y) * 0.5
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
    noise = _Noise(rng.uniform(-5000, 5000), rng.uniform(-5000, 5000))
    return [
        [_cell(mapdef, gx * STEP + STEP / 2, gy * STEP + STEP / 2, noise) for gx in range(cols)]
        for gy in range(rows)
    ]


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
