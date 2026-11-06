"""Whole-map generator (#771): a seed gives a map with its own geography, not a mirrored half.

Stage 1 of the owner's decision of 2026-11-06. ``generate(seed)`` returns the map data and an
authored-style geography (``maps/gen/src/<id>.geo.json``, DEC-36); ``gow-maps bake`` turns the
geography into water, rivers, bridges and the background as for a hand-made map.

The order of a map (``_attempt``), each step a function of the one before:

1. **Land.** Value noise minus a few *pits* (seas outside the edges, bays, inland seas, lakes,
   picked by an archetype) on a coarse grid; the lowest cells are water.
2. **Nodes.** Poisson-disc points over the land, denser where a noise says so.
3. **Roads.** Delaunay on the integer points (exact arithmetic), without the roads over water or
   the longest ones, pruned toward the road count of the pool while no road becomes a bridge of
   the graph. A subgraph of a triangulation is planar by construction.
4. **Capitals.** The pair of nodes with the most equal access (``_capitals``), never each other's
   rotation.
5. **Attributes in regional patches.** Terrain, kinds and VP come from fields over the whole map,
   not from node pairs; the two sides get equal counts by taking the top of each side by the same
   field. Start forces are equal: both sides start with the same list of kinds.
6. **Geography.** Circles packed into the water of step 1, rivers from high ground.
7. **Filter.** ``gow_maps.fairness``: equal access, not a mirror, interest. A rejected attempt is
   followed by the next one of the same seed.

Standard library, ``gow_maps.fairness`` and ``gow_sim.maps`` only: the server cannot import
``networkx``, ``numpy``, ``matplotlib`` or ``Pillow``, and stage 2 runs this module there
(``lint-imports`` holds it to that). For the same reason only ``+ - * /``, ``sqrt`` and
``Random.random()`` touch the numbers: they are the same on every platform and Python version,
unlike ``sin`` or ``Random.shuffle``. The map enters a match as data, never as this seed.
"""

import math
import random
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Final

from gow_maps.fairness import FairnessConfig, Scores, check, load_fairness, score, shortest
from gow_sim.maps import NodeKind, Terrain, parse_map

GENERATOR_VERSION: Final = 1
"""Part of the map id: the same seed under another version is another map."""

MAX_ATTEMPTS: Final = 400
CELL: Final = 16  # world units per cell of the land grid
MIN_NODES, MAX_NODES = 29, 55  # the sizes of the pool
AREA_PER_NODE: Final = 50000  # the pool: about 49 000 square units per node, water included
EDGE_MARGIN: Final = 60  # nodes keep this far from the edge of the world
COAST_MARGIN: Final = 92  # and from the water of the grid (water_clearance is 60)
ROAD_COAST_MARGIN: Final = 40  # a road keeps this far from it (the baker keeps water 34 away)
MAX_ROAD: Final = 345  # the longest road (the pool: up to 337, one of 458)
MIN_ROAD_ANGLE_COS: Final = 0.875  # two roads of a node are at least about 29 degrees apart
TICKS_PER_100: Final = 30  # validate.toml, travel_ticks_per_100_units
START_SHARE_PCT: Final = 16  # nodes a side owns at the start (the pool: 8 of 50, 5 of 29)
GOAL_NEUTRAL_PCT: Final = 22  # the validator asks for 20: a little margin
CAPITAL_TICKS: Final = (430, 680)  # the time between the capitals (the pool: 450..624)
WATER_PCT: Final = (17, 25)  # the share of water the baker should end up with (the pool: 18..20)
WATER_RADII: Final = (
    0.75,
    0.62,
    0.5,
    0.38,
    0.26,
    0.14,
)  # of the room a water cell has, tried in turn

Point = tuple[int, int]
Road = tuple[int, int]
Adjacency = list[list[tuple[int, int]]]


def map_id(seed: int) -> str:
    return f"gen{GENERATOR_VERSION}-{seed}"


# ---- random helpers: only Random.random(), stable across Python versions ------------------------
def _pick[T](rng: random.Random, items: Sequence[T]) -> T:
    return items[int(rng.random() * len(items))]


def _between(rng: random.Random, low: float, high: float) -> float:
    return low + (high - low) * rng.random()


def _shuffled[T](rng: random.Random, items: Sequence[T]) -> list[T]:
    out = list(items)
    for i in range(len(out) - 1, 0, -1):
        j = int(rng.random() * (i + 1))
        out[i], out[j] = out[j], out[i]
    return out


class _Noise:
    """Value noise on a lattice: smooth, in ``0..1``, plain arithmetic."""

    def __init__(self, rng: random.Random, width: int, height: int, pitch: float) -> None:
        self.pitch = pitch
        self.cols = int(width / pitch) + 3
        rows = int(height / pitch) + 3
        self.table = [rng.random() for _ in range(self.cols * rows)]

    def at(self, x: float, y: float) -> float:
        gx, gy = x / self.pitch, y / self.pitch
        ix, iy = int(gx), int(gy)
        fx, fy = gx - ix, gy - iy
        fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
        i = iy * self.cols + ix
        t = self.table
        top = t[i] + (t[i + 1] - t[i]) * fx
        low = t[i + self.cols] + (t[i + self.cols + 1] - t[i + self.cols]) * fx
        return top + (low - top) * fy


class _Field:
    """Three octaves of noise, in about ``0..1``."""

    def __init__(self, rng: random.Random, width: int, height: int, pitch: float) -> None:
        self.layers = [
            (0.6, _Noise(rng, width, height, pitch)),
            (0.28, _Noise(rng, width, height, pitch / 2)),
            (0.12, _Noise(rng, width, height, pitch / 4)),
        ]

    def at(self, x: float, y: float) -> float:
        total = 0.0  # not sum(): it rounds differently between Python versions
        for weight, noise in self.layers:
            total += weight * noise.at(x, y)
        return total


def _dist(a: tuple[float, float], b: tuple[float, float]) -> float:
    dx, dy = a[0] - b[0], a[1] - b[1]
    return math.sqrt(dx * dx + dy * dy)


# ---- land ---------------------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class _Pit:
    x: float
    y: float
    r: float
    depth: float


ARCHETYPES: Final = ("coast", "gulf", "inland", "straits", "corners", "lakes")


def _edge_point(
    rng: random.Random, width: int, height: int, side: int, out: float
) -> tuple[float, float]:
    """A point ``out`` units outside side 0..3 (north, east, south, west) of the world."""
    if side in (0, 2):
        return _between(rng, 0.1, 0.9) * width, -out if side == 0 else height + out
    return (width + out if side == 1 else -out), _between(rng, 0.1, 0.9) * height


def _inland_chain(
    rng: random.Random, start: tuple[float, float], width: int, height: int, r: float, steps: int
) -> list[_Pit]:
    """Pits marching from ``start`` toward a point inside the world: a bay or an estuary."""
    tx, ty = _between(rng, 0.3, 0.7) * width, _between(rng, 0.3, 0.7) * height
    length = _dist(start, (tx, ty))
    dx, dy = (tx - start[0]) / length, (ty - start[1]) / length
    pits: list[_Pit] = []
    x, y = start
    for _ in range(steps):
        pits.append(_Pit(x, y, r, 0.8))
        x += (dx + _between(rng, -0.5, 0.5)) * r * 1.1
        y += (dy + _between(rng, -0.5, 0.5)) * r * 1.1
        r *= 0.86
    return pits


def _pits(rng: random.Random, archetype: str, width: int, height: int) -> list[_Pit]:
    """The large water bodies of an archetype; the noise shapes their shores."""
    small = float(min(width, height))
    pits: list[_Pit] = []
    if archetype == "coast":  # a long shore along one side, a bay on another
        side = _pick(rng, (0, 1, 2, 3))
        x, y = _edge_point(rng, width, height, side, small * 0.28)
        pits.append(_Pit(x, y, small * _between(rng, 0.62, 0.8), 1.0))
        x, y = _edge_point(rng, width, height, (side + 1 + 2 * int(rng.random() * 2)) % 4, 60)
        pits.append(_Pit(x, y, small * _between(rng, 0.2, 0.3), 0.8))
    elif archetype == "gulf":  # a deep arm of the sea into the land
        side = _pick(rng, (0, 1, 2, 3))
        start = _edge_point(rng, width, height, side, 40)
        pits += _inland_chain(rng, start, width, height, small * 0.24, 4)
        x, y = _edge_point(rng, width, height, (side + 2) % 4, 90)
        pits.append(_Pit(x, y, small * _between(rng, 0.25, 0.4), 0.9))
    elif archetype == "inland":  # a sea in the middle: the map is a ring around it
        x, y = _between(rng, 0.38, 0.62) * width, _between(rng, 0.38, 0.62) * height
        r = small * _between(rng, 0.2, 0.27)
        pits.append(_Pit(x, y, r * 1.2, 1.1))
        pits.append(_Pit(x + _between(rng, -1, 1) * r, y + _between(rng, -0.6, 0.6) * r, r, 0.9))
        ex, ey = _edge_point(rng, width, height, _pick(rng, (0, 1, 2, 3)), 80)
        pits.append(_Pit(ex, ey, small * _between(rng, 0.25, 0.34), 0.8))
    elif archetype == "straits":  # seas on two opposite sides, a waist of land between them
        side = _pick(rng, (0, 1))
        for s in (side, side + 2):
            x, y = _edge_point(rng, width, height, s, small * 0.14)
            pits.append(_Pit(x, y, small * _between(rng, 0.42, 0.56), 1.0))
    elif archetype == "corners":  # seas in two or three corners, of different sizes
        corners = _shuffled(rng, ((0, 0), (width, 0), (0, height), (width, height)))
        for cx, cy in corners[: 2 + int(rng.random() * 2)]:
            r = small * _between(rng, 0.34, 0.6)
            pits.append(_Pit(cx, cy, r, 1.0))
    else:  # lakes: a land of lakes with a short shore
        for _ in range(3 + int(rng.random() * 2)):
            x, y = _between(rng, 0.15, 0.85) * width, _between(rng, 0.15, 0.85) * height
            pits.append(_Pit(x, y, small * _between(rng, 0.13, 0.2), 0.9))
        x, y = _edge_point(rng, width, height, _pick(rng, (0, 1, 2, 3)), 30)
        pits.append(_Pit(x, y, small * _between(rng, 0.25, 0.32), 0.9))
    return pits


class _Land:
    """The land grid of one map: where water is, and how far from it each cell lies."""

    def __init__(self, rng: random.Random, width: int, height: int) -> None:
        self.width, self.height = width, height
        self.cols, self.rows = width // CELL + 1, height // CELL + 1
        self.archetype = _pick(rng, ARCHETYPES)
        pits = _pits(rng, self.archetype, width, height)
        relief = _Field(rng, width, height, 460.0)
        values: list[float] = []
        for r in range(self.rows):
            for c in range(self.cols):
                x, y = self.centre(c, r)
                v = relief.at(x, y)
                for p in pits:
                    d2 = ((x - p.x) * (x - p.x) + (y - p.y) * (y - p.y)) / (p.r * p.r)
                    if d2 < 1.0:
                        v -= p.depth * (1.0 - d2) * (1.0 - d2)
                values.append(v)
        level = sorted(values)[int(len(values) * _between(rng, 0.11, 0.2))]
        self.water = [v < level for v in values]
        self._tidy()
        self.to_water = self._distance(self.water)
        self.to_land = self._distance([not w for w in self.water])

    def centre(self, c: int, r: int) -> tuple[float, float]:
        return (c + 0.5) * CELL, (r + 0.5) * CELL

    def cell(self, x: float, y: float) -> int:
        c = min(max(int(x / CELL), 0), self.cols - 1)
        r = min(max(int(y / CELL), 0), self.rows - 1)
        return r * self.cols + c

    def parts(self, mask: Sequence[bool]) -> list[list[int]]:
        """4-connected parts of ``mask``, the largest first."""
        seen = [False] * len(mask)
        out: list[list[int]] = []
        for start, on in enumerate(mask):
            if not on or seen[start]:
                continue
            seen[start] = True
            part: list[int] = []
            stack = [start]
            while stack:
                i = stack.pop()
                part.append(i)
                r, c = divmod(i, self.cols)
                for j, ok in (
                    (i - 1, c > 0),
                    (i + 1, c + 1 < self.cols),
                    (i - self.cols, r > 0),
                    (i + self.cols, r + 1 < self.rows),
                ):
                    if ok and mask[j] and not seen[j]:
                        seen[j] = True
                        stack.append(j)
            out.append(part)
        return sorted(out, key=lambda p: (-len(p), p[0]))

    def _tidy(self) -> None:
        """One land: islands sink, and ponds too small for a lake dry up."""
        for part in self.parts([not w for w in self.water])[1:]:
            for i in part:
                self.water[i] = True
        for part in self.parts(self.water):
            if len(part) * CELL * CELL < 26000 and not self.touches_edge(part):
                for i in part:
                    self.water[i] = False

    def touches_edge(self, part: Sequence[int]) -> bool:
        for i in part:
            r, c = divmod(i, self.cols)
            if r in (0, self.rows - 1) or c in (0, self.cols - 1):
                return True
        return False

    def _distance(self, mask: Sequence[bool]) -> list[float]:
        """Distance (world units) from every cell to the nearest ``True`` cell: a chamfer."""
        cols, rows = self.cols, self.rows
        far = 1e9
        d = [0.0 if on else far for on in mask]
        diag = math.sqrt(2.0)
        for r in range(rows):
            for c in range(cols):
                i = r * cols + c
                if c:
                    d[i] = min(d[i], d[i - 1] + 1)
                if r:
                    d[i] = min(d[i], d[i - cols] + 1)
                    if c:
                        d[i] = min(d[i], d[i - cols - 1] + diag)
                    if c + 1 < cols:
                        d[i] = min(d[i], d[i - cols + 1] + diag)
        for r in range(rows - 1, -1, -1):
            for c in range(cols - 1, -1, -1):
                i = r * cols + c
                if c + 1 < cols:
                    d[i] = min(d[i], d[i + 1] + 1)
                if r + 1 < rows:
                    d[i] = min(d[i], d[i + cols] + 1)
                    if c + 1 < cols:
                        d[i] = min(d[i], d[i + cols + 1] + diag)
                    if c:
                        d[i] = min(d[i], d[i + cols - 1] + diag)
        return [v * CELL for v in d]

    def clear_of_water(self, x: float, y: float) -> float:
        return self.to_water[self.cell(x, y)]


# ---- nodes --------------------------------------------------------------------------------------
def _place_nodes(rng: random.Random, land: _Land, count: int) -> list[Point] | None:
    """Poisson-disc points over the land; a noise makes some regions denser than others."""
    width, height = land.width, land.height
    spots = [
        i
        for i in range(len(land.water))
        if land.to_water[i] >= COAST_MARGIN
        and EDGE_MARGIN <= land.centre(i % land.cols, i // land.cols)[0] <= width - EDGE_MARGIN
        and EDGE_MARGIN <= land.centre(i % land.cols, i // land.cols)[1] <= height - EDGE_MARGIN
    ]
    if len(spots) * CELL * CELL < count * 22000:
        return None
    density = _Field(rng, width, height, 520.0)
    base = math.sqrt(0.72 * len(spots) * CELL * CELL / count) * 1.06
    while base > 120.0:
        points: list[Point] = []
        spacing: list[float] = []
        fails = 0
        while len(points) < count and fails < 500:
            i = _pick(rng, spots)
            x, y = land.centre(i % land.cols, i // land.cols)
            p = (int(x + _between(rng, -7, 7)), int(y + _between(rng, -7, 7)))
            r = base * (0.8 + 0.5 * density.at(*p))
            if all(
                _dist(p, q) >= max(min(r, s), 128.0) for q, s in zip(points, spacing, strict=True)
            ):
                points.append(p)
                spacing.append(r)
                fails = 0
            else:
                fails += 1
        if len(points) == count:
            return points
        base *= 0.97
    return None


# ---- roads --------------------------------------------------------------------------------------
def _orient(a: Point, b: Point, c: Point) -> int:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _in_circle(a: Point, b: Point, c: Point, p: Point) -> bool:
    """``p`` is strictly inside the circumcircle of the triangle ``abc``; exact on integers."""
    if _orient(a, b, c) < 0:
        b, c = c, b
    ax, ay = a[0] - p[0], a[1] - p[1]
    bx, by = b[0] - p[0], b[1] - p[1]
    cx, cy = c[0] - p[0], c[1] - p[1]
    det = (
        (ax * ax + ay * ay) * (bx * cy - cx * by)
        - (bx * bx + by * by) * (ax * cy - cx * ay)
        + (cx * cx + cy * cy) * (ax * by - bx * ay)
    )
    return det > 0


def delaunay(points: Sequence[Point]) -> list[Road]:
    """The edges of the Delaunay triangulation (Bowyer-Watson), as sorted pairs of indices."""
    n = len(points)
    big = 40 * max(max(abs(x), abs(y)) for x, y in points) + 1000
    pts = [*points, (-big, -big), (3 * big, -big), (-big, 3 * big)]
    triangles: list[tuple[int, int, int]] = [(n, n + 1, n + 2)]
    for i in range(n):
        p = pts[i]
        bad = [t for t in triangles if _in_circle(pts[t[0]], pts[t[1]], pts[t[2]], p)]
        rim: Counter[Road] = Counter()
        for a, b, c in bad:
            for u, v in ((a, b), (b, c), (c, a)):
                rim[(min(u, v), max(u, v))] += 1
        triangles = [t for t in triangles if t not in bad]
        triangles += [(u, v, i) for (u, v), k in sorted(rim.items()) if k == 1]
    edges: set[Road] = set()
    for a, b, c in triangles:
        for u, v in ((a, b), (b, c), (c, a)):
            if u < n and v < n:
                edges.add((min(u, v), max(u, v)))
    return sorted(edges)


def _over_water(land: _Land, a: Point, b: Point) -> bool:
    steps = max(1, int(_dist(a, b) / (CELL / 2)))
    for k in range(steps + 1):
        x = a[0] + (b[0] - a[0]) * k / steps
        y = a[1] + (b[1] - a[1]) * k / steps
        if land.clear_of_water(x, y) < ROAD_COAST_MARGIN:
            return True
    return False


def has_bridge(count: int, roads: Sequence[Road]) -> bool:
    """One road holds two parts of the graph together, or the graph is in parts already."""
    adjacent: list[list[int]] = [[] for _ in range(count)]
    for a, b in roads:
        adjacent[a].append(b)
        adjacent[b].append(a)
    order = [-1] * count
    low = [0] * count
    clock = 0
    stack: list[tuple[int, int, int]] = [(0, -1, 0)]
    order[0] = low[0] = 0
    while stack:
        node, parent, i = stack.pop()
        if i < len(adjacent[node]):
            stack.append((node, parent, i + 1))
            nxt = adjacent[node][i]
            if nxt == parent:
                continue
            if order[nxt] < 0:
                clock += 1
                order[nxt] = low[nxt] = clock
                stack.append((nxt, node, 0))
            else:
                low[node] = min(low[node], order[nxt])
        elif parent >= 0:
            low[parent] = min(low[parent], low[node])
            if low[node] > order[parent]:
                return True
    return min(order) < 0


def _sharp(points: Sequence[Point], roads: Sequence[Road]) -> list[Road]:
    """Of two roads of a node closer than ``MIN_ROAD_ANGLE_COS``, the longer one."""
    out: set[Road] = set()
    at: dict[int, list[int]] = {}
    for a, b in roads:
        at.setdefault(a, []).append(b)
        at.setdefault(b, []).append(a)
    for node in sorted(at):
        p = points[node]
        for i, u in enumerate(at[node]):
            for v in at[node][i + 1 :]:
                ax, ay = points[u][0] - p[0], points[u][1] - p[1]
                bx, by = points[v][0] - p[0], points[v][1] - p[1]
                la, lb = math.sqrt(ax * ax + ay * ay), math.sqrt(bx * bx + by * by)
                if (ax * bx + ay * by) / (la * lb) > MIN_ROAD_ANGLE_COS:
                    far = u if la > lb else v
                    out.add((min(node, far), max(node, far)))
    return sorted(out)


def _roads(rng: random.Random, land: _Land, points: Sequence[Point]) -> list[Road] | None:
    """A planar, bridgeless road network with the road count of the pool, or ``None``."""
    n = len(points)
    roads = [
        e
        for e in delaunay(points)
        if _dist(points[e[0]], points[e[1]]) <= MAX_ROAD
        and not _over_water(land, points[e[0]], points[e[1]])
    ]
    if len(roads) < n + 2 or has_bridge(n, roads):
        return None
    target = int(n * _between(rng, 1.5, 1.72))

    def degree(node: int) -> int:
        return sum(node in e for e in roads)

    def drop(e: Road) -> bool:
        rest = [r for r in roads if r != e]
        if min(degree(e[0]), degree(e[1])) <= 2 or has_bridge(n, rest):
            return False
        roads.remove(e)
        return True

    for e in _sharp(points, roads):
        if e in roads:
            drop(e)
    for _ in range(3):  # no node above five roads (the validator), a few passes of the worst
        for e in sorted(roads, key=lambda r: -_dist(points[r[0]], points[r[1]])):
            if degree(e[0]) > 5 or degree(e[1]) > 5:
                drop(e)
    if max(degree(i) for i in range(n)) > 5:
        return None
    ranked = sorted(
        roads,
        key=lambda r: (
            -_dist(points[r[0]], points[r[1]]) * _between(rng, 0.7, 1.3)
            - 30 * (degree(r[0]) + degree(r[1]))
        ),
    )
    for e in ranked:
        if len(roads) <= target:
            break
        drop(e)
    return roads


# ---- capitals -----------------------------------------------------------------------------------
def _ticks(a: Point, b: Point) -> int:
    return max(1, int(_dist(a, b) * TICKS_PER_100 / 100 + 0.5))


def _adjacency(points: Sequence[Point], roads: Sequence[Road]) -> Adjacency:
    out: Adjacency = [[] for _ in points]
    for a, b in roads:
        out[a].append((b, _ticks(points[a], points[b])))
        out[b].append((a, _ticks(points[a], points[b])))
    return out


def _capitals(
    rng: random.Random,
    points: Sequence[Point],
    adjacent: Adjacency,
    size: tuple[int, int],
    config: FairnessConfig,
) -> tuple[int, int] | None:
    """The pair of nodes with the most equal access, one of the best few; never a rotated pair."""
    n = len(points)
    times = [shortest(adjacent, i) for i in range(n)]
    hops = [shortest([[(b, 1) for b, _ in row] for row in adjacent], i) for i in range(n)]
    min_hops = 6 if n < 36 else 7
    spacing = math.sqrt(size[0] * size[1] / n)
    best: list[tuple[float, int, int]] = []
    for a in range(n):
        if len(adjacent[a]) < 3:
            continue
        for b in range(a + 1, n):
            if len(adjacent[b]) < 3 or abs(len(adjacent[a]) - len(adjacent[b])) > 1:
                continue
            if hops[a][b] < min_hops or not CAPITAL_TICKS[0] <= times[a][b] <= CAPITAL_TICKS[1]:
                continue
            rotated = (size[0] - points[a][0], size[1] - points[a][1])
            if _dist(rotated, points[b]) < 1.5 * spacing:
                continue
            t0, t1 = times[a], times[b]
            zone = [i for i in range(n) if abs(t0[i] - t1[i]) <= config.contested_ticks]
            if not zone:
                continue
            f0, f1 = min(t0[i] for i in zone), min(t1[i] for i in zone)
            near = sum(t0[i] < t1[i] for i in range(n)) - sum(t1[i] < t0[i] for i in range(n))
            band = sum(abs(hops[a][i] - hops[b][i]) <= 1 for i in range(n))
            if band * 100 < GOAL_NEUTRAL_PCT * n:
                continue
            cost = 100 * abs(f0 - f1) / max(f0, f1) + 3 * abs(near)
            cost += 12 * (len(adjacent[a]) != len(adjacent[b]))
            best.append((cost, a, b))
    if not best:
        return None
    best.sort()
    _, a, b = _pick(rng, best[:4])
    return (a, b) if rng.random() < 0.5 else (b, a)


# ---- attributes ---------------------------------------------------------------------------------
@dataclass(slots=True)
class _Site:
    """A node while its attributes are worked out."""

    id: int
    x: int
    y: int
    t: tuple[int, int]  # ticks from the two capitals
    side: int | None  # the capital that reaches it first, None on a tie
    terrain: Terrain = Terrain.PLAINS
    settle: float = 0.0  # how much the place draws people: the top of a side become cities
    kind: NodeKind = NodeKind.PROVINCE
    vp: int = 0
    owner: int | None = None
    coast: bool = False


def _terrain(rng: random.Random, land: _Land, sites: Sequence[_Site], capitals: Road) -> None:
    """Mountain ranges and forests as patches of two fields over the whole map."""
    width, height = land.width, land.height
    ridge = _Field(rng, width, height, 620.0)
    wet = _Field(rng, width, height, 560.0)

    def height_at(s: _Site) -> float:
        v = 1.0 - 2.0 * abs(ridge.at(s.x, s.y) - 0.5)  # high along the lines of a middle value
        v += 0.12 * min(land.clear_of_water(s.x, s.y) / 400.0, 1.0)  # away from the shore
        for c in capitals:  # each capital stands on its own high ground
            d = _dist((s.x, s.y), (sites[c].x, sites[c].y))
            if d < 300.0:
                v += 0.3 * (1.0 - d / 300.0)
        return v

    rough = sorted(sites, key=lambda s: (-height_at(s), s.id))
    mountains = int(len(sites) * _between(rng, 0.2, 0.3))
    for s in rough[:mountains]:
        s.terrain = Terrain.MOUNTAINS
    rest = sorted(rough[mountains:], key=lambda s: (-wet.at(s.x, s.y), s.id))
    for s in rest[: int(len(sites) * _between(rng, 0.28, 0.38))]:
        s.terrain = Terrain.FOREST
    for c in capitals:
        sites[c].terrain = Terrain.MOUNTAINS


def _settle(rng: random.Random, land: _Land, sites: Sequence[_Site]) -> None:
    """The settlement field: a regional noise, better on plains and by the water."""
    field = _Field(rng, land.width, land.height, 480.0)
    bonus = {Terrain.PLAINS: 0.14, Terrain.FOREST: 0.0, Terrain.MOUNTAINS: -0.16}
    for s in sites:
        s.coast = land.clear_of_water(s.x, s.y) < COAST_MARGIN + 60
        s.settle = field.at(s.x, s.y) + bonus[s.terrain] + (0.1 if s.coast else 0.0)


def _start_plan(count: int) -> tuple[list[NodeKind], int]:
    """The cities of a side at the start, the same for both, and its provinces."""
    own = max(5, (count * START_SHARE_PCT + 50) // 100) - 1
    provinces = (own * 30 + 50) // 100
    cities = own - provinces
    kinds = [NodeKind.CITY_LARGE, NodeKind.CITY_MEDIUM, NodeKind.CITY_SMALL]
    kinds += [NodeKind.CITY_MEDIUM, NodeKind.CITY_SMALL, NodeKind.CITY_SMALL][: cities - 3]
    return kinds[:cities], provinces


def _kinds(rng: random.Random, sites: Sequence[_Site], capitals: Road) -> None:
    """Owners, kinds and VP: from the settlement field, equal counts on the two sides."""
    count = len(sites)
    start_cities, start_provinces = _start_plan(count)
    free: list[list[_Site]] = [[], []]
    for player, c in enumerate(capitals):
        sites[c].owner = player
        sites[c].kind = NodeKind.CAPITAL
        sites[c].vp = 1
        mine = sorted(
            (s for s in sites if s.side == player and s.id != c),
            key=lambda s: (s.t[player], s.id),
        )
        size = len(start_cities) + start_provinces
        own = sorted(mine[:size], key=lambda s: (-s.settle, s.id))
        for s, kind in zip(own, start_cities, strict=False):
            s.kind, s.vp = kind, 1
        for s in mine[:size]:
            s.owner = player
        free[player] = mine[size:]

    # Neutral cities: the same number on both sides, the top of each side by the settlement field.
    cities = int(min(len(free[0]), len(free[1])) * _between(rng, 0.42, 0.56))
    for side in free:
        ranked = sorted(side, key=lambda s: (-s.settle, s.id))[:cities]
        for k, s in enumerate(ranked):
            s.vp = 1
            s.kind = (
                NodeKind.CITY_LARGE
                if k < cities // 4
                else NodeKind.CITY_MEDIUM
                if k < 2 * cities // 3
                else NodeKind.CITY_SMALL
            )

    # Key cities stand near the front: the city closest to a tie takes 3 VP; each side has as
    # many 2 VP cities as the pool, the side with the 3 VP city one less (the VP stay equal).
    twos = 2 if count < 36 else 3
    neutral = [s for s in sites if s.owner is None and s.kind is not NodeKind.PROVINCE]
    key = sorted(neutral, key=lambda s: (abs(s.t[0] - s.t[1]), -s.settle, s.id))
    if not key:
        return
    top = key[0]
    top.vp = 3
    top.kind = NodeKind.CITY_LARGE
    for player in (0, 1):
        want = twos - 1 if top.side == player else twos
        near = [s for s in key[1:] if s.side == player]
        for s in near[:want]:
            s.vp = 2
            if s.kind is NodeKind.CITY_SMALL:
                s.kind = NodeKind.CITY_MEDIUM


START_STOCK: Final = {
    NodeKind.CAPITAL: 6,
    NodeKind.CITY_LARGE: 2,
    NodeKind.CITY_MEDIUM: 2,
    NodeKind.CITY_SMALL: 1,
    NodeKind.PROVINCE: 0,
}


def _level(sites: Sequence[_Site], adjacent: Adjacency, capitals: Road) -> set[Road]:
    """The main roads, up to level 3: the fastest ways from the capitals to the key cities."""
    main: set[Road] = set()
    for c in capitals:
        back = _tree(adjacent, c)
        for s in sites:
            if s.vp >= 2:
                node = s.id
                while node != c:
                    prev = back[node]
                    main.add((min(node, prev), max(node, prev)))
                    node = prev
    return main


def _tree(adjacent: Adjacency, source: int) -> list[int]:
    """The previous node of every node on a fastest way from ``source``."""
    best = shortest(adjacent, source)
    back = [-1] * len(adjacent)
    for node, row in enumerate(adjacent):
        options = [b for b, cost in row if best[b] + cost == best[node]]
        back[node] = min(options) if options else -1
    return back


def _border(a: _Site, b: _Site) -> int:
    """The border point: a long approach to the higher ground (DEC-23, item 5), else the middle."""
    rank = {Terrain.PLAINS: 0, Terrain.FOREST: 1, Terrain.MOUNTAINS: 2}
    return 500 + 60 * (rank[a.terrain] - rank[b.terrain])


# ---- names --------------------------------------------------------------------------------------
def _words(text: str) -> tuple[str, ...]:
    return tuple(text.split())


_STEMS: Final = {
    Terrain.PLAINS: _words(
        "Fair Green Gold Barley Clover Long Broad Sun Hay Mill Amber Lark Bright Wheat Rye Dun"
        " Summer Harrow Sheaf Oat"
    ),
    Terrain.FOREST: _words(
        "Oak Ash Elm Birch Fern Moss Alder Hazel Pine Spruce Thorn Holly Wild Deer Fox Yew Rowan"
        " Bramble Linden Larch"
    ),
    Terrain.MOUNTAINS: _words(
        "Stone Flint Iron Crag Storm Grey High Slate Cold Eagle Wolf Rock Frost Black Scar Raven"
        " Tor Basalt Cairn Winter"
    ),
}
_COAST_STEMS: Final = _words(
    "Salt Gull Sea Tide Shell Reed Heron Mist Pearl Wave Sand Otter Kelp Drift Tern Marsh"
)
_CITY_ENDS: Final = _words("ford ton bury ham wick stead gate field dale mere moor well brook ley")
_COAST_ENDS: Final = _words("haven port mouth quay strand wick")
_HIGH_ENDS: Final = _words("hold watch keep peak fell ridge crest")
_CAPITAL_ENDS: Final = _words("hold crown keep throne spire")
_PROVINCE_ENDS: Final = {
    Terrain.PLAINS: _words("Fields Heath Meadow Downs Lea Common Acres"),
    Terrain.FOREST: _words("Wood Copse Hollow Thicket Glade Grove Weald"),
    Terrain.MOUNTAINS: _words("Pass Scree Bluff Saddle Gorge Heights Rise"),
}


def _name(rng: random.Random, s: _Site, used: set[str]) -> str:
    for _ in range(200):
        stems = _COAST_STEMS if s.coast and rng.random() < 0.6 else _STEMS[s.terrain]
        stem = _pick(rng, stems)
        if s.kind is NodeKind.CAPITAL:
            name = stem + _pick(rng, _CAPITAL_ENDS)
        elif s.kind is NodeKind.PROVINCE:
            name = f"{stem} {_pick(rng, _PROVINCE_ENDS[s.terrain])}"
        elif s.coast and rng.random() < 0.5:
            name = stem + _pick(rng, _COAST_ENDS)
        elif s.terrain is Terrain.MOUNTAINS:
            name = stem + _pick(rng, _HIGH_ENDS)
        else:
            name = stem + _pick(rng, _CITY_ENDS)
        if name not in used:
            used.add(name)
            return name
    raise ValueError("the name lists are too short")  # 200 misses never happen on 55 nodes


# ---- geography ----------------------------------------------------------------------------------
def _water_room(land: _Land) -> list[tuple[str, int, int, float]]:
    """Circles packed into the water of the grid, the largest first: kind, centre and room."""
    sea = {i for part in land.parts(land.water) if land.touches_edge(part) for i in part}
    left = [i for i, w in enumerate(land.water) if w]
    total = len(left)
    circles: list[tuple[str, int, int, float]] = []
    while left and len(circles) < 40 and len(left) * 100 > total * 6:
        i = max(left, key=lambda k: (land.to_land[k], -k))
        room = land.to_land[i]
        if room < 24:
            break
        x, y = land.centre(i % land.cols, i // land.cols)
        circles.append(("sea" if i in sea else "lake", int(x), int(y), room))
        left = [k for k in left if _dist(land.centre(k % land.cols, k // land.cols), (x, y)) > room]
    return circles


def water_share_pct(
    size: tuple[int, int], cells: Sequence[dict[str, Any]], points: Sequence[Point]
) -> int:
    """About how much of the world the baker makes water: a water cell takes the ground nearer to
    its point minus its radius than to any node, and never comes within 60 of a node (DEC-36)."""
    step = 40
    wet = dry = 0
    for y in range(step // 2, size[1], step):
        for x in range(step // 2, size[0], step):
            node = min(_dist((x, y), p) for p in points)
            water = min(_dist((x, y), (c["x"], c["y"])) - c["r"] for c in cells)
            if water < node and node >= 60:
                wet += 1
            else:
                dry += 1
    return 100 * wet // (wet + dry)


def _water_cells(rng: random.Random, land: _Land, points: Sequence[Point]) -> list[dict[str, Any]]:
    """The water cells of a map: the circles, as large as the wanted share of water allows."""
    goal = _between(rng, *WATER_PCT)
    circles = _water_room(land)
    cells: list[dict[str, Any]] = []
    for scale in WATER_RADII:
        cells = [
            {"kind": kind, "x": x, "y": y, "r": int(room * scale)} for kind, x, y, room in circles
        ]
        if water_share_pct((land.width, land.height), cells, points) <= goal:
            break
    return cells


def _rivers(rng: random.Random, land: _Land, sites: Sequence[_Site]) -> list[dict[str, Any]]:
    """Springs on high ground far from the water; the baker routes them along area borders."""
    wanted = 2 + (len(sites) >= 40) + (rng.random() < 0.5)
    hills = [s for s in sites if s.terrain is Terrain.MOUNTAINS] or list(sites)
    springs: list[tuple[int, int]] = []
    rivers: list[dict[str, Any]] = []
    for _ in range(300):
        if len(rivers) >= wanted:
            break
        s = _pick(rng, hills)
        x = int(s.x + _between(rng, -170, 170))
        y = int(s.y + _between(rng, -170, 170))
        if not (0 < x < land.width and 0 < y < land.height):
            continue
        if not 200 <= land.clear_of_water(x, y) <= 620:
            continue
        if min(_dist((x, y), (o.x, o.y)) for o in sites) < 70:
            continue
        if any(_dist((x, y), p) < 340 for p in springs):
            continue
        springs.append((x, y))
        big = rng.random() < 0.6
        rivers.append({"from": [x, y], "w0": 5 if big else 3.5, "w1": 11 if big else 8})
    return rivers


# ---- the map ------------------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class Generated:
    data: dict[str, Any]
    """The map, ``maps/gen/<id>.json``."""
    geo: dict[str, Any]
    """The authored-style geography, ``maps/gen/src/<id>.geo.json``."""
    scores: Scores
    archetype: str
    attempts: int
    """Attempts of this seed up to the accepted one."""


def plan_size(seed: int) -> tuple[int, int, int]:
    """Nodes, width and height of a seed; the world is in multiples of 4 (a ``bake`` rule)."""
    rng = random.Random(f"gow-maps/generate/{GENERATOR_VERSION}/{seed}/size")
    nodes = MIN_NODES + int(rng.random() * (MAX_NODES - MIN_NODES + 1))
    aspect = _between(rng, 1.3, 1.75)
    width = math.sqrt(nodes * AREA_PER_NODE * aspect)
    return nodes, int(width / 4) * 4, int(width / aspect / 4) * 4


def _attempt(
    rng: random.Random, seed: int, config: FairnessConfig
) -> tuple[dict[str, Any], dict[str, Any], str] | None:
    count, width, height = plan_size(seed)
    land = _Land(rng, width, height)
    points = _place_nodes(rng, land, count)
    if points is None:
        return None
    roads = _roads(rng, land, points)
    if roads is None:
        return None
    adjacent = _adjacency(points, roads)
    capitals = _capitals(rng, points, adjacent, (width, height), config)
    if capitals is None:
        return None
    t0, t1 = shortest(adjacent, capitals[0]), shortest(adjacent, capitals[1])
    sites = [
        _Site(i, p[0], p[1], (t0[i], t1[i]), 0 if t0[i] < t1[i] else 1 if t1[i] < t0[i] else None)
        for i, p in enumerate(points)
    ]
    _terrain(rng, land, sites, capitals)
    _settle(rng, land, sites)
    _kinds(rng, sites, capitals)
    main = _level(sites, adjacent, capitals)
    used: set[str] = set()
    name = map_id(seed)
    nodes: list[dict[str, Any]] = []
    for s in sites:
        garrison = 0 if s.owner is None or s.kind is NodeKind.PROVINCE else 2
        if s.kind is NodeKind.CAPITAL:
            garrison = 6
        nodes.append(
            {
                "id": s.id,
                "name": _name(rng, s, used),
                "x": s.x,
                "y": s.y,
                "terrain": s.terrain.value,
                "vp": s.vp,
                "kind": s.kind.value,
                "capital_of": capitals.index(s.id) if s.id in capitals else None,
                "start_owner": s.owner,
                "start_units": garrison,
                "start_charged": garrison,
                "start_stock": START_STOCK[s.kind] if s.owner is not None else 0,
            }
        )
    edges = [
        {
            "id": i,
            "a": a,
            "b": b,
            "max_level": 3 if (a, b) in main else 2,
            "travel_ticks": _ticks(points[a], points[b]),
            "border_permille": _border(sites[a], sites[b]),
        }
        for i, (a, b) in enumerate(roads)
    ]
    data = {
        "meta": {
            "name": name,
            "version": 1,
            "symmetry": "none",
            "width": width,
            "height": height,
        },
        "nodes": nodes,
        "edges": edges,
        "mirror": {
            "nodes": {str(i): i for i in range(len(nodes))},
            "edges": {str(i): i for i in range(len(edges))},
        },
    }
    water = _water_cells(rng, land, points)
    geo = {"map": name, "water": water, "rivers": _rivers(rng, land, sites)}
    return data, geo, land.archetype


def neutral_pct(data: dict[str, Any]) -> int:
    """The check ``neutral_space`` without ``networkx``: contested neutral nodes, in percent."""
    nodes: list[dict[str, Any]] = data["nodes"]
    edges: list[dict[str, int]] = data["edges"]
    adjacent: Adjacency = [[] for _ in nodes]
    for e in edges:
        adjacent[e["a"]].append((e["b"], 1))
        adjacent[e["b"]].append((e["a"], 1))
    capital = {n["capital_of"]: int(n["id"]) for n in nodes if n["capital_of"] is not None}
    d0, d1 = shortest(adjacent, capital[0]), shortest(adjacent, capital[1])
    neutral = 0
    for n in nodes:
        node = int(n["id"])
        neutral += n["start_owner"] is None and abs(d0[node] - d1[node]) <= 1
    return 100 * neutral // len(nodes)


def generate(seed: int, config: FairnessConfig | None = None) -> Generated:
    """The first attempt of ``seed`` that passes the filter. ``ValueError`` if none does."""
    thresholds = load_fairness() if config is None else config
    for attempt in range(MAX_ATTEMPTS):
        rng = random.Random(f"gow-maps/generate/{GENERATOR_VERSION}/{seed}/{attempt}")
        built = _attempt(rng, seed, thresholds)
        if built is None:
            continue
        data, geo, archetype = built
        if neutral_pct(data) < GOAL_NEUTRAL_PCT:
            continue
        scores = score(parse_map(data), thresholds)
        if not check(scores, thresholds):
            return Generated(data, geo, scores, archetype, attempt + 1)
    raise ValueError(f"seed {seed}: no map passed the filter in {MAX_ATTEMPTS} attempts")
