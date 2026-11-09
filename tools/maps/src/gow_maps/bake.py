"""Map background baker (MAP-05, #344): ``maps/<id>.json`` -> ``maps/<id>.bg.webp``.

The biome field comes from the Pygame prototype map generator (git tag ``v0-pygame-prototype``,
path ``rts_core/game_logic/World/MapGenerator.py``). There is no water (DEC-27, item 3: the owner
finds it confusing): every cell is land, unless the map has a geography of DEC-36
(``gow_maps.geo``, which paints water over the picture of this module). The biome comes from the
terrain of the nearest city (Voronoi area of the node, borders warped so they are not straight):
plains, forest, mountains. The prototype moisture and detail noise only pick a variant inside that
terrain (steppe or savanna, forest or jungle, rock or snow). The field is sampled on a ``STEP``
grid (``bake_cells``), exactly as before #344, so the layout of biomes stays recognisable.

The picture is the map "III Intaglio" chosen by the owner (#826, round 2; ui-style.md, section 51;
mockup: docs/design/mockups/out-of-game-style-r2.html), built on the layout of the texture T2
(ui-style.md, 26.3):

* toned stone: the ground of a biome in two dark, muted tones of its own hue (soft blotches, no
  light, no relief shading);
* a narrow band of colour (about 14 px) between biomes that wanders along a noise field;
* every biome carved with its own sign (furrows, drilled points, crowns, chevrons): a dark cut with
  a lit lip, thinning out and shrinking towards the edge of the biome, so the transition reads as
  an ecotone and not as a seam;
* a little film grain on top.

The water of a map with a geography (``gow_maps.geo``) is dark stone too, engraved with lines that
follow the shores, and the coast is a cut rule.

Next to the background the bake writes its thumbnail ``maps/<id>.thumb.webp`` (#839): the same
picture ``THUMB_WIDTH`` pixels wide, under the graph of a map card in the lobby and the replays.

The picture covers exactly the world rectangle ``[0, width] x [0, height]`` at one pixel per world
unit, so the client stretches nothing: the sprite sits at ``(0, 0)`` with the map's own size.

The result is deterministic for a pinned numpy and Pillow: every random field comes from
``numpy.random.default_rng`` seeded by the map name and version, a pinned seed or an explicit
seed, the biome noise offsets from ``random.Random`` with the same seed. The picture is not
required to be symmetric (DEC-27, item 1): every cell looks up its own nearest node. The file is
lossy WebP (libwebp of the Pillow wheel), so its bytes may differ between platforms: compare pixels
with a tolerance, never bytes (``tools/maps/tests/test_bake.py``).
"""

import hashlib
import io
import random
from collections.abc import Callable
from enum import StrEnum
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray
from PIL import Image, ImageDraw

from gow_sim.maps import MapDef, Terrain

STEP = 4  # world units per sampled cell (prototype MapGenerator.STEP)
SNOW_MOISTURE = 0.7  # mountain cells this moist are snow (prototype: cold and moist is snow)
WARP = 40.0  # world units: how far the borders between node areas wander

WEBP_QUALITY = 85
MAX_WEBP_BYTES = 500_000  # #344: every background file is at most 0.5 MB
THUMB_WIDTH = 200  # #839: the map card is 96 px wide; twice that for a dense screen, and a margin
THUMB_QUALITY = 72
SUPERSAMPLE = 3  # the detail layer is drawn 3x larger and reduced, for smooth edges
BLEND_RADIUS = 7  # box-blur radius of the biome weights: the band between biomes is about 14 px
BAND_WOBBLE = 0.10  # amplitude of the noise that makes the band wander
GRAIN = 2.4  # standard deviation of the film grain, in 0..255 units


class Biome(StrEnum):
    STEPPE = "steppe"
    SAVANNA = "savanna"
    FOREST = "forest"
    JUNGLE = "jungle"
    ROCK = "rock"
    SNOW = "snow"


BIOMES: tuple[Biome, ...] = tuple(Biome)  # index of a biome in the weight arrays

# Land biomes each terrain may produce.
TERRAIN_BIOMES: dict[Terrain, frozenset[Biome]] = {
    Terrain.PLAINS: frozenset({Biome.STEPPE, Biome.SAVANNA}),
    Terrain.FOREST: frozenset({Biome.FOREST, Biome.JUNGLE}),
    Terrain.MOUNTAINS: frozenset({Biome.ROCK, Biome.SNOW}),
}

TERRAINS: tuple[Terrain, ...] = tuple(Terrain)

Rgb = tuple[int, int, int]
Field = NDArray[np.float32]
Grid = NDArray[np.floating[Any]]
Image8 = NDArray[np.uint8]

# Two ground tones per biome (patches of one and the other): the toned stone of Intaglio (#826,
# round 2 variant III; #842), each terrain its own hue, all of them dark and muted under the pieces.
GROUND: dict[Biome, tuple[Rgb, Rgb]] = {
    Biome.STEPPE: ((70, 82, 56), (76, 88, 60)),
    Biome.SAVANNA: ((104, 92, 58), (112, 98, 62)),
    Biome.FOREST: ((40, 68, 46), (44, 74, 50)),
    Biome.JUNGLE: ((32, 60, 52), (36, 66, 56)),
    Biome.ROCK: ((80, 75, 70), (88, 82, 76)),
    Biome.SNOW: ((152, 152, 146), (162, 162, 156)),
}


class _Noise:
    """Prototype noise fields (formulas as in the prototype); ``x`` and ``y`` are the offsets.

    The methods take numpy arrays (all the cells at once) as well as plain floats.
    """

    def __init__(self, x: float, y: float) -> None:
        self.x = x
        self.y = y

    def detail(self, x: Grid, y: Grid) -> Grid:
        return (
            np.sin(x * 0.035 + y * 0.015 + self.x) * 0.4
            + np.cos(x * 0.012 - y * 0.042 + self.y) * 0.4
            + np.sin((x + y) * 0.071) * 0.2
        ) * 0.18

    def moisture(self, x: Grid, y: Grid) -> Grid:
        mx = self.x + 3700
        base = (
            np.cos(x * 0.004 + mx) * np.sin(y * 0.004 + self.y) * 0.65
            + np.cos(y * 0.013 + self.y) * 0.35
        )
        return (base + 1.0) / 2.0 - self.detail(x, y)

    def warp(self, x: Grid, y: Grid) -> tuple[Grid, Grid]:
        return (
            np.sin(y * 0.021 + self.x) * np.cos(x * 0.017 - self.y) * WARP,
            np.cos(x * 0.019 + self.y) * np.sin(y * 0.023 - self.x) * WARP,
        )


def background_path(map_path: str | Path) -> Path:
    """``maps/<id>.json`` -> ``maps/<id>.bg.webp`` (served by the server, map-format.md)."""
    path = Path(map_path)
    return path.with_name(f"{path.stem}.bg.webp")


def thumb_path(background: str | Path) -> Path:
    """``maps/<id>.bg.webp`` -> ``maps/<id>.thumb.webp`` (bundled by the client, #839)."""
    path = Path(background)
    return path.with_name(f"{path.name.removesuffix('.bg.webp')}.thumb.webp")


# Seeds of the maps that were renamed in #390 (the Russian ids became English): they keep the seed
# of the old ``name:version`` so the baked backgrounds stayed the same pictures. Any new map, or a
# map not listed here, uses the default seed. Keyed by the current map name.
PINNED_SEEDS: dict[str, int] = {
    "artery": 16042865726214378278,  # arteriya:2
    "web": 11212474857736785236,  # pautina:2
    "pass": 10994672548035436809,  # pereval:2
    "ridge": 1700639690546766349,  # hrebet:1
    "crossroads": 8978241204212138798,  # perekrestki:1
    "highway": 4785048121517087569,  # trakt:1
}


def map_seed(mapdef: MapDef) -> int:
    """Seed of a map: pinned (``PINNED_SEEDS``) or derived from name and version.

    The derived seed is stable across runs and Python versions (no ``hash()``).
    """
    pinned = PINNED_SEEDS.get(mapdef.meta.name)
    if pinned is not None:
        return pinned
    key = f"{mapdef.meta.name}:{mapdef.meta.version}".encode()
    return int.from_bytes(hashlib.blake2b(key, digest_size=8).digest(), "big")


def map_noise(mapdef: MapDef, seed: int | None = None) -> _Noise:
    """The noise of a map: offsets from ``random.Random`` seeded like the whole bake."""
    rng = random.Random(map_seed(mapdef) if seed is None else seed)
    return _Noise(rng.uniform(-5000, 5000), rng.uniform(-5000, 5000))


def cell_centres(mapdef: MapDef) -> tuple[Grid, Grid]:
    """World coordinates of the cell centres (``height // STEP`` rows, row 0 at the top)."""
    width, height = mapdef.meta.width, mapdef.meta.height
    if width % STEP or height % STEP:
        raise ValueError(
            f"{mapdef.meta.name}: width and height must be multiples of {STEP}, "
            f"got {width} x {height}"
        )
    x, y = np.meshgrid(
        np.arange(width // STEP) * STEP + STEP / 2, np.arange(height // STEP) * STEP + STEP / 2
    )
    return x, y


def cell_indices(mapdef: MapDef, seed: int | None) -> NDArray[np.uint8]:
    """Biome index (position in ``BIOMES``) of every cell, ``height // STEP`` rows of cells."""
    x, y = cell_centres(mapdef)
    noise = map_noise(mapdef, seed)
    # The area of a node is its Voronoi cell, with borders warped so they are not straight. The
    # nearest node wins; on a tie the lower id (nodes are sorted by id, argmin takes the first).
    dx, dy = noise.warp(x, y)
    nodes = sorted(mapdef.nodes, key=lambda n: n.id)
    dist = np.stack([(n.x - (x + dx)) ** 2 + (n.y - (y + dy)) ** 2 for n in nodes])
    terrain = np.array([TERRAINS.index(n.terrain) for n in nodes], dtype=np.uint8)[dist.argmin(0)]
    return biome_indices(terrain, noise.moisture(x, y))


def biome_indices(terrain: NDArray[np.uint8], moisture: Grid) -> NDArray[np.uint8]:
    """Biome index of every cell from the index of its terrain (in ``TERRAINS``) and moisture."""
    out = np.where(
        terrain == TERRAINS.index(Terrain.PLAINS),
        np.where(moisture < 0.3, BIOMES.index(Biome.SAVANNA), BIOMES.index(Biome.STEPPE)),
        np.where(
            terrain == TERRAINS.index(Terrain.FOREST),
            np.where(moisture >= 0.65, BIOMES.index(Biome.JUNGLE), BIOMES.index(Biome.FOREST)),
            np.where(moisture >= SNOW_MOISTURE, BIOMES.index(Biome.SNOW), BIOMES.index(Biome.ROCK)),
        ),
    )
    return out.astype(np.uint8)


def bake_cells(mapdef: MapDef, seed: int | None = None) -> list[list[Biome]]:
    """Biome grid, ``height // STEP`` rows of ``width // STEP`` cells, row 0 at the top."""
    return [[BIOMES[i] for i in row] for row in cell_indices(mapdef, seed).tolist()]


# ---- numeric helpers ---------------------------------------------------------------------------
def _smoothstep(lo: float, hi: float, x: Field) -> Field:
    t = np.clip((x - lo) / (hi - lo), 0.0, 1.0)
    return (t * t * (3.0 - 2.0 * t)).astype(np.float32)


def _value_noise(h: int, w: int, period: int, rng: np.random.Generator) -> Field:
    """Smooth random field in [-1, 1]: a coarse random grid upscaled bicubically."""
    ch, cw = h // period + 3, w // period + 3
    coarse = rng.random((ch, cw), dtype=np.float32) * 2.0 - 1.0
    big = Image.fromarray(coarse, "F").resize((cw * period, ch * period), Image.Resampling.BICUBIC)
    return np.asarray(big, dtype=np.float32)[:h, :w]


def fbm(h: int, w: int, period: int, octaves: int, rng: np.random.Generator) -> Field:
    total = np.zeros((h, w), dtype=np.float32)
    amp, norm = 1.0, 0.0
    for k in range(octaves):
        total += amp * _value_noise(h, w, max(2, period >> k), rng)
        norm += amp
        amp *= 0.5
    return np.asarray(total / norm, dtype=np.float32)


def _box(a: Field, r: int, axis: int) -> Field:
    """Moving average of width ``2 r + 1`` along ``axis`` (edge values repeated), by cumsum."""
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r + 1, r)
    cs = np.cumsum(np.pad(a, pad, mode="edge"), axis=axis, dtype=np.float32)
    n = a.shape[axis]
    hi = [slice(None)] * a.ndim
    lo = [slice(None)] * a.ndim
    hi[axis] = slice(2 * r + 1, 2 * r + 1 + n)
    lo[axis] = slice(0, n)
    return (cs[tuple(hi)] - cs[tuple(lo)]) / np.float32(2 * r + 1)


def blur(a: Field, radius: int) -> Field:
    """Gaussian-like blur of the last two axes: three box passes."""
    out = a
    for _ in range(3):
        out = _box(_box(out, radius, a.ndim - 1), radius, a.ndim - 2)
    return out


def lerp(a: Rgb, b: Rgb, t: Field) -> Field:
    ca = np.array(a, dtype=np.float32)
    cb = np.array(b, dtype=np.float32)
    return np.asarray(ca + (cb - ca) * t[..., None], dtype=np.float32)


def _normalise(w: Field) -> Field:
    w = np.clip(w, 0.0, None)
    return np.asarray(w / np.maximum(w.sum(axis=0, keepdims=True), 1e-6), dtype=np.float32)


# ---- details: flat sprites drawn into a supersampled layer ---------------------------------------
Draw = ImageDraw.ImageDraw


def _ellipse(d: Draw, x: float, y: float, rx: float, ry: float, fill: Rgb) -> None:
    s = SUPERSAMPLE
    d.ellipse([(x - rx) * s, (y - ry) * s, (x + rx) * s, (y + ry) * s], fill=fill)


def _line(d: Draw, pts: list[tuple[float, float]], fill: Rgb, width: float) -> None:
    d.line(
        [(px * SUPERSAMPLE, py * SUPERSAMPLE) for px, py in pts],
        fill=fill,
        width=max(1, round(width * SUPERSAMPLE)),
    )


Sign = Callable[[Draw, float, float, float, np.random.Generator], None]

# Intaglio (#826, round 2 variant III; #842): every terrain is carved with its own sign. A cut is a
# dark stroke with a lighter lip just below and to the right of it (light from the upper left), so
# the sign reads as incised into the stone, not painted on it.
CUT: Rgb = (12, 10, 8)
LIP_OFFSET = (0.7, 0.8)  # world units: where the lip of a cut lies


def _lip(rgb: Rgb, k: float = 1.7) -> Rgb:
    """The lit lip of a cut into a ground of colour ``rgb``."""
    r, g, b = (min(255, int(c * k + 14)) for c in rgb)
    return (r, g, b)


def _cut(d: Draw, pts: list[tuple[float, float]], lip: Rgb, width: float, cut: Rgb = CUT) -> None:
    ox, oy = LIP_OFFSET
    _line(d, [(x + ox, y + oy) for x, y in pts], lip, width)
    _line(d, pts, cut, width)


def _furrow(d: Draw, x: float, y: float, s: float, rng: np.random.Generator) -> None:
    """Steppe: two short parallel furrows."""
    lip = _lip(GROUND[Biome.STEPPE][0])
    for dy in (-1.6, 1.6):
        ln = (2.6 + 1.4 * rng.random()) * s
        _cut(d, [(x - ln, y + dy), (x + ln, y + dy)], lip, 0.9)


def _drill(d: Draw, x: float, y: float, s: float, rng: np.random.Generator) -> None:
    """Savanna: three drilled points."""
    lip = _lip(GROUND[Biome.SAVANNA][0], 1.5)
    for _ in range(3):
        cx, cy = x + (rng.random() - 0.5) * 7, y + (rng.random() - 0.5) * 6
        rr = 0.8 + 0.5 * rng.random()
        _ellipse(d, cx + 0.6, cy + 0.7, rr, rr, lip)
        _ellipse(d, cx, cy, rr, rr, CUT)


def _crown(base: Rgb, size: float) -> Sign:
    """Forest and jungle: a crown cut round, its middle left a little darker than the ground."""
    lip = _lip(base, 1.9)
    inner: Rgb = (int(base[0] * 0.82), int(base[1] * 0.82), int(base[2] * 0.82))

    def draw(d: Draw, x: float, y: float, s: float, rng: np.random.Generator) -> None:
        rr = (size + 1.6 * rng.random()) * s
        _ellipse(d, x + 0.8, y + 0.9, rr, rr, lip)
        _ellipse(d, x, y, rr, rr, CUT)
        _ellipse(d, x - 0.2, y - 0.2, rr * 0.62, rr * 0.62, inner)

    return draw


def _chevron(base: Rgb, k: float, cut: Rgb) -> Sign:
    """Rock and snow: a peak as a chevron, sometimes with a second stroke on its flank."""
    lip = _lip(base, k)

    def draw(d: Draw, x: float, y: float, s: float, rng: np.random.Generator) -> None:
        sz = (4.0 + 2.2 * rng.random()) * s
        pts = [(x - sz, y + sz * 0.55), (x, y - sz * 0.6), (x + sz, y + sz * 0.55)]
        _cut(d, pts, lip, 1.1, cut)
        if rng.random() < 0.55:
            _line(d, [(x - sz * 0.5, y + sz * 0.05), (x, y - sz * 0.25)], cut, 0.8)

    return draw


# Grid step of the signs of a biome (world units) and the function that cuts one sign.
SPRITES: dict[Biome, tuple[int, Sign]] = {
    Biome.STEPPE: (11, _furrow),
    Biome.SAVANNA: (12, _drill),
    Biome.FOREST: (10, _crown(GROUND[Biome.FOREST][0], 3.7)),
    Biome.JUNGLE: (11, _crown(GROUND[Biome.JUNGLE][0], 4.4)),
    Biome.ROCK: (15, _chevron(GROUND[Biome.ROCK][0], 1.75, CUT)),
    Biome.SNOW: (17, _chevron(GROUND[Biome.SNOW][0], 1.12, (92, 92, 88))),
}


# ---- the picture ---------------------------------------------------------------------------------
def _ground(biome: Biome, h: int, w: int, rng: np.random.Generator) -> Field:
    """Flat ground of a biome: two tones in soft blotches and a quiet mid-frequency variation."""
    blotch = _smoothstep(-0.18, 0.18, fbm(h, w, 90, 3, rng) * 1.6)
    out = lerp(*GROUND[biome], blotch)
    out += fbm(h, w, 7, 2, rng)[..., None] * 3.0
    return out


def _weights(labels: NDArray[np.uint8], rng: np.random.Generator) -> tuple[Field, Field]:
    """Ground blend (6, h, w) and detail density (6, h, w): a narrow meandering band, thinning."""
    h, w = labels.shape
    onehot = np.stack([(labels == i) for i in range(len(BIOMES))]).astype(np.float32)
    soft = blur(onehot, BLEND_RADIUS)
    wobbled = np.stack(
        [soft[i] + BAND_WOBBLE * fbm(h, w, 40, 3, rng) for i in range(len(BIOMES))]
    ).astype(np.float32)
    mask = _normalise(wobbled)
    wide = _normalise(np.asarray(blur(onehot, BLEND_RADIUS + 4) + 0.08 * wobbled, np.float32))
    density = np.clip((wide - 0.12) / 0.7, 0.0, 1.0) ** 1.25
    return mask, density.astype(np.float32)


def _details(
    density: Field, step: int, rng: np.random.Generator
) -> list[tuple[float, float, float]]:
    """Details of one biome as ``(x, y, density)``, top to bottom.

    A jittered grid of ``step`` pixels; a detail stays where the density field says so, with
    that probability, and the density also scales it (details shrink towards the edge).
    """
    h, w = density.shape
    xs = np.arange(0, w, step, dtype=np.float64)
    ys = np.arange(0, h, step, dtype=np.float64)
    shape = (len(ys), len(xs))
    jx: Grid = xs[None, :] + (rng.random(shape) - 0.5) * step * 0.9
    jy: Grid = ys[:, None] + (rng.random(shape) - 0.5) * step * 0.9
    p = density[np.clip(jy, 0, h - 1).astype(np.intp), np.clip(jx, 0, w - 1).astype(np.intp)]
    keep: NDArray[np.bool_] = rng.random(shape) < p
    x, y, q = jx[keep], jy[keep], p[keep]
    order = np.argsort(y)  # top to bottom, so lower details lie over higher ones
    return list(zip(x[order].tolist(), y[order].tolist(), q[order].tolist(), strict=True))


def render_background(mapdef: MapDef, seed: int | None = None) -> Image8:
    """RGB pixels (``height x width x 3``, row 0 at the top) of the background of a map."""
    return render_cells(mapdef, cell_indices(mapdef, seed), seed)


Paint = Callable[[Field], Field]


def render_cells(
    mapdef: MapDef,
    cells: NDArray[np.uint8],
    seed: int | None = None,
    thin: Field | None = None,
    paint: Paint | None = None,
    finish: Paint | None = None,
) -> Image8:
    """The T2 picture of a biome grid (``cells``: one biome index per ``STEP`` cell).

    ``thin`` (``height x width``, 0..1) scales the density of the details (DEC-36: they thin out
    toward a shore); ``paint`` draws over the finished ground and details, before the grain;
    ``finish`` draws over the grain (fine engraved lines that must stay crisp).
    """
    seq = np.random.SeedSequence(map_seed(mapdef) if seed is None else seed)
    rngs = [np.random.default_rng(child) for child in seq.spawn(3 + len(BIOMES))]
    rng_band, rng_sprites, rng_grain, *rng_ground = rngs

    labels = np.repeat(np.repeat(cells, STEP, 0), STEP, 1)
    h, w = labels.shape
    mask, density = _weights(labels, rng_band)
    if thin is not None:
        density = np.asarray(density * thin[None], dtype=np.float32)

    ground = np.zeros((h, w, 3), dtype=np.float32)
    for i, biome in enumerate(BIOMES):
        ground += mask[i][..., None] * _ground(biome, h, w, rng_ground[i])
    base = Image.fromarray(np.clip(ground, 0, 255).astype(np.uint8), "RGB")
    base = base.resize((w * SUPERSAMPLE, h * SUPERSAMPLE), Image.Resampling.BILINEAR)
    draw = ImageDraw.Draw(base)
    for i, biome in enumerate(BIOMES):
        step, sprite = SPRITES[biome]
        for x, y, q in _details(density[i], step, rng_sprites):
            sprite(draw, x, y, 0.55 + 0.45 * q, rng_sprites)
    flat = np.asarray(base.reduce(SUPERSAMPLE), dtype=np.float32)
    if paint is not None:
        flat = paint(flat)
    flat = flat + rng_grain.normal(0, GRAIN, flat.shape[:2]).astype(np.float32)[..., None]
    if finish is not None:
        flat = finish(flat)
    return np.clip(flat, 0, 255).astype(np.uint8)


def encode_webp(pixels: Image8) -> bytes:
    """Lossy WebP of RGB pixels (quality ``WEBP_QUALITY``, slowest and smallest method)."""
    buf = io.BytesIO()
    Image.fromarray(pixels, "RGB").save(buf, "WEBP", quality=WEBP_QUALITY, method=6)
    return buf.getvalue()


def encode_thumb(pixels: Image8) -> bytes:
    """Lossy WebP of the picture ``THUMB_WIDTH`` pixels wide (its aspect kept)."""
    image = Image.fromarray(pixels, "RGB")
    height = max(1, round(image.height * THUMB_WIDTH / max(1, image.width)))
    small = image.resize((THUMB_WIDTH, height), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    small.save(buf, "WEBP", quality=THUMB_QUALITY, method=6)
    return buf.getvalue()


def write_thumb(background: str | Path) -> Path:
    """Write the thumbnail of a baked background file next to it; returns its path."""
    with Image.open(background) as image:
        pixels: Image8 = np.asarray(image.convert("RGB"), dtype=np.uint8)
    out = thumb_path(background)
    out.write_bytes(encode_thumb(pixels))
    return out


def bake_background(mapdef: MapDef, out: str | Path, seed: int | None = None) -> None:
    """Write ``out`` (WebP). Raises ``ValueError``, writing nothing, if it is over the budget."""
    write_background(mapdef, render_background(mapdef, seed), out)


def write_background(mapdef: MapDef, pixels: Image8, out: str | Path) -> None:
    """Write the pixels as ``out`` (WebP); ``ValueError``, writing nothing, over the budget."""
    data = encode_webp(pixels)
    if len(data) > MAX_WEBP_BYTES:
        raise ValueError(
            f"{mapdef.meta.name}: the background is {len(data)} bytes, "
            f"over the budget of {MAX_WEBP_BYTES}"
        )
    Path(out).write_bytes(data)
    thumb_path(out).write_bytes(encode_thumb(pixels))
