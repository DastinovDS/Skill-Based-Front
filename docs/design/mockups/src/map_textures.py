"""Prototype of improved biome textures for the mockup map-style-2.html (issue #332, round 2).

NOT project code and NOT a replacement of ``gow_maps.bake``: this is a throwaway generator that
answers one question for the owner, "what could the map background look like if the baker drew
cleaner textures and softer transitions between biomes". The game render and ``maps:bake`` are not
touched.

What it does
------------
* takes the biome grid of the real baker (``gow_maps.bake.bake_cells``), so the layout of biomes is
  the one of ``maps/<name>.bg.png`` that the game shows today;
* draws three variants of the transition between biomes (all with the same improved flat textures,
  no relief shading, no light direction):
    T1  ragged edge: a noise mask, no blend, details stop at the edge;
    T2  ecotone: a narrow colour blend, details (trees, tufts, stones) thin out and shrink;
    T3  soft gradient with grain: a wide blend, faint details, film grain;
* crops a fragment of the map (the one the mockup shows) and embeds the pictures into the mockup as
  base64 between the markers ``/*TEX:BEGIN*/`` and ``/*TEX:END*/``;
* prints the size of the whole-map picture as PNG, JPEG and WebP (an input for the decision, see
  the issue): noisy textures do not fit the PNG-by-zlib of today's baker.

Everything is deterministic for a pinned numpy (``numpy.random.default_rng`` with fixed seeds).
Pure numpy and Pillow, both already in ``uv.lock`` through matplotlib (a dependency of gow-maps);
no generative services, no foreign assets.

Run (from the repository root; about 1 minute)::

    uv run python docs/design/mockups/src/map_textures.py            # rewrite the data block
    uv run python docs/design/mockups/src/map_textures.py --out /tmp/tex   # also save the PNGs
"""

import argparse
import base64
import io
import json
import math
import re
import sys
import time
from pathlib import Path

import numpy as np
from numpy.typing import NDArray
from PIL import Image, ImageDraw

from gow_maps.bake import BIOME_COLOUR, STEP, Biome, bake_cells
from gow_sim.maps import load_map

ROOT = Path(__file__).resolve().parents[4]
HTML = ROOT / "docs" / "design" / "mockups" / "map-style-2.html"
SS = 3  # supersampling of the detail layer
CROP = (230, 130, 720, 580)  # x, y, width, height of the fragment in the mockup (world units)

BIOMES = [Biome.STEPPE, Biome.SAVANNA, Biome.FOREST, Biome.JUNGLE, Biome.ROCK, Biome.SNOW]
Arr = NDArray[np.float32]
Rgb = tuple[int, int, int]

# Two flat ground tones per biome (patches of one and the other), a little cleaner than the bake.
GROUND: dict[Biome, tuple[Rgb, Rgb]] = {
    Biome.STEPPE: ((124, 158, 86), (140, 172, 98)),
    Biome.SAVANNA: ((176, 178, 98), (192, 192, 110)),
    Biome.FOREST: ((40, 112, 52), (46, 124, 58)),
    Biome.JUNGLE: ((26, 88, 62), (30, 100, 70)),
    Biome.ROCK: ((122, 113, 100), (136, 127, 113)),
    Biome.SNOW: ((222, 229, 234), (234, 239, 243)),
}


# ---- numeric helpers -------------------------------------------------------------------------
def smoothstep(lo: float, hi: float, x: Arr) -> Arr:
    t = np.clip((x - lo) / (hi - lo), 0.0, 1.0)
    return (t * t * (3.0 - 2.0 * t)).astype(np.float32)


def value_noise(h: int, w: int, period: int, rng: np.random.Generator) -> Arr:
    """Smooth random field in [-1, 1]: a coarse random grid upscaled bicubically."""
    ch, cw = h // period + 3, w // period + 3
    coarse = rng.random((ch, cw), dtype=np.float32) * 2.0 - 1.0
    big = Image.fromarray(coarse, "F").resize((cw * period, ch * period), Image.Resampling.BICUBIC)
    return np.asarray(big, dtype=np.float32)[:h, :w]


def fbm(h: int, w: int, period: int, octaves: int, rng: np.random.Generator) -> Arr:
    total = np.zeros((h, w), dtype=np.float32)
    amp, norm = 1.0, 0.0
    for k in range(octaves):
        total += amp * value_noise(h, w, max(2, period >> k), rng)
        norm += amp
        amp *= 0.5
    return total / norm


def box(a: NDArray[np.float32], r: int, axis: int) -> NDArray[np.float32]:
    if r <= 0:
        return a
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r + 1, r)
    cs = np.cumsum(np.pad(a, pad, mode="edge"), axis=axis, dtype=np.float64)
    n = a.shape[axis]
    hi = np.take(cs, range(2 * r + 1, 2 * r + 1 + n), axis=axis)
    lo = np.take(cs, range(0, n), axis=axis)
    return ((hi - lo) / (2 * r + 1)).astype(np.float32)


def blur(a: NDArray[np.float32], sigma: float) -> NDArray[np.float32]:
    """Gaussian-like blur of the last two axes: three box passes (sigma is about the radius)."""
    r = max(0, round(sigma))
    out = a
    for _ in range(3):
        out = box(box(out, r, a.ndim - 1), r, a.ndim - 2)
    return out


def lerp3(a: Rgb, b: Rgb, t: Arr) -> Arr:
    ca = np.array(a, dtype=np.float32)
    cb = np.array(b, dtype=np.float32)
    return ca + (cb - ca) * t[..., None]


# ---- textures: flat ground + sprites of details ------------------------------------------------
def ground(biome: Biome, h: int, w: int, seed: int) -> Arr:
    """Flat ground of a biome: two tones in soft blotches and a quiet mid-frequency variation."""
    rng = np.random.default_rng(seed)
    blotch = smoothstep(-0.18, 0.18, fbm(h, w, 90, 3, rng) * 1.6)
    out = lerp3(*GROUND[biome], blotch)
    out += fbm(h, w, 7, 2, rng)[..., None] * 3.0
    return out


Draw = ImageDraw.ImageDraw


def _c(r: Rgb, a: int) -> tuple[int, int, int, int]:
    return (r[0], r[1], r[2], a)


def _ellipse(d: Draw, x: float, y: float, rx: float, ry: float, fill: tuple[int, ...]) -> None:
    d.ellipse([(x - rx) * SS, (y - ry) * SS, (x + rx) * SS, (y + ry) * SS], fill=fill)


def _poly(d: Draw, pts: list[tuple[float, float]], fill: tuple[int, ...]) -> None:
    d.polygon([(px * SS, py * SS) for px, py in pts], fill=fill)


def _line(d: Draw, pts: list[tuple[float, float]], fill: tuple[int, ...], width: float) -> None:
    d.line([(px * SS, py * SS) for px, py in pts], fill=fill, width=max(1, round(width * SS)))


def sprite_tree(d: Draw, x: float, y: float, s: float, rng: np.random.Generator, a: int) -> None:
    """A flat canopy seen from above: three concentric tones, no light direction."""
    r = (3.8 + 2.2 * rng.random()) * s
    _ellipse(d, x, y, r, r, _c((28, 88, 46), a))
    _ellipse(d, x, y, r * 0.76, r * 0.76, _c((38, 108, 56), a))
    _ellipse(d, x, y, r * 0.36, r * 0.36, _c((56, 130, 68), a))


def sprite_jungle(d: Draw, x: float, y: float, s: float, rng: np.random.Generator, a: int) -> None:
    r = (4.6 + 2.6 * rng.random()) * s
    _ellipse(d, x, y, r, r, _c((18, 70, 52), a))
    _ellipse(d, x, y, r * 0.74, r * 0.74, _c((26, 90, 66), a))
    for _ in range(3):
        ang = rng.random() * math.tau
        _ellipse(d, x + math.cos(ang) * r * 0.3, y + math.sin(ang) * r * 0.3, r * 0.2, r * 0.2,
                 _c((48, 122, 88), a))  # fmt: skip


def sprite_tuft(d: Draw, x: float, y: float, s: float, rng: np.random.Generator, a: int) -> None:
    tone = (88, 124, 62) if rng.random() < 0.8 else (150, 160, 80)
    for dx in (-2.2, 0.0, 2.2):
        _line(d, [(x + dx, y + 2 * s), (x + dx * 1.6, y - (2.6 + 1.6 * rng.random()) * s)],
              _c(tone, a), 1.0)  # fmt: skip


def sprite_dry(d: Draw, x: float, y: float, s: float, rng: np.random.Generator, a: int) -> None:
    for dx in (-2.4, 0.0, 2.4):
        _line(d, [(x + dx, y + 2 * s), (x + dx * 1.5, y - (2.0 + 1.5 * rng.random()) * s)],
              _c((140, 140, 72), a), 1.0)  # fmt: skip
    if rng.random() < 0.07:  # a rare flat-topped tree
        _ellipse(d, x, y, 7 * s, 3 * s, _c((96, 112, 52), a))


def sprite_rock(d: Draw, x: float, y: float, s: float, rng: np.random.Generator, a: int) -> None:
    """A cluster of flat stones: one tone darker than the ground, no facets, no light."""
    for _ in range(2 + int(rng.random() * 2)):
        cx, cy = x + (rng.random() - 0.5) * 10 * s, y + (rng.random() - 0.5) * 7 * s
        rr = (1.8 + 2.2 * rng.random()) * s
        k = 5 + int(rng.random() * 2)
        pts = [
            (cx + math.cos(i / k * math.tau + 0.6) * rr * (0.75 + 0.5 * rng.random()),
             cy + math.sin(i / k * math.tau + 0.6) * rr * (0.6 + 0.35 * rng.random()))
            for i in range(k)
        ]  # fmt: skip
        _poly(d, pts, _c((104, 96, 85), a))


def sprite_snow(d: Draw, x: float, y: float, s: float, rng: np.random.Generator, a: int) -> None:
    ang = (rng.random() - 0.5) * 0.6
    ln = (4 + 3 * rng.random()) * s
    _line(d, [(x - ln * math.cos(ang), y - ln * math.sin(ang) * 0.4),
              (x + ln * math.cos(ang), y + ln * math.sin(ang) * 0.4)],
          _c((176, 192, 206), a), 1.0)  # fmt: skip


SPRITES = {
    Biome.STEPPE: (11, sprite_tuft),
    Biome.SAVANNA: (13, sprite_dry),
    Biome.FOREST: (9, sprite_tree),
    Biome.JUNGLE: (10, sprite_jungle),
    Biome.ROCK: (16, sprite_rock),
    Biome.SNOW: (18, sprite_snow),
}


def compose(mask: Arr, density: Arr, grain: float, seed: int, shrink: bool, alpha: int) -> Arr:
    """Ground of the biomes blended by ``mask`` (6, h, w), sprites by ``density``, then grain."""
    _, h, w = mask.shape
    out = np.zeros((h, w, 3), dtype=np.float32)
    for i, biome in enumerate(BIOMES):
        out += mask[i][..., None] * ground(biome, h, w, seed + i)
    base = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")
    base = base.resize((w * SS, h * SS), Image.Resampling.BILINEAR)
    draw = ImageDraw.Draw(base, "RGBA")
    rng = np.random.default_rng(seed + 100)
    for i, biome in enumerate(BIOMES):
        step, fn = SPRITES[biome]
        ys, xs = np.mgrid[0:h:step, 0:w:step]
        jx = xs + (rng.random(xs.shape) - 0.5) * step * 0.9
        jy = ys + (rng.random(ys.shape) - 0.5) * step * 0.9
        px = np.clip(jx.astype(int), 0, w - 1)
        py = np.clip(jy.astype(int), 0, h - 1)
        p = density[i][py, px]
        keep = rng.random(xs.shape) < p
        order = np.argsort(jy[keep])
        for x, y, q in zip(jx[keep][order], jy[keep][order], p[keep][order], strict=True):
            scale = 0.55 + 0.45 * float(q) if shrink else 1.0
            fn(draw, float(x), float(y), scale, rng, alpha)
    flat = np.asarray(base.reduce(SS), dtype=np.float32)
    flat += np.random.default_rng(seed + 200).normal(0, grain, flat.shape[:2])[..., None]
    return np.clip(flat, 0, 255).astype(np.uint8)  # type: ignore[return-value]


# ---- the three transitions ---------------------------------------------------------------------
def biome_labels(mapdef_path: Path) -> NDArray[np.uint8]:
    mapdef = load_map(mapdef_path)
    grid = bake_cells(mapdef)
    index = {b: i for i, b in enumerate(BIOMES)}
    small = np.array([[index[c.biome] for c in row] for row in grid], dtype=np.uint8)
    return np.repeat(np.repeat(small, STEP, 0), STEP, 1)


def onehot(lab: NDArray[np.uint8]) -> Arr:
    return np.stack([(lab == i) for i in range(len(BIOMES))]).astype(np.float32)


def normalise(w: Arr) -> Arr:
    w = np.clip(w, 0.0, None)
    return w / np.maximum(w.sum(axis=0, keepdims=True), 1e-6)


def variant_t1(lab: NDArray[np.uint8]) -> tuple[Arr, Arr]:
    """Ragged edge: argmax of the blurred weights plus noise, a 1 px feather."""
    h, w = lab.shape
    rng = np.random.default_rng(11)
    soft = blur(onehot(lab), 4)
    noisy = np.stack(
        [soft[i] + 0.34 * fbm(h, w, 20, 3, rng) + 0.12 * fbm(h, w, 6, 2, rng)
         for i in range(len(BIOMES))]
    )  # fmt: skip
    hard = noisy.argmax(axis=0).astype(np.uint8)
    mask = blur(onehot(hard), 1)
    return normalise(mask), normalise(onehot(hard))


def variant_t2(lab: NDArray[np.uint8]) -> tuple[Arr, Arr]:
    """Ecotone: a narrow blend with a meandering band, details thin out and shrink."""
    h, w = lab.shape
    rng = np.random.default_rng(12)
    soft = blur(onehot(lab), 7)
    wob = np.stack([soft[i] + 0.10 * fbm(h, w, 40, 3, rng) for i in range(len(BIOMES))])
    mask = normalise(wob)
    wide = normalise(blur(onehot(lab), 11) + 0.08 * wob)
    density = np.clip((wide - 0.12) / 0.7, 0.0, 1.0) ** 1.25
    return mask, density.astype(np.float32)


def variant_t3(lab: NDArray[np.uint8]) -> tuple[Arr, Arr]:
    """Soft gradient with grain: a wide blend, faint details."""
    mask = normalise(blur(onehot(lab), 22))
    return mask, (mask**2.2 * 0.62).astype(np.float32)


# ---- output ------------------------------------------------------------------------------------
def encode(img: Image.Image, kind: str) -> bytes:
    buf = io.BytesIO()
    if kind == "png":
        img.save(buf, "PNG", optimize=True)
    elif kind == "jpeg":
        img.save(buf, "JPEG", quality=86, optimize=True, progressive=True)
    else:
        img.save(buf, "WEBP", quality=85, method=6)
    return buf.getvalue()


def data_uri(img: Image.Image, kind: str) -> str:
    mime = {"png": "image/png", "jpeg": "image/jpeg", "webp": "image/webp"}[kind]
    return f"data:{mime};base64," + base64.b64encode(encode(img, kind)).decode()


def swatches(current: bool) -> Image.Image:
    """One strip, a tile per biome (200 x 150): the baker today or the improved texture."""
    tw, th, n = 200, 150, len(BIOMES)
    if current:
        rows = []
        for i, biome in enumerate(BIOMES):
            ys, xs = np.mgrid[0:th, 0:tw].astype(np.float32)
            gx, gy = (xs + i * 300) // STEP * STEP, ys // STEP * STEP
            detail = (
                np.sin(gx * 0.035 + gy * 0.015 + 1.3) * 0.4
                + np.cos(gx * 0.012 - gy * 0.042 + 2.1) * 0.4
                + np.sin((gx + gy) * 0.071) * 0.2
            ) * 0.18
            shade = 1.0 + detail * 0.5
            rows.append(
                np.clip(np.array(BIOME_COLOUR[biome])[None, None, :] * shade[..., None], 0, 255)
            )
        return Image.fromarray(np.concatenate(rows, axis=1).astype(np.uint8), "RGB")
    onehot_w = np.zeros((n, th, tw * n), dtype=np.float32)
    for i in range(n):
        onehot_w[i, :, i * tw : (i + 1) * tw] = 1.0
    return Image.fromarray(compose(onehot_w, onehot_w, 2.0, 5, False, 255), "RGB")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--map", default="arteriya", help="map name in maps/ (default arteriya)")
    ap.add_argument("--out", type=Path, help="also save the full-map PNGs here")
    ap.add_argument("--no-embed", action="store_true", help="do not rewrite the mockup")
    args = ap.parse_args()

    started = time.time()
    map_path = ROOT / "maps" / f"{args.map}.json"
    lab = biome_labels(map_path)
    h, w = lab.shape
    x0, y0, cw, ch = CROP
    box_ = (x0, y0, x0 + cw, y0 + ch)

    pictures: dict[str, Image.Image] = {}
    sizes: dict[str, dict[str, int]] = {}
    current = Image.open(ROOT / "maps" / f"{args.map}.bg.png").convert("RGB")
    pictures["t0"] = current
    jobs = {
        "t1": (variant_t1, 1.6, False, 255),
        "t2": (variant_t2, 2.4, True, 255),
        "t3": (variant_t3, 5.0, False, 120),
    }
    for key, (fn, grain, shrink, alpha) in jobs.items():
        mask, density = fn(lab)
        rgb = compose(mask, density, grain, 40, shrink, alpha)
        pictures[key] = Image.fromarray(rgb, "RGB")
        print(f"{key}: {time.time() - started:5.1f} s", file=sys.stderr)
    for key, pic in pictures.items():
        sizes[key] = {k: len(encode(pic, k)) for k in ("png", "jpeg", "webp")}
        if args.out:
            args.out.mkdir(parents=True, exist_ok=True)
            pic.save(args.out / f"{args.map}-{key}.png")

    data = {
        "map": args.map,
        "crop": list(CROP),
        "full": [w, h],
        "sizes": sizes,
        "t": {
            k: data_uri(p.crop(box_), "png" if k == "t0" else "jpeg") for k, p in pictures.items()
        },
        "swatch": {
            "now": data_uri(swatches(True), "png"),
            "new": data_uri(swatches(False), "jpeg"),
        },
    }
    print(json.dumps(sizes, indent=1))
    if not args.no_embed:
        text = HTML.read_text(encoding="utf-8")
        block = "/*TEX:BEGIN*/window.TEX=" + json.dumps(data) + ";/*TEX:END*/"
        new, n = re.subn(r"/\*TEX:BEGIN\*/.*?/\*TEX:END\*/", lambda _m: block, text, flags=re.S)
        if n != 1:
            print(f"markers /*TEX:BEGIN*/ and /*TEX:END*/ not found in {HTML}", file=sys.stderr)
            return 1
        HTML.write_text(new, encoding="utf-8")
        print(f"embedded into {HTML.relative_to(ROOT)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
