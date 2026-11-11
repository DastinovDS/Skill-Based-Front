/**
 * The runs of the road fortifications (DEC-43, item D; #707): the stretch of the border of the own
 * cell a wall lies along. A run covers the whole stretch of the border with the cell the road leads to
 * (it ends square where that border ends or turns by more than `FORT.trim` degrees, so it never wraps a
 * cell corner) and bends with the gentle curves of that border (#734); the walls of one node on
 * neighbouring stretches are one run round the ring (`stretchRun`, #858). The look of the walls is
 * `wallLayout.ts`.
 *
 * Pure functions, no PixiJS and no DOM. Nothing here knows a rule: the server says which road of
 * which node is fortified and whether it is built (`EdgeView.forts`); the client only draws it.
 */
import type { Point } from './camera.ts';
import type { CellEdge } from './regionLayout.ts';

/** Where a run is cut short (degrees). */
const FORT = {
  /** The border run is trimmed where it turns by more than this (degrees)... */
  trim: 38,
  /** ...or has turned by more than this in all since the crossing (a corner rounded into a gentle curve). */
  drift: 70,
} as const;

/** A piece of the border of the cell that a fortification lies along. */
export interface Run {
  readonly pts: readonly Point[];
  /** Arc length of each point from the first one. */
  readonly s: readonly number[];
  /** Arc length of the road crossing. */
  readonly s0: number;
  readonly len: number;
  /** Unit normal of each segment, pointing out of the cell (towards the border and the next node). */
  readonly normals: readonly Point[];
  /** The crossing on the ring of the cell (arc length from the first edge of the ring), and the ring's length. */
  readonly ringAt: number;
  readonly ringLength: number;
}

export interface RunInput {
  /** The edges of the cell of the fortified node, in order round the polygon. */
  readonly ring: readonly CellEdge[];
  /** The edge lies on the border the fortification follows (the cell across it is the road's other side). */
  readonly shared: (edge: CellEdge) => boolean;
  /** Where the road crosses the border: the border point of the road. */
  readonly cross: Point;
  /** The node, to tell which side of an edge is out of its cell when the edge has no `inward`. */
  readonly node: Point;
  /** How far the run may reach from the crossing on each side; by default as far as the border goes. */
  readonly half?: number;
}

const dist = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

/** The point of the segment `a`-`b` nearest to `p`, and how far along it is (0..1). */
function nearestOnSegment(p: Point, a: Point, b: Point): { at: Point; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return { at: { x: a.x + dx * t, y: a.y + dy * t }, t };
}

/** The turn of the border between two directions, degrees (0 is straight on). */
export function turnDegrees(d1: Point, d2: Point): number {
  return (
    (Math.abs(Math.atan2(d1.x * d2.y - d1.y * d2.x, d1.x * d2.x + d1.y * d2.y)) * 180) / Math.PI
  );
}

function outwardNormal(edge: CellEdge, node: Point): Point {
  const dx = edge.b.x - edge.a.x;
  const dy = edge.b.y - edge.a.y;
  const l = Math.hypot(dx, dy) || 1;
  let n = { x: dy / l, y: -dx / l };
  if (edge.inward !== undefined) {
    // Set for non-convex areas, whose node cannot tell the side.
    if (n.x * edge.inward.x + n.y * edge.inward.y > 0) n = { x: -n.x, y: -n.y };
    return n;
  }
  const mid = { x: (edge.a.x + edge.b.x) / 2, y: (edge.a.y + edge.b.y) / 2 };
  if (n.x * (mid.x - node.x) + n.y * (mid.y - node.y) < 0) n = { x: -n.x, y: -n.y };
  return n;
}

/** Two points closer than this (world units) are one: the end of an edge and the start of the next. */
const JOIN = 0.5;

/**
 * The edges of one cell in order round the polygon, each starting where the previous one ends. The
 * edges of a Voronoi cell are in that order already; the pieces of a geography come in the order of the
 * baker's chains, so they are joined by their end points. A cell that does not close is returned in the
 * order found (the run stops at a gap).
 */
export function ringOrder(edges: readonly CellEdge[]): CellEdge[] {
  const key = (p: Point): string => `${String(p.x)},${String(p.y)}`;
  const starts = new Map<string, number[]>();
  edges.forEach((edge, i) => {
    const k = key(edge.a);
    starts.set(k, [...(starts.get(k) ?? []), i]);
  });
  const used = new Set<number>();
  const out: CellEdge[] = [];
  for (let first = 0; first < edges.length; first++) {
    let at: number | undefined = first;
    while (at !== undefined && !used.has(at)) {
      used.add(at);
      const edge = edges[at] as CellEdge;
      out.push(edge);
      at = starts.get(key(edge.b))?.find((j) => !used.has(j));
    }
  }
  return out;
}

/** How far each side of a vertex the direction of the border is taken from to judge a turn (world units). */
const TURN_WINDOW = 12;

/**
 * The run of the border of a cell that a fortification at `cross` lies along: from the nearest shared
 * edge both ways, stopping where the shared border ends or turns by more than `FORT.trim` degrees (a
 * turn is judged over `TURN_WINDOW` on each side, so a corner a geography has rounded into many short
 * steps still counts), or has turned by more than `FORT.drift` since the crossing, or (when given)
 * `half` from the crossing. `null` when the cell has no shared edge (the caller draws a straight stub
 * then).
 */
export function borderRun(input: RunInput): Run | null {
  const { ring, shared, cross, node } = input;
  const half = input.half ?? Infinity;
  const n = ring.length;
  let e = -1;
  let best = Infinity;
  let at: Point = cross;
  let along = 0;
  ring.forEach((edge, i) => {
    if (!shared(edge)) return;
    const near = nearestOnSegment(cross, edge.a, edge.b);
    const d = dist(near.at, cross);
    if (d < best) {
      best = d;
      e = i;
      at = near.at;
      along = near.t;
    }
  });
  const first = ring[e];
  if (first === undefined) return null;
  // The points of the shared border from the crossing outwards, to `reach` along it (no turn limit yet).
  const reach = half + TURN_WINDOW;
  const walk = (dir: 1 | -1): Point[] => {
    const pts: Point[] = [];
    let rem = reach;
    let cur = at;
    let i = e;
    for (let guard = 0; guard < n; guard++) {
      const edge = ring[i] as CellEdge;
      const target = dir > 0 ? edge.b : edge.a;
      const d = dist(cur, target);
      if (d >= rem) {
        const k = d === 0 ? 0 : rem / d;
        pts.push({ x: cur.x + (target.x - cur.x) * k, y: cur.y + (target.y - cur.y) * k });
        break;
      }
      pts.push(target);
      rem -= d;
      cur = target;
      const j = (i + dir + n) % n;
      const next = ring[j] as CellEdge;
      // The border ends at an edge that is not shared, at a gap, and when it has come full circle.
      if (j === e || !shared(next) || dist(target, dir > 0 ? next.a : next.b) > JOIN) break;
      i = j;
    }
    return pts;
  };
  const raw: Point[] = [...walk(-1).reverse(), at, ...walk(1)];
  const pts: Point[] = [];
  const arc: number[] = [];
  let total = 0;
  let crossing = 0;
  for (const p of raw) {
    const prev = pts[pts.length - 1];
    if (prev !== undefined) {
      const d = dist(prev, p);
      if (d < 0.01) {
        if (dist(p, at) < 0.02) crossing = total;
        continue;
      }
      total += d;
    }
    if (dist(p, at) < 0.02) crossing = total;
    pts.push(p);
    arc.push(total);
  }
  if (pts.length < 2) return null;
  // The point of the raw polyline at arc length `s`.
  const sample = (s: number): Point => {
    const t = Math.max(0, Math.min(total, s));
    let j = 0;
    while (j < pts.length - 2 && (arc[j + 1] ?? 0) < t) j++;
    const a = pts[j] as Point;
    const b = pts[j + 1] as Point;
    const span = (arc[j + 1] ?? 0) - (arc[j] ?? 0);
    const u = span > 0 ? (t - (arc[j] ?? 0)) / span : 0;
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
  };
  // The direction of the border round a point: the chord over `TURN_WINDOW` each way.
  const headingAt = (s: number): Point => {
    const before = sample(s - TURN_WINDOW);
    const after = sample(s + TURN_WINDOW);
    return { x: after.x - before.x, y: after.y - before.y };
  };
  const heading0 = headingAt(crossing);
  const bad = (k: number): boolean => {
    const s = arc[k] ?? 0;
    const behind = Math.min(TURN_WINDOW, s);
    const ahead = Math.min(TURN_WINDOW, total - s);
    if (behind < 1 || ahead < 1) return false;
    const p = pts[k] as Point;
    const before = sample(s - behind);
    const after = sample(s + ahead);
    const sharp =
      turnDegrees(
        { x: p.x - before.x, y: p.y - before.y },
        { x: after.x - p.x, y: after.y - p.y },
      ) > FORT.trim;
    return sharp || turnDegrees(heading0, headingAt(s)) > FORT.drift;
  };
  // The first sharp turn each side of the crossing ends the run there.
  let lo = 0;
  for (let k = pts.length - 1; k >= 0; k--) {
    if ((arc[k] ?? 0) < crossing - 0.01 && bad(k)) {
      lo = k;
      break;
    }
  }
  let hi = pts.length - 1;
  for (let k = 0; k < pts.length; k++) {
    if ((arc[k] ?? 0) > crossing + 0.01 && bad(k)) {
      hi = k;
      break;
    }
  }
  // Cut to `half` each way, by interpolation.
  const sLo = Math.max(arc[lo] ?? 0, crossing - half);
  const sHi = Math.min(arc[hi] ?? total, crossing + half);
  const cut: Point[] = [sample(sLo)];
  const cutArc: number[] = [0];
  let acc = 0;
  for (let k = 0; k < pts.length; k++) {
    const s = arc[k] ?? 0;
    if (s <= sLo + 0.01 || s >= sHi - 0.01) continue;
    const p = pts[k] as Point;
    acc += dist(cut[cut.length - 1] as Point, p);
    cut.push(p);
    cutArc.push(acc);
  }
  const end = sample(sHi);
  acc += dist(cut[cut.length - 1] as Point, end);
  cut.push(end);
  cutArc.push(acc);
  if (cut.length < 2 || acc < 1) return null;
  const normals: Point[] = [];
  for (let k = 0; k < cut.length - 1; k++) {
    const a = cut[k] as Point;
    const b = cut[k + 1] as Point;
    const l = dist(a, b) || 1;
    let nx = (b.y - a.y) / l;
    let ny = -(b.x - a.x) / l;
    // Out of the cell: the side the ring edge this piece lies on says.
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const out = outwardNormal(nearestEdge(ring, mid, shared) ?? first, node);
    if (nx * out.x + ny * out.y < 0) {
      nx = -nx;
      ny = -ny;
    }
    normals.push({ x: nx, y: ny });
  }
  let ringAt = 0;
  for (let k = 0; k < e; k++) ringAt += dist((ring[k] as CellEdge).a, (ring[k] as CellEdge).b);
  ringAt += dist(first.a, first.b) * along;
  let ringLength = 0;
  for (const edge of ring) ringLength += dist(edge.a, edge.b);
  return {
    pts: cut,
    s: cutArc,
    s0: Math.max(0, Math.min(acc, crossing - sLo)),
    len: acc,
    normals,
    ringAt,
    ringLength,
  };
}

/** The ring edge a point of the run lies on (the nearest shared one). */
function nearestEdge(
  ring: readonly CellEdge[],
  p: Point,
  shared: (edge: CellEdge) => boolean,
): CellEdge | undefined {
  let best: CellEdge | undefined;
  let bestDistance = Infinity;
  for (const edge of ring) {
    if (!shared(edge)) continue;
    const d = dist(nearestOnSegment(p, edge.a, edge.b).at, p);
    if (d < bestDistance) {
      bestDistance = d;
      best = edge;
    }
  }
  return best;
}

/**
 * The run along the ring of a cell from ring arc `from` to `to` (`to > from`; either may lie past
 * the ring's end, the ring is closed): what a wall of several roads of one node lies along when
 * they are one stroke (#858). `s0` is 0 (the arcs of the run count from `from`). `null` when the
 * stretch is empty or the ring has a gap inside it (a cell that does not close there).
 */
export function stretchRun(
  ring: readonly CellEdge[],
  node: Point,
  from: number,
  to: number,
): Run | null {
  const lengths = ring.map((edge) => dist(edge.a, edge.b));
  const ringLength = lengths.reduce((sum, l) => sum + l, 0);
  if (!(ringLength > 0) || !(to - from >= 1) || to - from > ringLength + 0.01) return null;
  // The stretch moved by whole rings so that it starts on the first lap.
  const k = Math.floor(from / ringLength);
  const lo = from - k * ringLength;
  const hi = to - k * ringLength;
  const pts: Point[] = [];
  const arc: number[] = [];
  const normals: Point[] = [];
  let total = 0;
  let start = 0;
  for (let lap = 0; lap < 3 && start < hi; lap++) {
    for (let i = 0; i < ring.length && start < hi; i++) {
      const edge = ring[i] as CellEdge;
      const length = lengths[i] ?? 0;
      const a = Math.max(start, lo);
      const b = Math.min(start + length, hi);
      start += length;
      if (b - a < 1e-6 || length <= 0) continue;
      const at = (s: number): Point => {
        const u = (s - (start - length)) / length;
        return { x: edge.a.x + (edge.b.x - edge.a.x) * u, y: edge.a.y + (edge.b.y - edge.a.y) * u };
      };
      const pa = at(a);
      const pb = at(b);
      const last = pts[pts.length - 1];
      if (last === undefined) {
        pts.push(pa);
        arc.push(0);
      } else if (dist(last, pa) > JOIN) return null;
      const step = dist(pts[pts.length - 1] as Point, pb);
      if (step < 0.01) continue;
      total += step;
      pts.push(pb);
      arc.push(total);
      normals.push(outwardNormal(edge, node));
    }
  }
  if (pts.length < 2 || total < 1) return null;
  return { pts, s: arc, s0: 0, len: total, normals, ringAt: from, ringLength };
}

/** A straight run across the road when the cell has no shared edge: perpendicular to the road at `cross`. */
export function stubRun(node: Point, cross: Point, half: number): Run {
  const dx = cross.x - node.x;
  const dy = cross.y - node.y;
  const l = Math.hypot(dx, dy) || 1;
  const n = { x: dx / l, y: dy / l };
  const t = { x: -n.y, y: n.x };
  const a = { x: cross.x - t.x * half, y: cross.y - t.y * half };
  const b = { x: cross.x + t.x * half, y: cross.y + t.y * half };
  return {
    pts: [a, b],
    s: [0, 2 * half],
    s0: half,
    len: 2 * half,
    normals: [n],
    ringAt: 0,
    ringLength: 0,
  };
}

export interface RunPoint {
  readonly x: number;
  readonly y: number;
  /** Unit tangent and outward normal at the point (the normal averaged at a vertex), and the miter factor. */
  readonly tx: number;
  readonly ty: number;
  readonly nx: number;
  readonly ny: number;
  readonly m: number;
}

/** The point of the run at arc length `s`, with the averaged normal at a vertex. */
export function runPoint(run: Run, s: number): RunPoint {
  const at = Math.max(0, Math.min(run.len, s));
  let j = 0;
  while (j < run.normals.length - 1 && (run.s[j + 1] ?? 0) < at) j++;
  const a = run.pts[j] as Point;
  const b = run.pts[j + 1] as Point;
  const sa = run.s[j] ?? 0;
  const sb = run.s[j + 1] ?? 0;
  const u = (at - sa) / Math.max(1e-6, sb - sa);
  const seg = run.normals[j] as Point;
  const d = dist(a, b) || 1;
  const tx = (b.x - a.x) / d;
  const ty = (b.y - a.y) / d;
  let nx = seg.x;
  let ny = seg.y;
  let m = 1;
  const atStart = u < 0.001 && j > 0;
  const atEnd = u > 0.999 && j < run.normals.length - 1;
  if (atStart || atEnd) {
    const other = run.normals[atStart ? j - 1 : j + 1] as Point;
    nx = seg.x + other.x;
    ny = seg.y + other.y;
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    // The offset of a bend is longer than the offset of a straight piece, so the moved line stays parallel.
    m = 1 / Math.max(0.45, nx * seg.x + ny * seg.y);
  }
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, tx, ty, nx, ny, m };
}

/** The arc lengths between `a0` and `a1` (relative to the crossing), with every vertex of the run between them. */
function arcs(run: Run, a0: number, a1: number): number[] {
  const lo = Math.max(0, Math.min(run.len, run.s0 + a0));
  const hi = Math.max(0, Math.min(run.len, run.s0 + a1));
  const out = [lo];
  for (const s of run.s) if (s > lo + 0.01 && s < hi - 0.01) out.push(s);
  out.push(hi);
  return out;
}

/** The run between `a0` and `a1` (relative to the crossing) moved out of the border by `off` (negative: into the cell). */
export function runLine(run: Run, a0: number, a1: number, off: number): Point[] {
  const line: Point[] = [];
  for (const s of arcs(run, a0, a1)) {
    const q = runPoint(run, s);
    const p = { x: q.x + q.nx * off * q.m, y: q.y + q.ny * off * q.m };
    const prev = line[line.length - 1];
    if (prev !== undefined) {
      // A move against the border's own direction is a fold (a bend too tight for the offset): skip the point.
      const dir = { x: p.x - prev.x, y: p.y - prev.y };
      if (dir.x * q.tx + dir.y * q.ty < 0) continue;
    }
    line.push(p);
  }
  return line;
}

/** Where a run lies on the ring of its cell: from its first point to its last (arc length, may pass the ring's end). */
export function ringStretch(run: Run): { readonly from: number; readonly to: number } {
  const from = run.ringAt - run.s0;
  return { from, to: from + run.len };
}

/** Two runs closer than this on one ring (world units) are not on one stretch: they only touch at a vertex. */
const TOUCH = 1;

/**
 * Which of the forts of one node lie one over another (their stretches of the ring of the cell
 * overlap; `ringLength` 0 is a stub, which overlaps the other stubs of the node only): the stack level of
 * each, 0 for the first, 1 for one moved further into the cell, and so on.
 */
export function stackLevels(
  forts: readonly {
    readonly key: string;
    readonly from: number;
    readonly to: number;
    readonly ringLength: number;
  }[],
): Map<string, number> {
  const levels = new Map<string, number>();
  const placed: { from: number; to: number; ringLength: number; level: number }[] = [];
  const overlaps = (a: (typeof placed)[number], b: (typeof placed)[number]): boolean => {
    if (a.ringLength <= 0 || b.ringLength <= 0) return a.ringLength <= 0 && b.ringLength <= 0;
    const ring = a.ringLength;
    // The ring is closed: a stretch past its end meets one at its start.
    return [-ring, 0, ring].some(
      (k) => Math.min(a.to, b.to + k) - Math.max(a.from, b.from + k) > TOUCH,
    );
  };
  for (const fort of forts) {
    const here = { from: fort.from, to: fort.to, ringLength: fort.ringLength, level: 0 };
    const taken = new Set<number>();
    for (const other of placed) if (overlaps(here, other)) taken.add(other.level);
    while (taken.has(here.level)) here.level++;
    levels.set(fort.key, here.level);
    placed.push(here);
  }
  return levels;
}
