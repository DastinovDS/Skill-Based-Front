/**
 * Geometry of the road fortifications (DEC-43, item D; #707; ui-style 42, the look C7 "Long run"):
 * a flat stroke inside the own cell, parallel to the territory border at the road crossing, with
 * fine ticks on its outer side. It follows the border of the cell as far as the shared border goes
 * (it ends square where the run ends or turns by more than `FORT.trim` degrees, so it never wraps a
 * cell corner) and bends with the gentle curves of that border.
 *
 * Pure functions, no PixiJS and no DOM. Nothing here knows a rule: the server says which road of
 * which node is fortified and whether it is built (`EdgeView.forts`); the client only draws it.
 */
import type { Point } from './camera.ts';
import type { CellEdge } from './regionLayout.ts';

/** The look C7 "Long run", in world units at zoom 1 (docs/design/mockups/fortifications.html, round 4). */
export const FORT = {
  /** The run along the border that the ticks are laid on (not scaled by the zoom: zoomed out fewer ticks fit). */
  runLength: 170,
  /** The stroke width, and how far it lies inside the own cell. */
  line: 3,
  offset: 8.5,
  /** The ticks on the border side of the stroke. */
  tickLength: 5,
  tickWidth: 3,
  tickGap: 4,
  /** At least this many ticks, however far out the map is zoomed. */
  minTicks: 3,
  /** The soft dark halo under the stroke: its width, its alpha, and its distance from the border line. */
  haloWidth: 14,
  haloAlpha: 0.4,
  haloClear: 3,
  /** The border run is trimmed where it turns by more than this (degrees)... */
  trim: 38,
  /** ...or has turned by more than this in all since the crossing (a corner rounded into a gentle curve). */
  drift: 70,
  /** A second line on the same stretch lies this much further inside the cell. */
  stackStep: 20,
  /** The run reaches this much beyond the last tick. */
  reach: 8,
  /** Lighter tone of the owner colour: own, enemy (both lighter than the territory, the side reads by position). */
  lightenOwn: 0.3,
  lightenEnemy: 0.38,
  /** The shield marker of the pick is not used (P1 "Ghosts"): a pickable crossing shows this much of the line. */
  ghostAlpha: 0.38,
  ghostHoverAlpha: 0.95,
} as const;

/** Marks grow when the map is zoomed out (like the construction plate): the factor for a camera scale. */
export function markScale(cameraScale: number): number {
  if (!(cameraScale > 0) || cameraScale >= 1) return 1;
  // Bucketed to eighths, so a gliding camera redraws the lines a few times, not every frame.
  return Math.round(Math.pow(1 / cameraScale, 0.6) * 8) / 8;
}

export interface TickLayout {
  readonly n: number;
  readonly tw: number;
  readonly gap: number;
  readonly tl: number;
  readonly lw: number;
  readonly off: number;
  /** Centres of the ticks along the run, relative to the crossing. */
  readonly cs: readonly number[];
  /** Half of the stretch the ticks cover, and the same plus the reach: what the run has to cover. */
  readonly half: number;
  readonly reach: number;
}

/** The number and place of the ticks for the mark scale `mk`: sizes grow, the run length does not. */
export function tickLayout(mk: number): TickLayout {
  const tw = FORT.tickWidth * mk;
  const gap = FORT.tickGap * mk;
  const n = Math.max(FORT.minTicks, Math.floor((FORT.runLength + gap) / (tw + gap)));
  const used = n * tw + (n - 1) * gap;
  const cs = Array.from({ length: n }, (_, i) => -used / 2 + tw / 2 + i * (tw + gap));
  const half = used / 2 + gap * 0.5;
  return {
    n,
    tw,
    gap,
    tl: FORT.tickLength * mk,
    lw: FORT.line * mk,
    off: FORT.offset * mk,
    cs,
    half,
    reach: FORT.reach * mk,
  };
}

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
  /** How far the run reaches from the crossing on each side. */
  readonly half: number;
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
 * edge, `half` each way, stopping where the shared border ends or turns by more than `FORT.trim`
 * degrees (a turn is judged over `TURN_WINDOW` on each side, so a corner a geography has rounded
 * into many short steps still counts). `null` when the cell has no shared edge (the caller draws a
 * straight stub then).
 */
export function borderRun(input: RunInput): Run | null {
  const { ring, shared, cross, node, half } = input;
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

/** A band of the run between offsets `h0` and `h1` (out of the border positive), as one polygon. */
export function runStrip(run: Run, a0: number, a1: number, h0: number, h1: number): Point[] {
  const ss = arcs(run, a0, a1);
  const first: Point[] = [];
  const second: Point[] = [];
  for (const s of ss) {
    const q = runPoint(run, s);
    first.push({ x: q.x + q.nx * h0 * q.m, y: q.y + q.ny * h0 * q.m });
    second.push({ x: q.x + q.nx * h1 * q.m, y: q.y + q.ny * h1 * q.m });
  }
  return [...first, ...second.reverse()];
}

/**
 * A tick: a thin quadrilateral standing on the stroke (`off` inside the border), reaching `length`
 * towards the border. `a` is its centre along the run, relative to the crossing.
 */
export function tickPolygon(
  run: Run,
  a: number,
  width: number,
  off: number,
  lineWidth: number,
  length: number,
): Point[] {
  const at = (aa: number, h: number): Point => {
    const q = runPoint(run, run.s0 + Math.max(-run.s0, Math.min(run.len - run.s0, aa)));
    return { x: q.x + q.nx * h * q.m, y: q.y + q.ny * h * q.m };
  };
  const h0 = -off - lineWidth * 0.3;
  const h1 = -off + length;
  return [
    at(a - width / 2, h0),
    at(a + width / 2, h0),
    at(a + width / 2, h1),
    at(a - width / 2, h1),
  ];
}

/** Whether the tick at `a` lies on the run (a tick off its end is dropped). */
export function tickFits(run: Run, a: number, width: number): boolean {
  return a - width / 2 >= -run.s0 && a + width / 2 <= run.len - run.s0;
}

/** Dashes along a polyline: pieces of length `dash` with `gap` between, as pairs of points (a piece may bend). */
export function dashAlong(line: readonly Point[], dash: number, gap: number): Point[][] {
  const pieces: Point[][] = [];
  let current: Point[] | null = null;
  let inDash = true;
  let left = dash;
  for (let i = 0; i + 1 < line.length; i++) {
    let a = line[i] as Point;
    const b = line[i + 1] as Point;
    let segment = dist(a, b);
    while (segment > 1e-9) {
      const step = Math.min(left, segment);
      const k = step / segment;
      const mid = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      if (inDash) {
        current ??= [a];
        current.push(mid);
      }
      segment -= step;
      left -= step;
      a = mid;
      if (left <= 1e-9) {
        if (inDash && current !== null) pieces.push(current);
        current = null;
        inDash = !inDash;
        left = inDash ? dash : gap;
      }
    }
  }
  if (inDash && current !== null && current.length > 1) pieces.push(current);
  return pieces;
}

/**
 * Which of the forts of one node lie one over another (their runs overlap on the ring of the cell):
 * the stack level of each, 0 for the first, 1 for one moved further into the cell, and so on.
 */
export function stackLevels(
  forts: readonly { readonly key: string; readonly ringAt: number; readonly ringLength: number }[],
  overlap: number,
): Map<string, number> {
  const levels = new Map<string, number>();
  const placed: { ringAt: number; ringLength: number; level: number }[] = [];
  for (const fort of forts) {
    const taken = new Set<number>();
    for (const other of placed) {
      let d = Math.abs(fort.ringAt - other.ringAt);
      if (fort.ringLength > 0) d = Math.min(d, fort.ringLength - d);
      if (d < overlap) taken.add(other.level);
    }
    let level = 0;
    while (taken.has(level)) level++;
    levels.set(fort.key, level);
    placed.push({ ringAt: fort.ringAt, ringLength: fort.ringLength, level });
  }
  return levels;
}
