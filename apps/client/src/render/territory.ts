/**
 * The areas of the nodes (the "territory", DEC-36, #544): one polygon per node and the edges of
 * those polygons with what lies across each. Two sources:
 *
 * - `voronoiTerritory`: the straight Voronoi cells (`voronoi.ts`), for every map without a vector
 *   file (the fixtures, the test maps);
 * - `geoTerritory`: the areas of the baker's shared border chains (`map/geography.ts`), so the tint
 *   lies exactly on the ground of the same area. These are not convex.
 *
 * Pure functions, no PixiJS and no DOM.
 */
import type { GeoChain, GeoFile, GeoLabel } from '../map/geography.ts';
import type { MapFile } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import { cellEdges, type CellEdge } from './regionLayout.ts';
import { voronoiCells } from './voronoi.ts';

export interface Territory {
  /** `cells[i]`: the polygon of node `i`. With a geography an enclosed lake is cut out by a slit. */
  readonly cells: Point[][];
  /** The edges of the polygons, with the area or the water across each (`regionLayout.ts`). */
  readonly edges: readonly CellEdge[];
  /** Voronoi cells are convex; the areas of a geography are not (water, rivers, noise). */
  readonly convex: boolean;
}

export function voronoiTerritory(map: MapFile): Territory {
  const cells = voronoiCells(map.nodes, { width: map.meta.width, height: map.meta.height });
  return { cells, edges: cellEdges(cells), convex: true };
}

/** Whether `p` lies inside the polygon (even-odd rule: a slit cancels itself out). */
export function insidePolygon(polygon: readonly Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a === undefined || b === undefined) continue;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** The node whose area holds `p`, or `null` (water, outside the map). */
export function areaAt(cells: readonly (readonly Point[])[], p: Point): number | null {
  const found = cells.findIndex((cell) => insidePolygon(cell, p));
  return found < 0 ? null : found;
}

// --- Rings from chains -----------------------------------------------------------------------

type Kind =
  { kind: 'area'; id: number } | { kind: 'outside' } | { kind: 'water' } | { kind: 'river' };

function kindOf(label: GeoLabel): Kind {
  if (typeof label === 'number')
    return label < 0 ? { kind: 'outside' } : { kind: 'area', id: label };
  return label === 'river' ? { kind: 'river' } : { kind: 'water' };
}

/** A stretch of the border walked with the area on its left, and what lies on its right. */
interface Piece {
  readonly area: number;
  readonly pts: readonly Point[];
  readonly other: Kind;
}

// --- Smoothing the chains --------------------------------------------------------------------

/** Spacing (world units) a chain is resampled at before it is smoothed. */
const RESAMPLE = 4;
/**
 * Passes of the binomial filter (1/4, 1/2, 1/4) over the resampled chain: together a Gaussian of
 * sigma = RESAMPLE * sqrt(passes / 2), about 10 units. That is wider than the stairs of the
 * 4-unit label grid (they vanish) and narrower than the warp of the baker's borders (it stays).
 */
const SMOOTH_PASSES = 12;
/** Ramer-Douglas-Peucker tolerance after smoothing (world units): drops points of straight runs. */
const SIMPLIFY = 0.25;

const keyOf = (p: Point): string => `${String(p.x)},${String(p.y)}`;

/** `pts` at even spacing of about `RESAMPLE` along its length, the ends kept exactly. */
function resampled(pts: readonly Point[]): Point[] {
  const lengths = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Point;
    const b = pts[i] as Point;
    lengths.push((lengths[i - 1] ?? 0) + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = lengths[lengths.length - 1] ?? 0;
  const count = Math.round(total / RESAMPLE);
  if (count < 2) return [...pts];
  const out: Point[] = [pts[0] as Point];
  let seg = 1;
  for (let k = 1; k < count; k++) {
    const at = (total * k) / count;
    while (seg < pts.length - 1 && (lengths[seg] ?? 0) < at) seg++;
    const a = pts[seg - 1] as Point;
    const b = pts[seg] as Point;
    const from = lengths[seg - 1] ?? 0;
    const span = (lengths[seg] ?? 0) - from;
    const t = span > 0 ? (at - from) / span : 0;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  out.push(pts[pts.length - 1] as Point);
  return out;
}

/** Ramer-Douglas-Peucker on an open polyline: the ends stay, a point within `eps` goes. */
function simplified(pts: readonly Point[], eps: number): Point[] {
  if (pts.length < 3) return [...pts];
  const keep = pts.map(() => false);
  keep[0] = true;
  keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [i, j] = stack.pop() as [number, number];
    const a = pts[i] as Point;
    const b = pts[j] as Point;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    let far = -1;
    let worst = eps;
    for (let k = i + 1; k < j; k++) {
      const p = pts[k] as Point;
      const d =
        length === 0
          ? Math.hypot(p.x - a.x, p.y - a.y)
          : Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / length;
      if (d > worst) {
        worst = d;
        far = k;
      }
    }
    if (far >= 0) {
      keep[far] = true;
      stack.push([i, far], [far, j]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}

/**
 * The binomial filter, `SMOOTH_PASSES` times. A closed line is filtered round. An open line is
 * extended past each end by its own points turned through that end (`2 * end - p`), so the filter
 * sees the line run on straight: the ends stay exactly where they are, and the stairs right next
 * to them are smoothed as much as anywhere else (keeping the ends fixed instead would leave them).
 */
function filtered(line: readonly Point[], closed: boolean): Point[] {
  const m = line.length;
  if (m < 3) return [...line];
  const pad = closed ? 0 : Math.min(SMOOTH_PASSES + 1, m - 1);
  const first = line[0] as Point;
  const last = line[m - 1] as Point;
  const turned = (end: Point, p: Point): Point => ({ x: 2 * end.x - p.x, y: 2 * end.y - p.y });
  const head: Point[] = [];
  const tail: Point[] = [];
  for (let k = pad; k >= 1; k--) head.push(turned(first, line[k] as Point));
  for (let k = 1; k <= pad; k++) tail.push(turned(last, line[m - 1 - k] as Point));
  let out = [...head, ...line, ...tail];
  const n = out.length;
  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    const prev = out;
    out = prev.map((p, i) => {
      const a = prev[closed ? (i + n - 1) % n : Math.max(0, i - 1)] as Point;
      const b = prev[closed ? (i + 1) % n : Math.min(n - 1, i + 1)] as Point;
      return { x: 0.25 * a.x + 0.5 * p.x + 0.25 * b.x, y: 0.25 * a.y + 0.5 * p.y + 0.25 * b.y };
    });
  }
  out = out.slice(pad, pad + m);
  if (!closed) {
    out[0] = first;
    out[m - 1] = last;
  }
  return out;
}

/**
 * A chain of the label grid as a smooth line (#585): resampled, low-pass filtered, simplified.
 * The chains are traced on the 4-unit cells of the baker, so the raw chain is a staircase; the
 * baked ground and water under it are blurred and show no stairs. The ends of an open line stay
 * where they are, so the chains that meet there still meet; a `closed` line (its last point
 * repeats the first) is filtered round, the seam moving with it. Deterministic: plain arithmetic.
 */
export function smoothChain(pts: readonly Point[], closed: boolean): Point[] {
  return smoothRun([pts], closed)[0] ?? [];
}

/**
 * Smooths the chains of `run` as one line: each chain begins where the one before ends (and, if
 * `closed`, the first begins where the last ends). The points where they join move with the line,
 * the same for both chains, so the line has no kink there; the ends of an open run stay.
 */
function smoothRun(run: readonly (readonly Point[])[], closed: boolean): Point[][] {
  const joined: Point[] = [];
  const joins: number[] = []; // index in `joined` where chain k > 0 begins
  run.forEach((pts, k) => {
    if (k > 0) joins.push(joined.length - 1);
    joined.push(...(k === 0 ? pts : pts.slice(1)));
  });
  // Arc length of every point of `joined`, to find the joins again after resampling.
  const lengths = [0];
  for (let i = 1; i < joined.length; i++) {
    const p = joined[i - 1] as Point;
    const q = joined[i] as Point;
    lengths.push((lengths[i - 1] ?? 0) + Math.hypot(q.x - p.x, q.y - p.y));
  }
  const total = lengths[lengths.length - 1] ?? 0;
  let line = resampled(joined);
  const count = line.length - 1;
  // The resampled index of each join, strictly increasing and inside the line.
  const cuts: number[] = [];
  for (const j of joins) {
    const at = total > 0 ? Math.round(((lengths[j] ?? 0) / total) * count) : 0;
    cuts.push(Math.min(count - 1, Math.max((cuts[cuts.length - 1] ?? 0) + 1, at)));
  }
  if (count < 2 || cuts.some((c) => c <= 0 || c >= count) || new Set(cuts).size !== cuts.length) {
    // Too short to smooth: the chains as they are.
    return run.map((pts) => [...pts]);
  }
  if (closed) {
    line = filtered(line.slice(0, -1), true);
    line.push(line[0] as Point);
  } else line = filtered(line, false);
  const bounds = [0, ...cuts, count];
  const out: Point[][] = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    out.push(simplified(line.slice(bounds[k], (bounds[k + 1] ?? 0) + 1), SIMPLIFY));
  }
  return out;
}

function rawPoints(chain: GeoChain): Point[] {
  const out: Point[] = [];
  for (let i = 0; i + 1 < chain.pts.length; i += 2) {
    out.push({ x: chain.pts[i] ?? 0, y: chain.pts[i + 1] ?? 0 });
  }
  return out;
}

/** Whether a label is water (a sea, a lake, a river or a stream). */
const watery = (label: GeoLabel): boolean => typeof label === 'string';
/** Whether a chain bounds an area (both sides water or outside: no area draws it). */
const seen = (chain: GeoChain): boolean =>
  (typeof chain.l === 'number' && chain.l >= 0) || (typeof chain.r === 'number' && chain.r >= 0);

/**
 * The lines of all chains, smoothed except along the map frame, which stays straight.
 *
 * A point where exactly two chains that an area sees meet, both with that area on one side and
 * water on the other (a coast running into a river mouth: area|sea and area|river, the
 * sea|river chain between them bounds no area), or one chain meeting itself (a lake inside one
 * area), is no corner of any area: the chains through it are smoothed as one line, so the coast
 * does not kink at the mouth (#585). Every other junction (three regions with land, the frame)
 * stays where it is.
 */
function chainLines(chains: readonly GeoChain[]): Point[][] {
  const raw = chains.map(rawPoints);
  const frame = (c: GeoChain): boolean => c.l === -1 || c.r === -1;
  // The ends of the chains an area sees, by point: [chain, 0 = start | 1 = end].
  const ends = new Map<string, [number, 0 | 1][]>();
  raw.forEach((pts, i) => {
    if (!seen(chains[i] as GeoChain)) return;
    ([0, 1] as const).forEach((side) => {
      const p = side === 0 ? pts[0] : pts[pts.length - 1];
      if (p !== undefined) ends.set(keyOf(p), [...(ends.get(keyOf(p)) ?? []), [i, side]]);
    });
  });
  const soft = (p: Point): boolean => {
    const here = ends.get(keyOf(p)) ?? [];
    if (here.length !== 2) return false;
    const [[i], [j]] = here as [[number, 0 | 1], [number, 0 | 1]];
    const a = chains[i] as GeoChain;
    const b = chains[j] as GeoChain;
    if (frame(a) || frame(b)) return false;
    if (i === j) return true;
    const area = [a.l, a.r].find((x) => typeof x === 'number' && (x === b.l || x === b.r));
    if (area === undefined) return false;
    const other = (c: GeoChain): GeoLabel => (c.l === area ? c.r : c.l);
    return watery(other(a)) && watery(other(b));
  };
  const out: Point[][] = raw.map((pts) => [...pts]);
  const done = raw.map((_, i) => frame(chains[i] as GeoChain) || !seen(chains[i] as GeoChain));
  /** The chain that continues through the end of `pts` (not chain `from` itself unless a loop). */
  const next = (pts: readonly Point[], from: number, side: 0 | 1): [number, boolean] | null => {
    const end = pts[pts.length - 1] as Point;
    if (!soft(end)) return null;
    const here = ends.get(keyOf(end)) ?? [];
    const other = here.find(([c, s]) => !(c === from && s === side)) ?? null;
    if (other === null) return null;
    // `reversed`: the chain is walked from its end to its start.
    return [other[0], other[1] === 1];
  };
  // Start each run at a hard end, then the runs that are loops of soft points only.
  for (const loopsOnly of [false, true]) {
    raw.forEach((pts, start) => {
      if (done[start] === true) return;
      const first = pts[0] as Point;
      const last = pts[pts.length - 1] as Point;
      let reversedStart = false;
      if (!loopsOnly) {
        if (soft(first) && soft(last)) return;
        reversedStart = soft(first); // walk away from the hard end
      }
      const members: { chain: number; reversed: boolean }[] = [];
      let chain = start;
      let reversed = reversedStart;
      let closed = false;
      for (;;) {
        members.push({ chain, reversed });
        done[chain] = true;
        const own = raw[chain] ?? [];
        const walk = reversed ? [...own].reverse() : own;
        const step = next(walk, chain, reversed ? 0 : 1);
        if (step === null) break;
        if (step[0] === start && members.length > 0 && step[1] === reversedStart) {
          closed = true;
          break;
        }
        if (done[step[0]] === true) break;
        [chain, reversed] = step;
      }
      const lines = smoothRun(
        members.map(({ chain: c, reversed: r }) => {
          const own = raw[c] ?? [];
          return r ? [...own].reverse() : own;
        }),
        closed,
      );
      members.forEach(({ chain: c, reversed: r }, k) => {
        const line = lines[k] ?? [];
        out[c] = r ? [...line].reverse() : line;
      });
    });
  }
  return out;
}

function signedArea(ring: readonly Point[]): number {
  let twice = 0;
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length] ?? p;
    twice += p.x * q.y - q.x * p.y;
  });
  return twice / 2;
}

/** The closed rings of the pieces of one area; `null` if a ring does not close. */
function rings(pieces: readonly Piece[]): Point[][] | null {
  const byStart = new Map<string, number[]>();
  pieces.forEach((piece, i) => {
    const first = piece.pts[0];
    if (first !== undefined) byStart.set(keyOf(first), [...(byStart.get(keyOf(first)) ?? []), i]);
  });
  const used = new Set<number>();
  const out: Point[][] = [];
  for (let start = 0; start < pieces.length; start++) {
    if (used.has(start)) continue;
    used.add(start);
    const ring: Point[] = [...(pieces[start]?.pts ?? [])];
    const origin = keyOf(ring[0] ?? { x: NaN, y: NaN });
    while (keyOf(ring[ring.length - 1] ?? { x: NaN, y: NaN }) !== origin) {
      const end = ring[ring.length - 1];
      const next = (end === undefined ? [] : (byStart.get(keyOf(end)) ?? [])).find(
        (i) => !used.has(i),
      );
      if (next === undefined) return null;
      used.add(next);
      ring.push(...(pieces[next]?.pts.slice(1) ?? []));
    }
    ring.pop(); // the closing point repeats the first
    out.push(ring);
  }
  return out;
}

/**
 * One polygon from the rings of an area: the largest ring is the outline, a ring turning the other
 * way is a lake inside the area and is joined to the outline by a slit (two coincident edges to
 * its nearest vertex), so one `poly().fill()` leaves the lake out. Further rings of the outline's
 * direction would be a second piece of the area, which the validator (`geography`) forbids: they
 * are dropped.
 */
function polygonOf(all: readonly Point[][]): Point[] {
  const [outline] = [...all].sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
  if (outline === undefined) return [];
  const turn = Math.sign(signedArea(outline));
  let polygon = [...outline];
  for (const hole of all) {
    if (hole === outline || Math.sign(signedArea(hole)) === turn) continue;
    let best = { d: Infinity, o: 0, h: 0 };
    polygon.forEach((p, o) => {
      hole.forEach((q, h) => {
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d < best.d) best = { d, o, h };
      });
    });
    const around = [...hole.slice(best.h), ...hole.slice(0, best.h + 1)];
    const at = polygon[best.o];
    polygon = [
      ...polygon.slice(0, best.o + 1),
      ...around,
      ...(at === undefined ? [] : [at]),
      ...polygon.slice(best.o + 1),
    ];
  }
  return polygon;
}

// --- Edges -----------------------------------------------------------------------------------

/** A river bank is cut into pieces this long, each looking across the river on its own. */
const BANK_STEP = 16;
/** How far across a river the area behind it is looked for (world units; the widest river is ~22). */
const ACROSS_REACH = 48;
const ACROSS_STEP = 3;

/** A run of a bank shorter than this (world units) takes the area across of a neighbouring run. */
const MIN_BANK_RUN = 40;

/**
 * The bank of a river along one area, its pieces in order, with the area across each made steady:
 * a look across a bend, a mouth or the end of a river can miss the far bank or hit a third area,
 * and a run of a few units with another answer would draw a loose stub of the owner border or cut
 * a gap into it (#585). Such a run (shorter than `MIN_BANK_RUN`) takes the answer of its longer
 * neighbouring run, the shortest first; deterministic.
 */
export function steadyBank(
  bank: readonly { readonly edge: CellEdge; readonly length: number }[],
): CellEdge[] {
  const runs: { across: number | null; length: number; edges: CellEdge[] }[] = [];
  for (const { edge, length } of bank) {
    const last = runs[runs.length - 1];
    if (last !== undefined && last.across === edge.neighbour) {
      last.length += length;
      last.edges.push(edge);
    } else runs.push({ across: edge.neighbour, length, edges: [edge] });
  }
  for (;;) {
    let shortest = -1;
    runs.forEach((run, i) => {
      if (run.length < MIN_BANK_RUN && (shortest < 0 || run.length < (runs[shortest]?.length ?? 0)))
        shortest = i;
    });
    const run = runs[shortest];
    if (run === undefined || runs.length < 2) break;
    const before = runs[shortest - 1];
    const after = runs[shortest + 1];
    const into =
      after === undefined || (before !== undefined && before.length >= after.length)
        ? shortest - 1
        : shortest + 1;
    const target = runs[into] as (typeof runs)[number];
    const merged = {
      across: target.across,
      length: target.length + run.length,
      edges: into < shortest ? [...target.edges, ...run.edges] : [...run.edges, ...target.edges],
    };
    runs.splice(Math.min(into, shortest), 2, merged);
    // The runs on both sides may now give the same answer: one run.
    for (let i = runs.length - 1; i > 0; i--) {
      const a = runs[i - 1] as (typeof runs)[number];
      const b = runs[i] as (typeof runs)[number];
      if (a.across === b.across)
        runs.splice(i - 1, 2, {
          across: a.across,
          length: a.length + b.length,
          edges: [...a.edges, ...b.edges],
        });
    }
  }
  return runs.flatMap((run) => run.edges.map((edge) => ({ ...edge, neighbour: run.across })));
}

/**
 * The edges of the polygons. `neighbour` is the node across; a bank of a river or a stream has the
 * node across the water (`water: true`), found by looking across it: the bank chain alone does not
 * say who is on the far bank, and the owner border must not run along a river between two areas of
 * one owner (DEC-36, item 6). A sea or a lake has no node across (`neighbour: null`, `water`).
 */
function edgesOf(pieces: readonly Piece[], cells: readonly (readonly Point[])[]): CellEdge[] {
  const boxes = cells.map((cell) => {
    const xs = cell.map((p) => p.x);
    const ys = cell.map((p) => p.y);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  });
  const nodeAt = (p: Point): number | null => {
    const found = cells.findIndex(
      (cell, i) =>
        boxes[i] !== undefined &&
        p.x >= boxes[i].x0 &&
        p.x <= boxes[i].x1 &&
        p.y >= boxes[i].y0 &&
        p.y <= boxes[i].y1 &&
        insidePolygon(cell, p),
    );
    return found < 0 ? null : found;
  };
  const edges: CellEdge[] = [];
  for (const { area, pts, other } of pieces) {
    const bank: { edge: CellEdge; length: number }[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (a === undefined || b === undefined) continue;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length === 0) continue;
      // Area on the left of the walk (y down): the inward normal is (dy, -dx).
      const inward = { x: (b.y - a.y) / length, y: -(b.x - a.x) / length };
      if (other.kind === 'area') {
        edges.push({ cell: area, a, b, neighbour: other.id, inward });
      } else if (other.kind === 'outside') {
        edges.push({ cell: area, a, b, neighbour: null, inward });
      } else if (other.kind === 'water') {
        edges.push({ cell: area, a, b, neighbour: null, water: true, inward });
      } else {
        const parts = Math.max(1, Math.ceil(length / BANK_STEP));
        // The ends of the segment exactly (not a + (b - a) * 1), so the next segment joins it.
        const at = (k: number): Point =>
          k === 0
            ? a
            : k === parts
              ? b
              : { x: a.x + ((b.x - a.x) * k) / parts, y: a.y + ((b.y - a.y) * k) / parts };
        for (let k = 0; k < parts; k++) {
          const from = at(k);
          const to = at(k + 1);
          const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
          // The first area past the water; the own area too once the look has been in the
          // water (a stream cut into the area, its banks facing each other: no coast, #585).
          let across: number | null = null;
          let wet = false;
          for (let d = ACROSS_STEP; d <= ACROSS_REACH && across === null; d += ACROSS_STEP) {
            const found = nodeAt({ x: mid.x - inward.x * d, y: mid.y - inward.y * d });
            if (found === null) wet = true;
            else if (found !== area || wet) across = found;
          }
          const edge = { cell: area, a: from, b: to, neighbour: across, water: true, inward };
          bank.push({ edge, length: length / parts });
        }
      }
    }
    edges.push(...steadyBank(bank));
  }
  return edges;
}

/**
 * The areas of a map from its vector file, or `null` if the chains do not make a closed polygon
 * for every node (the caller falls back to the Voronoi cells).
 */
export function geoTerritory(map: MapFile, geo: GeoFile): Territory | null {
  const count = map.nodes.length;
  const pieces: Piece[][] = map.nodes.map(() => []);
  const all: Piece[] = [];
  const lines = chainLines(geo.chains);
  for (const [k, chain] of geo.chains.entries()) {
    const walk = lines[k] ?? [];
    const l = kindOf(chain.l);
    const r = kindOf(chain.r);
    for (const [here, there, pts] of [
      [l, r, walk],
      [r, l, [...walk].reverse()],
    ] as const) {
      if (here.kind !== 'area') continue;
      if (here.id >= count) return null;
      const piece = { area: here.id, pts, other: there };
      pieces[here.id]?.push(piece);
      all.push(piece);
    }
  }
  const cells: Point[][] = [];
  for (const own of pieces) {
    const closed = rings(own);
    const polygon = closed === null ? [] : polygonOf(closed);
    if (polygon.length < 3) return null;
    cells.push(polygon);
  }
  return { cells, edges: edgesOf(all, cells), convex: false };
}

/** The territory of `map`: from its vector file if it has a usable one, else the Voronoi cells. */
export function territoryOf(map: MapFile, geo: GeoFile | null): Territory {
  return (geo === null ? null : geoTerritory(map, geo)) ?? voronoiTerritory(map);
}
