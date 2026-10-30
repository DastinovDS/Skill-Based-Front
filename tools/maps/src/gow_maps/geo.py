"""Map geography of DEC-36 (#537): water cells, rivers as area borders, areas meet along roads.

A map may have an authored geography ``maps/src/<id>.geo.json`` (water cells and long rivers,
``load_spec``). For such a map the baker computes, on the grid of ``gow_maps.bake`` (``STEP``
world units per cell), the label of every cell (``compute``):

* the area of a node is the ground nearer to its *site* than to any other site; the site of a node
  is its point and the halves of its roads up to the border point (``border_permille``, DEC-23,
  item 5), plus ``ROAD_BIAS``; the site of a water cell is its point minus its radius, its coast
  wobbles a little. The borders are warped by the baker's noise and the warp fades near roads, so a
  road runs through its own two areas and their border crosses it at its border point (item 2);
* a stream is cut along every border of two node areas without a road, wider toward water
  (item 3); land contacts that are left are turned into stream cells;
* long rivers run along area borders from a spring to the water (item 4); where one passes a road
  it does so at the border point of the road: a bridge (a picture, no rule);
* a land piece cut off from its node becomes the water around it (no slivers, no exclaves).

From the labels: the vector file ``maps/geo/<id>.json`` (``vector_file``: shared border chains,
water kinds, river and stream lines, bridges) and the W4 Painted water over the T2 ground
(``render``; the owner's decision of 2026-10-29: no dark line where an area border runs along
water, the shore is only lighter, inside the water). The rules never read any of it: the
simulation, the server, the bots and the protocol do not change (DEC-36, item 7).

Deterministic for a pinned numpy and Pillow: the noise is the baker's (``map_seed``), every
random field comes from ``numpy.random.default_rng`` seeded from it, ties go to the lower label.
"""

import heapq
import itertools
import json
import math
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, cast

import numpy as np
from numpy.typing import NDArray
from PIL import Image, ImageDraw

from gow_maps import bake
from gow_maps.bake import STEP, TERRAINS, Field, Image8, cell_centres, map_noise, map_seed
from gow_sim.maps import MapDef

# ---- labels ----------------------------------------------------------------------------------
WATER_BASE = 1000  # label of water cell k is WATER_BASE + k
RIVER = 999  # label of a river or stream cell
OUTSIDE = -1  # outside the map (only in the vector file)

# ---- shape (world units) -----------------------------------------------------------------------
ROAD_BIAS = 18.0  # a road half is a little "farther" than the node point: areas do not hug roads
WARP_FADE = (6.0, 70.0)  # the border warp is 0 on a road and full this far from it
SHORE = 34.0  # a water cell never comes closer than this to a road
NODE_CLEARANCE = 60.0  # nor to a node (the validator's water_clearance, map-format.md)
COAST_WOBBLE = 26.0  # amplitude of the coast noise of a water cell
COAST_FADE = (20.0, 80.0)  # the coast noise is 0 next to a road and full this far from it
STREAM_HW = (4.5, 9.0)  # half width of a stream: far from water, next to water
STREAM_WIDEN = 480.0  # a stream widens over this distance toward water
RIVER_HW = (4.0, 11.0)  # default half width of a long river: at the spring, at the mouth
RIVER_BAND = 2.2 * STEP  # a long river may run on cells this close to an area border
RIVER_NODE_GAP = 40.0  # a long river keeps this far from every node
CONTACT_PASSES = 6  # passes that turn left-over land contacts into stream cells
CHAIN_EPS = 3.0  # Ramer-Douglas-Peucker tolerance of the vector chains
BRIDGE_REACH = 24.0  # a road may cross water this close to a bridge of its own (validator)

WaterKind = Literal["sea", "lake"]
Labels = NDArray[np.int32]
Mask = NDArray[np.bool_]
Floats = NDArray[np.floating[Any]]
Pt = tuple[float, float]


class GeoFormatError(ValueError):
    """The authored geography is malformed or does not belong to the map."""


@dataclass(frozen=True, slots=True)
class WaterCell:
    kind: WaterKind
    x: int
    y: int
    r: int


@dataclass(frozen=True, slots=True)
class RiverSpec:
    spring: tuple[int, int]
    to: int | None  # index of the water cell it flows into, else the nearest water
    w0: float  # half width at the spring
    w1: float  # half width at the mouth


@dataclass(frozen=True, slots=True)
class GeoSpec:
    """The authored geography ``maps/src/<id>.geo.json`` (map-format.md, DEC-36)."""

    map: str
    water: tuple[WaterCell, ...]
    rivers: tuple[RiverSpec, ...]


def spec_path(map_path: str | Path) -> Path:
    """``maps/<id>.json`` -> ``maps/src/<id>.geo.json`` (next to the half of the map)."""
    path = Path(map_path)
    return path.parent / "src" / f"{path.stem}.geo.json"


def vector_path(map_path: str | Path) -> Path:
    """``maps/<id>.json`` -> ``maps/geo/<id>.json``.

    A subdirectory, not ``maps/<id>.geo.json``: every ``maps/*.json`` is a map to the server
    pool, the client bundle, the validator and the tournament.
    """
    path = Path(map_path)
    return path.parent / "geo" / path.name


def _int(raw: object, what: str) -> int:
    if isinstance(raw, bool) or not isinstance(raw, int):
        raise GeoFormatError(f"{what} must be an integer")
    return raw


def _num(raw: object, what: str) -> float:
    if isinstance(raw, bool) or not isinstance(raw, int | float) or raw <= 0:
        raise GeoFormatError(f"{what} must be a positive number")
    return float(raw)


def _obj(raw: object, what: str) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise GeoFormatError(f"{what} must be an object")
    return cast(dict[str, Any], raw)


def _list(raw: object, what: str) -> list[Any]:
    if not isinstance(raw, list):
        raise GeoFormatError(f"{what} must be a list")
    return cast(list[Any], raw)


def parse_spec(raw: object) -> GeoSpec:
    """Check and convert the JSON of an authored geography; unknown keys are an error."""
    top = _obj(raw, "the geography")
    if set(top) - {"map", "water", "rivers"} or "map" not in top:
        raise GeoFormatError(f"keys must be map, water, rivers: got {sorted(top)}")
    name = top["map"]
    if not isinstance(name, str) or not name:
        raise GeoFormatError("map must be the map id")
    water: list[WaterCell] = []
    for i, item in enumerate(_list(top.get("water", []), "water")):
        w = _obj(item, f"water[{i}]")
        if set(w) != {"kind", "x", "y", "r"}:
            raise GeoFormatError(f"water[{i}]: keys must be kind, x, y, r")
        kind = w["kind"]
        if kind not in ("sea", "lake"):
            raise GeoFormatError(f"water[{i}]: kind must be sea or lake")
        r = _int(w["r"], f"water[{i}].r")
        if r < 0:
            raise GeoFormatError(f"water[{i}].r must not be negative")
        water.append(WaterCell(kind, _int(w["x"], f"water[{i}].x"), _int(w["y"], "y"), r))
    rivers: list[RiverSpec] = []
    for i, item in enumerate(_list(top.get("rivers", []), "rivers")):
        rv = _obj(item, f"rivers[{i}]")
        if set(rv) - {"from", "to", "w0", "w1"} or "from" not in rv:
            raise GeoFormatError(f"rivers[{i}]: keys must be from, to, w0, w1")
        spring = _list(rv["from"], f"rivers[{i}].from")
        if len(spring) != 2:
            raise GeoFormatError(f"rivers[{i}].from must be [x, y]")
        to = rv.get("to")
        if to is not None and not 0 <= _int(to, f"rivers[{i}].to") < len(water):
            raise GeoFormatError(f"rivers[{i}].to must be the index of a water cell")
        w0 = _num(rv.get("w0", RIVER_HW[0]), f"rivers[{i}].w0")
        w1 = _num(rv.get("w1", RIVER_HW[1]), f"rivers[{i}].w1")
        sx, sy = _int(spring[0], f"rivers[{i}].from"), _int(spring[1], f"rivers[{i}].from")
        rivers.append(RiverSpec((sx, sy), cast(int | None, to), w0, w1))
    if rivers and not water:
        raise GeoFormatError("a river needs a water cell to flow into")
    return GeoSpec(name, tuple(water), tuple(rivers))


def load_spec(path: str | Path) -> GeoSpec:
    try:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise GeoFormatError(f"{path}: {exc}") from exc
    return parse_spec(raw)


def find_spec(map_path: str | Path) -> GeoSpec | None:
    """The authored geography of a map file, or ``None`` if it has none (a land-only map)."""
    path = spec_path(map_path)
    return load_spec(path) if path.is_file() else None


# ---- geometry helpers --------------------------------------------------------------------------
def _seg_dist(px: Floats, py: Floats, a: Pt, b: Pt) -> Floats:
    """Distance from every point to the segment ``ab``."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    l2 = dx * dx + dy * dy
    if l2 == 0:
        return np.hypot(px - a[0], py - a[1])
    t = np.clip(((px - a[0]) * dx + (py - a[1]) * dy) / l2, 0.0, 1.0)
    return np.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy))


def _smoothstep(lo: float, hi: float, x: Floats) -> Floats:
    t = np.clip((x - lo) / (hi - lo), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def distance_to(mask: Mask, step: float = STEP) -> Floats:
    """Distance (world units) from every cell to the nearest ``True`` cell: a two-pass chamfer.

    Exact along the axes and the diagonals, within 8 percent elsewhere; enough for widths.
    """
    h, w = mask.shape
    inf = 1e9
    d = np.where(mask, 0.0, inf)
    a, b = 1.0, math.sqrt(2.0)
    pad = np.array([inf])
    for rows in (range(h), range(h - 1, -1, -1)):
        prev: Floats | None = None
        for yy in rows:
            row = d[yy]
            if prev is not None:
                row = np.minimum(row, prev + a)
                row = np.minimum(row, np.concatenate((pad, prev[:-1])) + b)
                row = np.minimum(row, np.concatenate((prev[1:], pad)) + b)
            # along the row: a running minimum of (d - x) + x, both ways
            idx = np.arange(w, dtype=np.float64)
            row = np.minimum(row, np.minimum.accumulate(row - idx) + idx)
            rev = row[::-1]
            row = np.minimum(row, (np.minimum.accumulate(rev - idx) + idx)[::-1])
            d[yy] = row
            prev = row
    return d * step


def components(mask: Mask) -> tuple[Labels, int]:
    """4-connected components of ``mask``: a label per cell (``-1`` outside) and their count."""
    h, w = mask.shape
    comp = np.full(mask.shape, -1, np.int32)
    count = 0
    for sy, sx in zip(*np.nonzero(mask), strict=True):
        if comp[sy, sx] >= 0:
            continue
        stack = [(int(sy), int(sx))]
        comp[sy, sx] = count
        while stack:
            y, x = stack.pop()
            for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and comp[yy, xx] < 0:
                    comp[yy, xx] = count
                    stack.append((yy, xx))
        count += 1
    return comp, count


def is_water(labels: Labels) -> Mask:
    """Cells of water cells, rivers and streams."""
    return labels >= RIVER


def road_pairs(mapdef: MapDef) -> set[tuple[int, int]]:
    return {(min(e.a, e.b), max(e.a, e.b)) for e in mapdef.edges}


def land_contacts(labels: Labels) -> dict[tuple[int, int], int]:
    """Pairs of node areas that share land (4-neighbour cell contacts) and how many contacts."""
    out: dict[tuple[int, int], int] = {}
    for a, b in ((labels[:, 1:], labels[:, :-1]), (labels[1:, :], labels[:-1, :])):
        touch = (a != b) & (a >= 0) & (b >= 0) & (a < RIVER) & (b < RIVER)
        lo = np.minimum(a[touch], b[touch]).tolist()
        hi = np.maximum(a[touch], b[touch]).tolist()
        for i, j in zip(lo, hi, strict=True):
            out[(i, j)] = out.get((i, j), 0) + 1
    return dict(sorted(out.items()))


def _bad_contacts(labels: Labels, allowed: Mask) -> Mask:
    """Cells on either side of a land contact of two nodes without a road (``_pair_table``)."""
    bad = np.zeros(labels.shape, np.bool_)
    clipped = np.where(labels < RIVER, labels, 0)
    for axis in (0, 1):
        a = clipped[1:, :] if axis == 0 else clipped[:, 1:]
        b = clipped[:-1, :] if axis == 0 else clipped[:, :-1]
        la = labels[1:, :] if axis == 0 else labels[:, 1:]
        lb = labels[:-1, :] if axis == 0 else labels[:, :-1]
        mm = (la != lb) & (la < RIVER) & (lb < RIVER) & ~allowed[a, b]
        if axis == 0:
            bad[1:, :] |= mm
            bad[:-1, :] |= mm
        else:
            bad[:, 1:] |= mm
            bad[:, :-1] |= mm
    return bad


def _segments_cross(a: Pt, b: Pt, c: Pt, d: Pt) -> bool:
    def orient(p: Pt, q: Pt, r: Pt) -> float:
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])

    return orient(a, b, c) * orient(a, b, d) < 0 and orient(c, d, a) * orient(c, d, b) < 0


def _smooth(pts: list[Pt], passes: int) -> list[Pt]:
    """Chaikin corner cutting of an open polyline (the ends stay)."""
    for _ in range(passes):
        if len(pts) < 3:
            break
        out = [pts[0]]
        for a, b in itertools.pairwise(pts):
            out.append((0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]))
            out.append((0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]))
        out.append(pts[-1])
        pts = out
    return pts


def _route(band: Mask, target: Mask, start: tuple[int, int]) -> list[Pt] | None:
    """Shortest 8-neighbour path over ``band`` from the band cell nearest to ``start`` (world
    units) to any ``target`` cell (Dijkstra; ties by cell order, so deterministic)."""
    h, w = band.shape
    cand = np.argwhere(band)
    if not len(cand):
        return None
    sy, sx = start[1] / STEP, start[0] / STEP
    k = int(np.argmin((cand[:, 0] - sy) ** 2 + (cand[:, 1] - sx) ** 2))
    first = (int(cand[k, 0]), int(cand[k, 1]))
    dist = {first: 0.0}
    prev: dict[tuple[int, int], tuple[int, int]] = {}
    queue = [(0.0, first)]
    goal = None
    while queue:
        d, cell = heapq.heappop(queue)
        if d > dist.get(cell, math.inf):
            continue
        cy, cx = cell
        if target[cy, cx]:
            goal = cell
            break
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                ny, nx = cy + dy, cx + dx
                if (dy or dx) and 0 <= ny < h and 0 <= nx < w and (band[ny, nx] or target[ny, nx]):
                    nd = d + (math.sqrt(2.0) if dy and dx else 1.0)
                    if nd < dist.get((ny, nx), math.inf):
                        dist[(ny, nx)] = nd
                        prev[(ny, nx)] = cell
                        heapq.heappush(queue, (nd, (ny, nx)))
    if goal is None:
        return None
    path = [goal]
    while path[-1] in prev:
        path.append(prev[path[-1]])
    path.reverse()
    return _smooth([(c * STEP + STEP / 2, r * STEP + STEP / 2) for r, c in path], 3)


# ---- the geography -----------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class Line:
    """A river or stream centre line with its half width at every point (world units)."""

    pts: tuple[Pt, ...]
    hw: tuple[float, ...]


@dataclass(frozen=True, slots=True)
class Bridge:
    edge: int
    x: float
    y: float


@dataclass(frozen=True, slots=True, eq=False)
class Geography:
    """The computed geography of a map (``compute``)."""

    labels: Labels
    """Label of every ``STEP`` cell: a node id, ``WATER_BASE + k`` or ``RIVER``."""
    water: tuple[WaterKind, ...]
    streams: tuple[Line, ...]
    rivers: tuple[Line, ...]
    bridges: tuple[Bridge, ...]


def border_point(mapdef: MapDef, edge_id: int) -> Pt:
    edge = mapdef.edges[edge_id]
    a, b = mapdef.nodes[edge.a], mapdef.nodes[edge.b]
    f = edge.border_permille / 1000
    return a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f


def compute(mapdef: MapDef, spec: GeoSpec, seed: int | None = None) -> Geography:
    """Labels, streams, long rivers and bridges of a map (module docstring, DEC-36 items 1-4)."""
    if spec.map != mapdef.meta.name:
        raise GeoFormatError(f"the geography is of map {spec.map!r}, not {mapdef.meta.name!r}")
    x, y = cell_centres(mapdef)
    noise = map_noise(mapdef, seed)
    nodes = sorted(mapdef.nodes, key=lambda n: n.id)
    pos = {n.id: (float(n.x), float(n.y)) for n in nodes}

    droad = np.full(x.shape, 1e9)
    halves: dict[int, list[tuple[Pt, Pt]]] = {n.id: [] for n in nodes}
    for e in mapdef.edges:
        droad = np.minimum(droad, _seg_dist(x, y, pos[e.a], pos[e.b]))
        p = border_point(mapdef, e.id)
        halves[e.a].append((pos[e.a], p))
        halves[e.b].append((pos[e.b], p))
    dnode = np.min(np.stack([np.hypot(x - px, y - py) for px, py in pos.values()]), axis=0)

    wdx, wdy = noise.warp(x, y)
    fade = _smoothstep(*WARP_FADE, droad)
    wx, wy = x + wdx * fade, y + wdy * fade
    coast = (
        np.sin(x * 0.043 + y * 0.017 + noise.x) * 0.5
        + np.sin(x * 0.011 - y * 0.051 + noise.y) * 0.35
        + np.sin(x * 0.09 + y * 0.07) * 0.15
    ) * COAST_WOBBLE

    # Nearest and second nearest site (ties: the earlier, lower label keeps the cell).
    best = np.full(x.shape, 1e9)
    second = np.full(x.shape, 1e9)
    lab = np.zeros(x.shape, np.int32)
    lab2 = np.zeros(x.shape, np.int32)

    def push(label: int, d: Floats) -> None:
        nonlocal best, second, lab, lab2
        b1 = d < best
        b2 = ~b1 & (d < second)
        second = np.where(b1, best, np.where(b2, d, second))
        lab2 = np.where(b1, lab, np.where(b2, label, lab2)).astype(np.int32)
        best = np.where(b1, d, best)
        lab = np.where(b1, label, lab).astype(np.int32)

    for n in nodes:
        d = np.hypot(wx - pos[n.id][0], wy - pos[n.id][1])
        for a, p in halves[n.id]:
            d = np.minimum(d, _seg_dist(wx, wy, a, p) + ROAD_BIAS)
        push(n.id, d)
    for k, cell in enumerate(spec.water):
        d = np.hypot(wx - cell.x, wy - cell.y) - cell.r + coast * _smoothstep(*COAST_FADE, droad)
        d = np.where((droad < SHORE) | (dnode < NODE_CLEARANCE), 1e8, d)
        push(WATER_BASE + k, d)

    pairs = road_pairs(mapdef)
    table = _pair_table(mapdef, pairs)
    gap = second - best
    both_nodes = (lab < RIVER) & (lab2 < RIVER)
    no_road = both_nodes & ~table[np.minimum(lab, len(nodes)), np.minimum(lab2, len(nodes))]
    water0 = lab >= WATER_BASE
    dwater = distance_to(water0) if water0.any() else np.full(x.shape, 1e4)
    stream_hw = STREAM_HW[0] + (STREAM_HW[1] - STREAM_HW[0]) * (
        1.0 - _smoothstep(0.0, STREAM_WIDEN, dwater)
    )
    stream = no_road & (gap < 2.0 * stream_hw)

    # Long rivers along area borders (any pair), from the spring to their water.
    band = both_nodes & (gap < RIVER_BAND) & (dnode > RIVER_NODE_GAP)
    river = np.zeros(x.shape, np.bool_)
    rivers: list[Line] = []
    for rv in spec.rivers:
        target = water0 if rv.to is None else lab == WATER_BASE + rv.to
        path = _route(band, target, rv.spring)
        if path is None:
            continue
        pts = np.array(path)
        along = np.concatenate(([0.0], np.cumsum(np.hypot(*np.diff(pts, axis=0).T))))
        total = float(along[-1]) or 1.0
        dmin = np.full(x.shape, 1e9)
        at = np.zeros(x.shape)
        reach = max(rv.w0, rv.w1) + STEP
        rows, cols = x.shape
        for k in range(len(path) - 1):
            (ax, ay), (bx, by) = path[k], path[k + 1]
            win = (
                slice(
                    max(0, int((min(ay, by) - reach) // STEP)),
                    min(rows, int((max(ay, by) + reach) // STEP) + 1),
                ),
                slice(
                    max(0, int((min(ax, bx) - reach) // STEP)),
                    min(cols, int((max(ax, bx) + reach) // STEP) + 1),
                ),
            )
            d = _seg_dist(x[win], y[win], path[k], path[k + 1])
            closer = d < dmin[win]
            dmin[win] = np.where(closer, d, dmin[win])
            at[win] = np.where(closer, along[k] / total, at[win])
        river |= dmin < rv.w0 + (rv.w1 - rv.w0) * at
        hw = [rv.w0 + (rv.w1 - rv.w0) * float(t) / total for t in along]
        rivers.append(_thin_line(path, hw))

    labels = np.where(stream | river, RIVER, lab).astype(np.int32)
    for _ in range(CONTACT_PASSES):
        bad = _bad_contacts(labels, table)
        if not bad.any():
            break
        labels = np.where(bad, RIVER, labels).astype(np.int32)
    fill_islands(labels, mapdef)

    bridges: list[Bridge] = []
    for e in mapdef.edges:
        a, b = pos[e.a], pos[e.b]
        for line in rivers:
            if any(
                _segments_cross(a, b, p, q)
                for p, q in zip(line.pts[:-1], line.pts[1:], strict=True)
            ):
                bx, by = border_point(mapdef, e.id)
                bridges.append(Bridge(e.id, round(bx, 1), round(by, 1)))
                break

    streams = _stream_lines(lab, stream_hw, pairs)
    return Geography(
        labels, tuple(w.kind for w in spec.water), streams, tuple(rivers), tuple(bridges)
    )


def _pair_table(mapdef: MapDef, pairs: Iterable[tuple[int, int]]) -> Mask:
    """``table[a, b]``: nodes ``a`` and ``b`` have a road (the last row and column: no node)."""
    n = len(mapdef.nodes)
    table = np.zeros((n + 1, n + 1), np.bool_)
    for a, b in pairs:
        table[a, b] = table[b, a] = True
    return table


def _thin_line(pts: list[Pt], hw: list[float], spacing: float = 10.0) -> Line:
    """Keep points at least ``spacing`` apart (and the last one), rounded for the file."""
    keep = [0]
    for k in range(1, len(pts)):
        if math.dist(pts[k], pts[keep[-1]]) >= spacing:
            keep.append(k)
    if keep[-1] != len(pts) - 1:
        keep.append(len(pts) - 1)
    return Line(
        tuple((float(round(pts[k][0])), float(round(pts[k][1]))) for k in keep),
        tuple(round(hw[k], 1) for k in keep),
    )


def _stream_lines(lab: Labels, hw: Floats, pairs: set[tuple[int, int]]) -> tuple[Line, ...]:
    """Centre lines of the streams: the borders of two node areas without a road, taken from
    the areas before the streams were cut."""
    out: list[Line] = []
    h, w = lab.shape
    for c in chains(lab):
        a, b = c.left, c.right
        if not (0 <= a < RIVER and 0 <= b < RIVER) or (min(a, b), max(a, b)) in pairs:
            continue
        pts = _rdp(list(c.pts), 2.0)
        widths = [
            float(hw[min(int(py // STEP), h - 1), min(int(px // STEP), w - 1)]) for px, py in pts
        ]
        out.append(_thin_line(pts, widths, 0.0))
    return tuple(out)


def fill_islands(labels: Labels, mapdef: MapDef) -> None:
    """A land piece cut off from its node becomes the water around it (in place)."""
    h, w = labels.shape
    for node in sorted(mapdef.nodes, key=lambda n: n.id):
        comp, count = components(labels == node.id)
        if count <= 1:
            continue
        home = int(comp[min(node.y // STEP, h - 1), min(node.x // STEP, w - 1)])
        if home < 0:  # the node itself is under water: keep its largest piece (validator fails)
            home = int(np.bincount(comp[comp >= 0]).argmax())
        for k in range(count):
            if k == home:
                continue
            piece = comp == k
            ring = np.zeros_like(piece)
            ring[1:] |= piece[:-1]
            ring[:-1] |= piece[1:]
            ring[:, 1:] |= piece[:, :-1]
            ring[:, :-1] |= piece[:, 1:]
            around = labels[ring & ~piece]
            water = around[around >= WATER_BASE]
            labels[piece] = int(np.bincount(water).argmax()) if len(water) else RIVER


# ---- vectors -----------------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class Chain:
    """A shared border of two regions; ``left`` lies on the left of the walk (y axis down)."""

    left: int
    right: int
    pts: tuple[Pt, ...]


Corner = tuple[int, int]


def chains(labels: Labels) -> list[Chain]:
    """The borders of the label grid as polylines on the cell corners, one per pair of regions
    between two junctions (``OUTSIDE`` around the map). Deterministic: corners in row order."""
    h, w = labels.shape
    padded = np.full((h + 2, w + 2), OUTSIDE, np.int32)
    padded[1:-1, 1:-1] = labels
    links: dict[Corner, list[tuple[Corner, tuple[int, int]]]] = {}

    def add(p: Corner, q: Corner, a: int, b: int) -> None:
        key = (min(a, b), max(a, b))
        links.setdefault(p, []).append((q, key))
        links.setdefault(q, []).append((p, key))

    vertical = padded[1:-1, :-1] != padded[1:-1, 1:]  # between cells (r, c-1) and (r, c)
    for r, c in zip(*np.nonzero(vertical), strict=True):
        a, b = int(padded[r + 1, c]), int(padded[r + 1, c + 1])
        if a != OUTSIDE or b != OUTSIDE:
            add((int(r), int(c)), (int(r) + 1, int(c)), a, b)
    horizontal = padded[:-1, 1:-1] != padded[1:, 1:-1]  # between cells (r-1, c) and (r, c)
    for r, c in zip(*np.nonzero(horizontal), strict=True):
        a, b = int(padded[r, c + 1]), int(padded[r + 1, c + 1])
        if a != OUTSIDE or b != OUTSIDE:
            add((int(r), int(c)), (int(r), int(c) + 1), a, b)

    def junction(p: Corner) -> bool:
        ls = links[p]
        return len(ls) != 2 or ls[0][1] != ls[1][1]

    used: set[tuple[Corner, Corner]] = set()
    walks: list[list[Corner]] = []

    def walk(start: Corner, nxt: Corner) -> list[Corner]:
        pts = [start, nxt]
        used.update({(start, nxt), (nxt, start)})
        prev, cur = start, nxt
        while not junction(cur) and cur != start:
            q = next(o for o, _ in links[cur] if o != prev)
            if (cur, q) in used:
                break
            used.update({(cur, q), (q, cur)})
            pts.append(q)
            prev, cur = cur, q
        return pts

    for only_junctions in (True, False):  # then the closed loops without a junction
        for p in list(links):
            if only_junctions and not junction(p):
                continue
            for q, _ in links[p]:
                if (p, q) not in used:
                    walks.append(walk(p, q))

    out: list[Chain] = []
    for corners in walks:
        pts = [(float(c * STEP), float(r * STEP)) for r, c in corners]
        (x0, y0), (x1, y1) = pts[0], pts[1]
        # The cell on the left of the first step (y down: left of (dx, dy) is (dy, -dx)).
        mx, my = (x0 + x1) / 2 + (y1 - y0) / 2, (y0 + y1) / 2 - (x1 - x0) / 2
        rr, cc = int(my // STEP), int(mx // STEP)
        left = int(labels[rr, cc]) if 0 <= rr < h and 0 <= cc < w else OUTSIDE
        right = _other_side(padded, corners[0], corners[1], left)
        out.append(Chain(left, right, tuple(pts)))
    return out


def _other_side(padded: Labels, p: Corner, q: Corner, left: int) -> int:
    """The label across the lattice step ``p -> q`` from ``left``."""
    if p[1] == q[1]:  # vertical step at column p[1]: cells (r, c-1) and (r, c)
        r = min(p[0], q[0])
        a, b = int(padded[r + 1, p[1]]), int(padded[r + 1, p[1] + 1])
    else:  # horizontal step at row p[0]: cells (r-1, c) and (r, c)
        c = min(p[1], q[1])
        a, b = int(padded[p[0], c + 1]), int(padded[p[0] + 1, c + 1])
    return b if a == left else a


def _rdp(pts: list[Pt], eps: float) -> list[Pt]:
    """Ramer-Douglas-Peucker simplification (keeps the ends; a closed loop keeps its start)."""
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    if a == b:
        dist = [math.dist(p, a) for p in pts]
    else:
        ln = math.dist(a, b)
        dist = [
            abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / ln for p in pts
        ]
    i = max(range(len(pts)), key=lambda k: (dist[k], -k))
    if dist[i] > eps:
        return _rdp(pts[: i + 1], eps)[:-1] + _rdp(pts[i:], eps)
    return [a, b]


def _label_out(label: int) -> int | str:
    if label >= WATER_BASE:
        return f"w{label - WATER_BASE}"
    if label == RIVER:
        return "river"
    return label


def _flat(pts: Iterable[Pt]) -> list[int | float]:
    out: list[int | float] = []
    for px, py in pts:
        out += [int(px) if px == int(px) else px, int(py) if py == int(py) else py]
    return out


def vector_file(mapdef: MapDef, geo: Geography) -> dict[str, Any]:
    """The computed geometry ``maps/geo/<id>.json`` (map-format.md, "Format changes under DEC-36").

    ``chains[]``: ``{l, r, pts}`` with ``pts`` flat ``[x0, y0, x1, y1, ...]`` in world units on
    the cell corners, ``l`` / ``r`` a node id, ``"w<k>"``, ``"river"`` or ``-1`` (outside).
    """
    return {
        "map": mapdef.meta.name,
        "version": mapdef.meta.version,
        "step": STEP,
        "water": [{"kind": kind} for kind in geo.water],
        "chains": [
            {
                "l": _label_out(c.left),
                "r": _label_out(c.right),
                "pts": _flat(_rdp(list(c.pts), CHAIN_EPS)),
            }
            for c in chains(geo.labels)
        ],
        "rivers": [{"pts": _flat(line.pts), "hw": list(line.hw)} for line in geo.rivers],
        "streams": [{"pts": _flat(line.pts), "hw": list(line.hw)} for line in geo.streams],
        "bridges": [{"edge": b.edge, "x": b.x, "y": b.y} for b in geo.bridges],
    }


def dump_vector_file(data: dict[str, Any]) -> str:
    """Compact JSON, one chain per line (diffs stay readable), newline at the end."""
    lines = [json.dumps(chain, separators=(",", ":")) for chain in data["chains"]]
    head = {k: v for k, v in data.items() if k != "chains"}
    body = json.dumps(head, separators=(",", ":"))
    return body[:-1] + ',"chains":[\n' + ",\n".join(lines) + "\n]}\n"


# ---- the picture: W4 Painted -------------------------------------------------------------------
WATER_TONES = ((52, 92, 116), (66, 108, 130))  # two tones in soft blotches (mockup W4)
RIVER_LIGHT = ((118, 160, 168), 0.42)  # a river is shallow: lighter than a lake
SHALLOWS = ((150, 194, 186), 0.34)  # the shore of a sea or a lake: lighter inside the water
CURRENT = ((30, 62, 84), 0.24)  # a river is a little darker along the current
REED = ((74, 104, 62), 0.45)  # muted reed tufts on the land beside the water
DECK, PLANK, RAIL, SHADOW = (155, 132, 102), (60, 44, 28), (91, 70, 50), (0, 0, 0)
BRIDGE_LEN, BRIDGE_W = 34.0, 11.0
EDGE_ROUND = 3  # blur radius (px) that rounds the 4-unit cells of the water off
EDGE_SOFT = 1.2  # half width (px) of the anti-aliased water edge: soft, no line
REED_ROWS = ((7.0, 0.30), (13.0, 0.14), (20.0, 0.05))  # (distance from the water, keep share)


def _upscale(cells: NDArray[Any]) -> Field:
    """A cell field at one pixel per world unit, smooth (bilinear)."""
    h, w = cells.shape
    img = Image.fromarray(np.asarray(cells, np.float32), "F")
    big = img.resize((w * STEP, h * STEP), Image.Resampling.BILINEAR)
    return np.asarray(big, dtype=np.float32)


def _ground_cells(mapdef: MapDef, geo: Geography, seed: int | None) -> NDArray[np.uint8]:
    """Biome of every cell: by the terrain of the area's node; under water the biome of the
    nearest node of the old field (the ground continues under the water, so no muddy band)."""
    x, y = cell_centres(mapdef)
    moisture = map_noise(mapdef, seed).moisture(x, y)
    n = len(mapdef.nodes)
    terrain = np.zeros(n, np.uint8)
    for node in mapdef.nodes:
        terrain[node.id] = TERRAINS.index(node.terrain)
    land = geo.labels < RIVER
    own = bake.biome_indices(terrain[np.where(land, geo.labels, 0)], moisture)
    under = bake.cell_indices(mapdef, seed)
    return np.where(land, own, under).astype(np.uint8)


def _paint_lines(size: tuple[int, int], lines: Iterable[Line], width: float) -> Field:
    """Alpha (0..1) of polylines drawn with a round pen, supersampled for smooth edges.

    ``width`` > 0 is a fixed width in px; ``width`` < 0 is a factor of the half width per point.
    """
    s = bake.SUPERSAMPLE
    w, h = size
    img = Image.new("L", (w * s, h * s), 0)
    draw = ImageDraw.Draw(img)
    for line in lines:
        pts = list(line.pts)
        for k in range(len(pts) - 1):
            (ax, ay), (bx, by) = pts[k], pts[k + 1]
            px = width if width > 0 else -width * 2 * line.hw[k]
            pen = max(1, round(px * s))
            draw.line([(ax * s, ay * s), (bx * s, by * s)], fill=255, width=pen)
            r = pen / 2
            for cx, cy in ((ax * s, ay * s), (bx * s, by * s)):
                draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    return np.asarray(img.reduce(s), dtype=np.float32) / 255.0


def _mix(img: Field, colour: tuple[int, int, int], alpha: NDArray[np.floating[Any]]) -> Field:
    c = np.array(colour, dtype=np.float32)
    a = alpha[..., None]
    return np.asarray(img * (1.0 - a) + c * a, dtype=np.float32)


def _deck_point(br: Bridge, angle: float, u: float, v: float) -> tuple[float, float]:
    """A point of a bridge deck in supersampled pixels: ``u`` along the road, ``v`` across."""
    ux, uy = math.cos(angle), math.sin(angle)
    s = bake.SUPERSAMPLE
    return ((br.x + ux * u - uy * v) * s, (br.y + uy * u + ux * v) * s)


def _draw_bridges(img: Field, mapdef: MapDef, bridges: Iterable[Bridge]) -> Field:
    """Wooden decks with planks and railings and a soft shadow, along the road (mockup W4)."""
    s = bake.SUPERSAMPLE
    h, w = img.shape[:2]
    base = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), "RGB")
    layer = base.resize((w * s, h * s), Image.Resampling.BILINEAR).convert("RGBA")
    shade = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    hl, hw = BRIDGE_LEN / 2, BRIDGE_W / 2
    quad = [(-hl, -hw), (hl, -hw), (hl, hw), (-hl, hw)]
    decks: list[tuple[Bridge, float]] = []
    for br in bridges:
        edge = mapdef.edges[br.edge]
        a, b = mapdef.nodes[edge.a], mapdef.nodes[edge.b]
        angle = math.atan2(b.y - a.y, b.x - a.x)
        decks.append((br, angle))
        shifted = Bridge(br.edge, br.x + 1.5, br.y + 2.5)
        ImageDraw.Draw(shade).polygon(
            [_deck_point(shifted, angle, u, v) for u, v in quad], fill=(*SHADOW, 71)
        )
    layer = Image.alpha_composite(layer, shade)
    draw = ImageDraw.Draw(layer)
    for br, angle in decks:
        draw.polygon([_deck_point(br, angle, u, v) for u, v in quad], fill=DECK)
        u = -hl + 3
        while u < hl:
            line = [_deck_point(br, angle, u, -hw), _deck_point(br, angle, u, hw)]
            draw.line(line, fill=PLANK, width=max(1, round(0.9 * s)))
            u += 4
        for v in (-hw, hw):
            line = [_deck_point(br, angle, -hl, v), _deck_point(br, angle, hl, v)]
            draw.line(line, fill=RAIL, width=max(1, round(1.6 * s)))
    out = layer.convert("RGB").reduce(s)
    return np.asarray(out, dtype=np.float32)


def _reeds(
    size: tuple[int, int], near: Field, land: Field, rng: np.random.Generator
) -> list[tuple[float, float, float]]:
    """Reed tufts ``(x, y, row)`` on the land beside the water, thinning away from it."""
    w, h = size
    step = 6
    xs = np.arange(step / 2, w, step, dtype=np.float64)
    ys = np.arange(step / 2, h, step, dtype=np.float64)
    gx = xs[None, :] + (rng.random((len(ys), len(xs))) - 0.5) * step
    gy = ys[:, None] + (rng.random((len(ys), len(xs))) - 0.5) * step
    ix = np.clip(gx, 0, w - 1).astype(np.intp)
    iy = np.clip(gy, 0, h - 1).astype(np.intp)
    dist = near[iy, ix]
    on_land = land[iy, ix] > 0.99
    roll = rng.random(gx.shape)
    out: list[tuple[float, float, float]] = []
    lo = 3.0
    for row, (hi, keep) in enumerate(REED_ROWS):
        sel = on_land & (dist >= lo) & (dist < hi) & (roll < keep)
        out += [(float(a), float(b), float(row)) for a, b in zip(gx[sel], gy[sel], strict=True)]
        lo = hi
    out.sort(key=lambda t: (t[1], t[0]))
    return out


def render(mapdef: MapDef, geo: Geography, seed: int | None = None) -> Image8:
    """The background of a map with a geography: the T2 ground of the new areas, details thinning
    toward a shore, and the water of W4 Painted on top (no dark line along water)."""
    seq = np.random.SeedSequence([map_seed(mapdef) if seed is None else seed, 36])
    rng_tone, rng_reeds = (np.random.default_rng(c) for c in seq.spawn(2))
    water_cells = is_water(geo.labels)
    lake_cells = geo.labels >= WATER_BASE
    h, w = geo.labels.shape[0] * STEP, geo.labels.shape[1] * STEP
    # Soft water masks at one px per unit: the 4-unit cells rounded off, a thin soft edge.
    water_f = bake.blur(_upscale(water_cells.astype(np.float32)), EDGE_ROUND)
    water = np.clip((water_f - 0.5) / (2 * EDGE_SOFT) * EDGE_ROUND + 0.5, 0.0, 1.0)
    lake_f = bake.blur(_upscale(lake_cells.astype(np.float32)), EDGE_ROUND)
    lake = np.clip((lake_f - 0.5) * 2.5 + 0.5, 0.0, 1.0)
    # Distance (px) from the water, for the details and the reeds; inside the water, from land.
    near = _upscale(distance_to(water_cells)) - STEP / 2
    from_land = _upscale(distance_to(~water_cells)) - STEP / 2
    thin = np.asarray(_smoothstep(4.0, 26.0, near.astype(np.float64)), dtype=np.float32)

    def paint(img: Field) -> Field:
        noise = bake.fbm(h, w, 60, 3, rng_tone) * 1.6
        blotch = np.clip((noise + 0.18) / 0.36, 0.0, 1.0).astype(np.float32)
        tone = bake.lerp(
            *WATER_TONES, np.asarray(blotch * blotch * (3.0 - 2.0 * blotch), np.float32)
        )
        rivers_only = np.asarray(water * (1.0 - lake), dtype=np.float32)
        tone = _mix(tone, RIVER_LIGHT[0], rivers_only * RIVER_LIGHT[1])
        shallow = np.asarray(
            (1.0 - _smoothstep(0.0, 26.0, from_land.astype(np.float64))) * lake, dtype=np.float32
        )
        tone = _mix(tone, SHALLOWS[0], shallow * SHALLOWS[1])
        lines = (*geo.rivers, *geo.streams)
        current = bake.blur(_paint_lines((w, h), lines, -0.5), 2) * water
        tone = _mix(tone, CURRENT[0], current * CURRENT[1])
        # No light flow streaks on the rivers: the owner read the short pale dashes as rendering
        # artifacts (2026-10-30, #585); the river is the lighter tone and its darker current.
        out = np.asarray(img * (1.0 - water[..., None]) + tone * water[..., None], np.float32)
        out = _draw_reeds(out, _reeds((w, h), near, 1.0 - water, rng_reeds))
        return _draw_bridges(out, mapdef, geo.bridges)

    return bake.render_cells(mapdef, _ground_cells(mapdef, geo, seed), seed, thin, paint)


def _draw_reeds(img: Field, reeds: list[tuple[float, float, float]]) -> Field:
    s = bake.SUPERSAMPLE
    h, w = img.shape[:2]
    alpha = Image.new("L", (w * s, h * s), 0)
    draw = ImageDraw.Draw(alpha)
    for x, y, row in reeds:
        tall = 3.2 - row * 0.6
        a = round(255 * (REED[1] - row * 0.1))
        for dx0, dx1, top in ((-1.6, -2.4, tall), (0.0, 0.0, tall + 1), (1.6, 2.6, tall)):
            draw.line(
                [((x + dx0) * s, (y + 1) * s), ((x + dx1) * s, (y - top) * s)],
                fill=a,
                width=max(1, round(1.1 * s)),
            )
    mask = np.asarray(alpha.reduce(s), dtype=np.float32) / 255.0
    return _mix(img, REED[0], mask)


def bake_geography(
    mapdef: MapDef,
    spec: GeoSpec,
    background: str | Path,
    vectors: str | Path,
    seed: int | None = None,
) -> Geography:
    """Write the background with water (WebP, the budget of ``bake``) and the vector file.

    Raises ``ValueError`` (``GeoFormatError`` included), writing nothing, on a bad geography or a
    background over the budget.
    """
    geography = compute(mapdef, spec, seed)
    text = dump_vector_file(vector_file(mapdef, geography))
    bake.write_background(mapdef, render(mapdef, geography, seed), background)
    out = Path(vectors)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    return geography
