"""Prototype of the DEC-36 map geography for the mockup map-geography.html (issue #537).

NOT project code and NOT a change of gow_maps.bake: a throwaway generator that answers one
question for the owner, "what would a pool map look like with water cells, rivers as area borders
and
areas that touch only along roads". The game, the maps and maps:bake are not touched.

What it does
------------
* reads maps/<name>.json and the authored sidecar docs/design/mockups/src/<name>.geography.json
  (water cells: kind, point, radius; long rivers: a spring point and the water they flow into; node
  moves);
* areas: every cell of a 4-unit grid goes to the nearest "site": a node (its point and the halves of
  its
  roads up to the border point, plus ROAD_BIAS) or a water cell (additively weighted, the coast
  warped
  by a little noise). The borders are warped by the noise of the shipped baker (_Noise.warp); the
  warp fades near roads, so a road always runs through its own two areas and their border crosses it
  at
  the road's border point;
* a stream is cut along every border of two node areas without a road (width grows toward other
  water);
  long rivers are routed along area borders (Dijkstra) from the spring to the water; where a long
  river
  passes a road it does so at the road's border point: a bridge;
* land pieces cut off from their node become the water around them (no slivers, no exclaves);
* vectors: the label grid becomes shared border chains (one polyline per pair of neighbouring
  regions,
  simplified once), so an area ring and its neighbour use the same line;
* the ground: gow_maps.bake.render_background with the cell field replaced by the new areas and
  water
  as a seventh ground (no details), so details thin out toward a shore as they do at a biome edge;
* embeds everything into the mockup between /*GEO:BEGIN*/ and /*GEO:END*/.

Deterministic for a pinned numpy and Pillow (the baker's seeds). Run from the repository root:

    uv run python docs/design/mockups/src/map_geography.py

Pure numpy and Pillow (dependencies of gow-maps); no new dependency.
"""

import base64
import heapq
import io
import json
import random
import sys
from pathlib import Path

import numpy as np
from PIL import Image

from gow_maps import bake as B
from gow_sim.maps import Terrain, load_map

ROOT = Path(__file__).resolve().parents[4]
MOCKUP = ROOT / "docs/design/mockups/map-geography.html"
STEP = 4  # world units per grid cell (the baker's STEP)
ROAD_BIAS = 18.0  # a road half is a little "farther" than the node point: areas do not hug roads
WATER0 = 200  # label of water cell k is WATER0 + k
RIVER = 250  # label of a river or stream cell
FRAG = {"x": 0, "y": 0, "w": 1100, "h": 1240}  # the full-resolution crop shown at zoom 0.7 and up
OUT = -1


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    l2 = dx * dx + dy * dy
    t = np.clip(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1)
    return np.hypot(px - (ax + t * dx), py - (ay + t * dy))


def smoothstep(lo, hi, x):
    t = np.clip((x - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def dist_to_mask(mask, step):
    """Approximate Euclidean distance (world units) to the nearest True cell: two-pass chamfer."""
    h, w = mask.shape
    INF = 1e9
    d = np.where(mask, 0.0, INF)
    a, b = 1.0, 1.4142
    for yy in range(h):
        row = d[yy]
        if yy > 0:
            prev = d[yy - 1]
            row = np.minimum(row, prev + a)
            row = np.minimum(row, np.concatenate(([INF], prev[:-1])) + b)
            row = np.minimum(row, np.concatenate((prev[1:], [INF])) + b)
        for xx in range(1, w):
            if row[xx - 1] + a < row[xx]:
                row[xx] = row[xx - 1] + a
        d[yy] = row
    for yy in range(h - 1, -1, -1):
        row = d[yy]
        if yy < h - 1:
            nxt = d[yy + 1]
            row = np.minimum(row, nxt + a)
            row = np.minimum(row, np.concatenate(([INF], nxt[:-1])) + b)
            row = np.minimum(row, np.concatenate((nxt[1:], [INF])) + b)
        for xx in range(w - 2, -1, -1):
            if row[xx + 1] + a < row[xx]:
                row[xx] = row[xx + 1] + a
        d[yy] = row
    return d * step


def compute2(m, spec, step=STEP):
    """Full prototype: areas, water cells with organic coasts, mandatory rivers, long rivers.

    Returns dict with lab (final labels), pre (labels before rivers), gap (second - best),
    lab2, rivers (list of polylines with half-widths), pos.
    """
    W, H = m.meta.width, m.meta.height
    nodes = sorted(m.nodes, key=lambda n: n.id)
    pos = {n.id: (float(n.x), float(n.y)) for n in nodes}
    for k, v in spec.get("moves", {}).items():
        pos[int(k)] = (float(v[0]), float(v[1]))
    x, y = np.meshgrid(
        np.arange(W // step) * step + step / 2, np.arange(H // step) * step + step / 2
    )
    rng = random.Random(B.map_seed(m))
    noise = B._Noise(rng.uniform(-5000, 5000), rng.uniform(-5000, 5000))
    droad = np.full(x.shape, 1e9)
    halves = {n.id: [] for n in nodes}
    segs = []
    for e in m.edges:
        (ax, ay), (bx, by) = pos[e.a], pos[e.b]
        droad = np.minimum(droad, seg_dist(x, y, ax, ay, bx, by))
        f = e.border_permille / 1000
        px, py = ax + (bx - ax) * f, ay + (by - ay) * f
        halves[e.a].append((ax, ay, px, py))
        halves[e.b].append((bx, by, px, py))
        segs.append((e.id, ax, ay, bx, by, px, py))
    dnode = np.min(np.stack([np.hypot(x - p[0], y - p[1]) for p in pos.values()]), axis=0)
    dx, dy = noise.warp(x, y)
    fade = smoothstep(6, 70, droad)
    wx, wy = x + dx * fade, y + dy * fade
    coast = (
        np.sin(x * 0.043 + y * 0.017 + noise.x) * 0.5
        + np.sin(x * 0.011 - y * 0.051 + noise.y) * 0.35
        + np.sin(x * 0.09 + y * 0.07) * 0.15
    ) * 26.0
    best = np.full(x.shape, 1e9)
    second = np.full(x.shape, 1e9)
    lab = np.zeros(x.shape, np.int32)
    lab2 = np.zeros(x.shape, np.int32)

    def push(label, d):
        nonlocal best, second, lab, lab2
        b1 = d < best
        b2 = (~b1) & (d < second)
        second = np.where(b1, best, np.where(b2, d, second))
        lab2 = np.where(b1, lab, np.where(b2, label, lab2))
        best = np.where(b1, d, best)
        lab = np.where(b1, label, lab)

    for n in nodes:
        d = np.hypot(wx - pos[n.id][0], wy - pos[n.id][1])
        for ax, ay, px, py in halves[n.id]:
            d = np.minimum(d, seg_dist(wx, wy, ax, ay, px, py) + ROAD_BIAS)
        push(n.id, d)
    for k, w in enumerate(spec.get("water", [])):
        d = np.hypot(wx - w["x"], wy - w["y"]) - w.get("r", 0) + coast * smoothstep(20, 80, droad)
        # water never comes closer than `shore` to a road or a node
        d = np.where((droad < w.get("shore", 34)) | (dnode < 60), 1e8, d)
        push(WATER0 + k, d)
    pre = lab.copy()
    road_pair = np.zeros((256, 256), bool)
    for e in m.edges:
        road_pair[e.a, e.b] = road_pair[e.b, e.a] = True
    road_pair[WATER0:, :] = True
    road_pair[:, WATER0:] = True
    gap = second - best
    nodes_both = (lab < WATER0) & (lab2 < WATER0)
    no_road = nodes_both & ~road_pair[np.clip(lab, 0, 255), np.clip(lab2, 0, 255)]
    water0 = lab >= WATER0
    dwater = dist_to_mask(water0, step) if water0.any() else np.full(x.shape, 1e4)
    hw_lo, hw_hi = spec.get("river_hw", [4.5, 9.0])
    hw = hw_lo + (hw_hi - hw_lo) * (1 - smoothstep(0, 480, dwater))
    river = no_road & (gap < 2 * hw)
    # long rivers: routed along area borders (any pair) from a spring to the nearest water
    band = nodes_both & (gap < 2.2 * step) & (dnode > 40)
    long_paths = []
    for rv in spec.get("rivers", []):
        tgt = water0 if "to" not in rv else (lab == WATER0 + rv["to"])
        if "avoid" in rv:
            tgt = tgt & (lab != WATER0 + rv["avoid"])
        path = route(band, tgt, rv["from"], step, x, y)
        if path:
            long_paths.append({"pts": path, "w0": rv.get("w0", 4.0), "w1": rv.get("w1", 11.0)})
    longmask = np.zeros(x.shape, bool)
    for lp in long_paths:
        pts = np.array(lp["pts"], float)
        L = np.concatenate(([0], np.cumsum(np.hypot(*np.diff(pts, axis=0).T))))
        tot = L[-1] or 1
        dmin = np.full(x.shape, 1e9)
        tat = np.zeros(x.shape)
        for k in range(len(pts) - 1):
            d = seg_dist(x, y, pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1])
            upd = d < dmin
            dmin = np.where(upd, d, dmin)
            tat = np.where(upd, L[k] / tot, tat)
        whw = lp["w0"] + (lp["w1"] - lp["w0"]) * tat
        longmask |= dmin < whw
        lp["hw"] = [float(lp["w0"] + (lp["w1"] - lp["w0"]) * d / tot) for d in L]
    out = np.where(river | longmask, RIVER, lab).astype(np.int32)
    for _ in range(6):
        bad = contacts2(out, road_pair)
        if not bad.any():
            break
        out = np.where(bad, RIVER, out)
    # bridges: where a long river crosses a road
    bridges = []
    for eid, ax, ay, bx, by, px, py in segs:
        for lp in long_paths:
            pts = lp["pts"]
            for k in range(len(pts) - 1):
                if seg_x((ax, ay), (bx, by), pts[k], pts[k + 1]):
                    bridges.append(
                        {"edge": int(eid), "x": round(float(px), 1), "y": round(float(py), 1)}
                    )
                    break
    return dict(
        lab=out,
        pre=pre,
        lab2=lab2,
        gap=gap,
        hw=hw,
        river=river,
        long=long_paths,
        bridges=bridges,
        pos=pos,
        x=x,
        y=y,
        road_pair=road_pair,
    )


def seg_x(a, b, c, d):
    def o(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])

    return o(a, b, c) * o(a, b, d) < 0 and o(c, d, a) * o(c, d, b) < 0


def route(band, target, start, step, x, y):
    """Dijkstra over the border band from the band cell nearest to `start` to any target cell."""
    h, w = band.shape
    sy = int(np.clip(start[1] // step, 0, h - 1))
    sx = int(np.clip(start[0] // step, 0, w - 1))
    cand = np.argwhere(band)
    if not len(cand):
        return None
    k = np.argmin((cand[:, 0] - sy) ** 2 + (cand[:, 1] - sx) ** 2)
    sy, sx = cand[k]
    dist = {(sy, sx): 0.0}
    prev = {}
    pq = [(0.0, int(sy), int(sx))]
    goal = None
    while pq:
        d, cy, cx = heapq.heappop(pq)
        if d > dist.get((cy, cx), 1e18):
            continue
        if target[cy, cx]:
            goal = (cy, cx)
            break
        for dy_ in (-1, 0, 1):
            for dx_ in (-1, 0, 1):
                if not dy_ and not dx_:
                    continue
                ny_, nx_ = cy + dy_, cx + dx_
                if not (0 <= ny_ < h and 0 <= nx_ < w):
                    continue
                if not (band[ny_, nx_] or target[ny_, nx_]):
                    continue
                nd = d + (1.4142 if dy_ and dx_ else 1.0)
                if nd < dist.get((ny_, nx_), 1e18):
                    dist[(ny_, nx_)] = nd
                    prev[(ny_, nx_)] = (cy, cx)
                    heapq.heappush(pq, (nd, ny_, nx_))
    if goal is None:
        return None
    path = [goal]
    while path[-1] in prev:
        path.append(prev[path[-1]])
    path.reverse()
    pts = [(float(x[p]), float(y[p])) for p in path]
    return smooth(pts, 3)


def smooth(pts, it=2):
    for _ in range(it):
        if len(pts) < 3:
            break
        out = [pts[0]]
        for a, b in zip(pts[:-1], pts[1:], strict=True):  # noqa: RUF007
            out.append((0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]))
            out.append((0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]))
        out.append(pts[-1])
        pts = out
    return pts


def contacts2(lab, road_pair):
    bad = np.zeros(lab.shape, bool)
    L = np.clip(lab, 0, 255)
    for a, b, sa, sb in (
        (L[:, 1:], L[:, :-1], (slice(None), slice(1, None)), (slice(None), slice(None, -1))),
        (L[1:, :], L[:-1, :], (slice(1, None), slice(None)), (slice(None, -1), slice(None))),
    ):
        mm = (a != b) & (a < WATER0) & (b < WATER0) & ~road_pair[a, b]
        bad[sa] |= mm
        bad[sb] |= mm
    return bad


def node_pairs2(lab):
    out = set()
    for a, b in ((lab[:, 1:], lab[:, :-1]), (lab[1:, :], lab[:-1, :])):
        mm = (a != b) & (a < WATER0) & (b < WATER0)
        for i, j in zip(a[mm].tolist(), b[mm].tolist(), strict=True):
            out.add((min(i, j), max(i, j)))
    return out


# ---- shared border chains ----------------------------------------------------------------------
OUT = -1


def chains(L, step):
    h, w = L.shape
    P = np.full((h + 2, w + 2), OUT, np.int32)
    P[1:-1, 1:-1] = L
    edges = {}  # corner -> list of (other corner, pairkey, (left,right))

    def add(p, q, a, b):
        key = (min(a, b), max(a, b))
        edges.setdefault(p, []).append((q, key))
        edges.setdefault(q, []).append((p, key))

    # vertical lattice edges: between cell (r, c-1) and (r, c) in L coords, corners (r, c)-(r+1, c)
    V = P[1:-1, :-1] != P[1:-1, 1:]
    for r, c in zip(*np.nonzero(V), strict=True):
        a, b = int(P[r + 1, c]), int(P[r + 1, c + 1])
        if a == OUT and b == OUT:
            continue
        add((r, c), (r + 1, c), a, b)
    Hh = P[:-1, 1:-1] != P[1:, 1:-1]
    for r, c in zip(*np.nonzero(Hh), strict=True):
        a, b = int(P[r, c + 1]), int(P[r + 1, c + 1])
        if a == OUT and b == OUT:
            continue
        add((r, c), (r, c + 1), a, b)

    def is_junction(p):
        es = edges[p]
        return len(es) != 2 or es[0][1] != es[1][1]

    used = set()
    out = []

    def walk(start, nxt, key):
        pts = [start, nxt]
        used.add((start, nxt))
        used.add((nxt, start))
        prev, cur = start, nxt
        while not is_junction(cur) and cur != start:
            q = next(e[0] for e in edges[cur] if e[0] != prev)
            if (cur, q) in used:
                break
            used.add((cur, q))
            used.add((q, cur))
            pts.append(q)
            prev, cur = cur, q
        return pts

    for p in list(edges):
        if not is_junction(p):
            continue
        for q, key in edges[p]:
            if (p, q) in used:
                continue
            out.append((key, walk(p, q, key)))
    for p in list(edges):  # closed loops without junctions
        for q, key in edges[p]:
            if (p, q) in used:
                continue
            out.append((key, walk(p, q, key)))
    res = []
    for key, pts in out:
        xy = [(int(c) * step, int(r) * step) for r, c in pts]
        # side labels: cell on the (-dy, dx) side of the first segment
        (x0, y0), (x1, y1) = xy[0], xy[1]
        dx, dy = x1 - x0, y1 - y0
        ln = (dx * dx + dy * dy) ** 0.5
        mx, my = (x0 + x1) / 2 - dy / ln * step / 2, (y0 + y1) / 2 + dx / ln * step / 2
        rr, cc = int(my // step), int(mx // step)
        left = int(L[rr, cc]) if 0 <= rr < h and 0 <= cc < w else OUT
        right = key[1] if left == key[0] else key[0]
        res.append({"l": left, "r": right, "pts": xy})
    return res


def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    a, b = np.array(pts[0]), np.array(pts[-1])
    P = np.array(pts)
    if np.allclose(a, b):
        d = np.hypot(*(P - a).T)
    else:
        ab = b - a
        Q = P - a
        d = np.abs(ab[0] * Q[:, 1] - ab[1] * Q[:, 0]) / np.hypot(*ab)
    i = int(np.argmax(d))
    if d[i] > eps:
        return rdp(pts[: i + 1], eps)[:-1] + rdp(pts[i:], eps)
    return [pts[0], pts[-1]]


def chaikin(pts, it, closed=False):
    for _ in range(it):
        if len(pts) < 3:
            return pts
        out = [] if closed else [pts[0]]
        n = len(pts)
        rng = range(n) if closed else range(n - 1)
        for k in rng:
            a, b = pts[k], pts[(k + 1) % n]
            out.append((0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]))
            out.append((0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]))
        if not closed:
            out.append(pts[-1])
        pts = out
    return pts


def simplify(chs, eps=2.2, it=2):
    for c in chs:
        pts = c["pts"]
        closed = pts[0] == pts[-1]
        if closed:
            body = rdp(pts, eps)
            c["pts"] = chaikin(body[:-1], it, closed=True)
            c["pts"].append(c["pts"][0])
        else:
            c["pts"] = chaikin(rdp(pts, eps), it)
    return chs


def rings(chs, label):
    """Closed rings of `label` (label on the left) assembled from chains."""
    segs = []
    for c in chs:
        if c["l"] == label:
            segs.append(list(c["pts"]))
        elif c["r"] == label:
            segs.append(list(reversed(c["pts"])))
    rings_ = []

    def k(p):
        return (round(p[0], 3), round(p[1], 3))

    starts = {}
    for i, s in enumerate(segs):
        starts.setdefault(k(s[0]), []).append(i)
    used = set()
    for i, s in enumerate(segs):
        if i in used:
            continue
        used.add(i)
        ring = list(s)
        guard = 0
        while k(ring[-1]) != k(ring[0]) and guard < 10000:
            guard += 1
            cand = [j for j in starts.get(k(ring[-1]), []) if j not in used]
            if not cand:
                break
            j = cand[0]
            used.add(j)
            ring += segs[j][1:]
        rings_.append(ring)
    return rings_


# ---- export -------------------------------------------------------------------------------------
def comps(mask):
    h, w = mask.shape
    lab = np.full(mask.shape, -1, np.int32)
    n = 0
    for sy, sx in zip(*np.nonzero(mask), strict=True):
        if lab[sy, sx] >= 0:
            continue
        st = [(sy, sx)]
        lab[sy, sx] = n
        while st:
            y, x = st.pop()
            for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and lab[yy, xx] < 0:
                    lab[yy, xx] = n
                    st.append((yy, xx))
        n += 1
    return lab, n


def fill_islands(grid, pos, step):
    """Land pieces cut off from their node become the water around them (baker rule)."""
    fixed = 0
    for nid, (px, py) in pos.items():
        cl, n = comps(grid == nid)
        if n <= 1:
            continue
        home = cl[int(py // step), int(px // step)]
        for k in range(n):
            if k == home:
                continue
            m = cl == k
            ring = np.zeros_like(m)
            ring[1:] |= m[:-1]
            ring[:-1] |= m[1:]
            ring[:, 1:] |= m[:, :-1]
            ring[:, :-1] |= m[:, 1:]
            ring &= ~m
            vals = grid[ring]
            vals = vals[vals >= WATER0]
            grid[m] = int(np.bincount(vals).argmax()) if len(vals) else RIVER
            fixed += 1
    return fixed


def rnd(pts):
    return [round(v) for p in pts for v in p]


def rle(L, remap):
    rows = []
    for row in L:
        out = []
        prev, run = None, 0
        for v in row.tolist():
            if v == prev:
                run += 1
                continue
            if prev is not None:
                out += [remap[prev], run]
            prev, run = v, 1
        out += [remap[prev], run]
        rows.append(out)
    return rows


def export(m, spec):
    r = compute2(m, spec)
    L = r["lab"].copy()
    islands = fill_islands(L, r["pos"], STEP)
    roads = {(min(e.a, e.b), max(e.a, e.b)) for e in m.edges}
    chs = simplify(chains(L, STEP), eps=3.0, it=0)

    def lab_out(v):
        return v if v < WATER0 else ("river" if v == RIVER else f"w{v - WATER0}")

    streams = []
    for c in chains(r["pre"], STEP):
        a, b = c["l"], c["r"]
        if a < 0 or b < 0 or a >= WATER0 or b >= WATER0 or (min(a, b), max(a, b)) in roads:
            continue
        pts = rdp(c["pts"], 2.0)
        hw = [
            float(
                r["hw"][
                    min(int(p[1] // STEP), L.shape[0] - 1), min(int(p[0] // STEP), L.shape[1] - 1)
                ]
            )
            for p in pts
        ]
        streams.append({"pts": rnd(pts), "hw": [round(v, 1) for v in hw]})
    rivers = []
    for lp in r["long"]:
        pts, hw, keep = lp["pts"], lp["hw"], [0]
        for k in range(1, len(pts)):
            if np.hypot(pts[k][0] - pts[keep[-1]][0], pts[k][1] - pts[keep[-1]][1]) >= 10:
                keep.append(k)
        if keep[-1] != len(pts) - 1:
            keep.append(len(pts) - 1)
        rivers.append({"pts": rnd([pts[k] for k in keep]), "hw": [round(hw[k], 1) for k in keep]})
    remap = {n.id: n.id for n in m.nodes}
    for k in range(len(spec["water"])):
        remap[WATER0 + k] = 60 + k
    remap[RIVER] = 75
    rng = random.Random(B.map_seed(m))
    geo = {
        "map": m.meta.name,
        "W": m.meta.width,
        "H": m.meta.height,
        "step": STEP,
        "moves": spec.get("moves", {}),
        "water": [{"kind": w["kind"]} for w in spec["water"]],
        "chains": [{"l": lab_out(c["l"]), "r": lab_out(c["r"]), "pts": rnd(c["pts"])} for c in chs],
        "streams": streams,
        "rivers": rivers,
        "bridges": r["bridges"],
        "rle": rle(L, remap),
        "noise_now": [rng.uniform(-5000, 5000), rng.uniform(-5000, 5000)],
    }
    pairs = node_pairs2(L)
    print(
        f"{m.meta.name}: touching pairs {len(pairs)}, without a road {len(pairs - roads)}, "
        f"islands filled {islands}, water {100 * float((L >= WATER0).mean()):.1f} %, "
        f"bridges {len(r['bridges'])}"
    )
    return geo, L


def bake_new(m, L):
    """The T2 ground of the new areas: the shipped baker with its cell field replaced."""
    W, H = m.meta.width, m.meta.height
    rng = random.Random(B.map_seed(m))
    noise = B._Noise(rng.uniform(-5000, 5000), rng.uniform(-5000, 5000))
    x, y = np.meshgrid(
        np.arange(W // STEP) * STEP + STEP / 2, np.arange(H // STEP) * STEP + STEP / 2
    )
    moisture = noise.moisture(x, y)
    terr = np.full(256, -1, np.int32)
    for n in m.nodes:
        terr[n.id] = B.TERRAINS.index(n.terrain)
    t = terr[np.clip(L, 0, 255)]
    bi = B.BIOMES.index
    out = np.where(
        t == B.TERRAINS.index(Terrain.PLAINS),
        np.where(moisture < 0.3, bi(B.Biome.SAVANNA), bi(B.Biome.STEPPE)),
        np.where(
            t == B.TERRAINS.index(Terrain.FOREST),
            np.where(moisture >= 0.65, bi(B.Biome.JUNGLE), bi(B.Biome.FOREST)),
            np.where(moisture >= B.SNOW_MOISTURE, bi(B.Biome.SNOW), bi(B.Biome.ROCK)),
        ),
    )
    out = np.where(L >= WATER0, len(B.BIOMES), out).astype(np.uint8)
    # a seventh ground: muddy, no details (the mockup paints the water)
    B.BIOMES = (*B.BIOMES, "water")
    B.GROUND["water"] = ((74, 98, 96), (66, 90, 90))
    B.SPRITES["water"] = (9999, lambda d, x, y, s, r: None)
    B.cell_indices = lambda mapdef, seed: out
    return Image.fromarray(B.render_background(m), "RGB")


def webp(img, q=68):
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=q, method=6)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


def main(name="ridge"):
    m = load_map(ROOT / f"maps/{name}.json")
    spec = json.loads((Path(__file__).parent / f"{name}.geography.json").read_text())
    geo, L = export(m, spec)
    new = bake_new(m, L)
    now = Image.open(ROOT / f"maps/{name}.bg.webp").convert("RGB")
    box = (FRAG["x"], FRAG["y"], FRAG["x"] + FRAG["w"], FRAG["y"] + FRAG["h"])
    half = (m.meta.width // 2, m.meta.height // 2)
    imgs = {
        "frag": FRAG,
        "now": {
            "half": webp(now.resize(half, Image.Resampling.LANCZOS)),
            "frag": webp(now.crop(box)),
        },
        "new": {
            "half": webp(new.resize(half, Image.Resampling.LANCZOS)),
            "frag": webp(new.crop(box)),
        },
    }
    tk = {"plains": "p", "forest": "f", "mountains": "m"}
    kk = {"capital": "C", "city_large": "L", "city_medium": "M", "city_small": "S", "province": "P"}
    nodes = [[n.id, n.name, n.x, n.y, tk[n.terrain.value], kk[n.kind.value], n.vp] for n in m.nodes]
    edges = [[e.id, e.a, e.b, e.max_level, e.travel_ticks, e.border_permille] for e in m.edges]
    data = (
        "const MAP_NODES = " + json.dumps(nodes, separators=(",", ":")) + ";\n"
        "const MAP_EDGES = "
        + json.dumps(edges, separators=(",", ":"))
        + ";   // id, a, b, max_level, travel_ticks, border_permille\n"
        "const GEO = " + json.dumps(geo, separators=(",", ":")) + ";\n"
        "const GEO_IMG = " + json.dumps(imgs, separators=(",", ":")) + ";\n"
    )
    html = MOCKUP.read_text()
    a, b = html.index("/*GEO:BEGIN*/") + len("/*GEO:BEGIN*/"), html.index("/*GEO:END*/")
    MOCKUP.write_text(html[:a] + "\n" + data + html[b:])
    print(f"wrote {MOCKUP.relative_to(ROOT)}: {MOCKUP.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main(*sys.argv[1:])
