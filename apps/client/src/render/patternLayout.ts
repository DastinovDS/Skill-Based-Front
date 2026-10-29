import type { Terrain } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import { distanceToSegment } from './regionLayout.ts';
import { insidePolygon } from './territory.ts';

/**
 * The marks of the terrain map mode (#429, "Patterns"): a pattern per terrain that stays
 * different in grey scale. Plains: dots; forest: firs; mountains: diagonal hatching. The marks sit
 * on a grid of the WORLD, so two cells of one terrain that touch show one continuous pattern.
 * Pure geometry: no rule, nothing from the server.
 */
export interface PatternMarks {
  /** Centres of the dots. */
  readonly dots: readonly Point[];
  /** Centres of the firs (a fir is drawn as a small chevron round its centre). */
  readonly firs: readonly Point[];
  /** Segments of the hatching. */
  readonly hatches: readonly (readonly [Point, Point])[];
}

export const DOT_STEP = 12;
export const FIR_STEP = 16;
export const HATCH_STEP = 9;
/** A dot keeps this far from the edge of its cell, a fir this far (the chevron is wider). */
export const DOT_MARGIN = 3;
export const FIR_MARGIN = 6;

const NONE: PatternMarks = { dots: [], firs: [], hatches: [] };

/**
 * The marks inside one area. `convex` is true for a Voronoi cell; the areas of a geography
 * (DEC-36, #544) are not convex, so a point must be inside by the even-odd rule and the hatching
 * lines cut in several stretches.
 */
export function patternMarks(
  cell: readonly Point[],
  terrain: Terrain,
  convex = true,
): PatternMarks {
  if (cell.length < 3) return NONE;
  const box = boundsOf(cell);
  const inside = convex ? insideBy : insideRingBy;
  switch (terrain) {
    case 'plains':
      return { ...NONE, dots: gridPoints(cell, box, DOT_STEP, DOT_MARGIN, inside) };
    case 'forest':
      return { ...NONE, firs: gridPoints(cell, box, FIR_STEP, FIR_MARGIN, inside) };
    case 'mountains':
      return { ...NONE, hatches: convex ? hatching(cell, box) : hatchingRing(cell, box) };
  }
}

interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

function boundsOf(cell: readonly Point[]): Box {
  const xs = cell.map((p) => p.x);
  const ys = cell.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Rows of `step`, every other row shifted by half a step (a staggered grid), inside the cell. */
function gridPoints(
  cell: readonly Point[],
  box: Box,
  step: number,
  margin: number,
  inside: (cell: readonly Point[], at: Point, margin: number) => boolean,
): Point[] {
  const out: Point[] = [];
  const first = Math.floor(box.y0 / step);
  const last = Math.ceil(box.y1 / step);
  for (let row = first; row <= last; row++) {
    const y = row * step;
    const shift = row % 2 === 0 ? 0 : step / 2;
    const from = Math.floor((box.x0 - shift) / step);
    const to = Math.ceil((box.x1 - shift) / step);
    for (let col = from; col <= to; col++) {
      const at = { x: col * step + shift, y };
      if (inside(cell, at, margin)) out.push(at);
    }
  }
  return out;
}

/** The point is inside the convex cell and at least `margin` from each of its sides. */
function insideBy(cell: readonly Point[], at: Point, margin: number): boolean {
  const turn = orientation(cell);
  for (let i = 0; i < cell.length; i++) {
    const a = cell[i];
    const b = cell[(i + 1) % cell.length];
    if (a === undefined || b === undefined) return false;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) continue;
    const side = (turn * ((b.x - a.x) * (at.y - a.y) - (b.y - a.y) * (at.x - a.x))) / length;
    if (side < margin) return false;
  }
  return true;
}

/** +1 for a counter-clockwise ring (y up), -1 for clockwise: the sign of the signed area. */
function orientation(cell: readonly Point[]): 1 | -1 {
  let area = 0;
  for (let i = 0; i < cell.length; i++) {
    const a = cell[i];
    const b = cell[(i + 1) % cell.length];
    if (a !== undefined && b !== undefined) area += a.x * b.y - b.x * a.y;
  }
  return area >= 0 ? 1 : -1;
}

/** Lines `x + y = c`, `c` a multiple of the step, cut to the convex cell. */
function hatching(cell: readonly Point[], box: Box): [Point, Point][] {
  const out: [Point, Point][] = [];
  const first = Math.ceil((box.x0 + box.y0) / HATCH_STEP);
  const last = Math.floor((box.x1 + box.y1) / HATCH_STEP);
  for (let k = first; k <= last; k++) {
    const c = k * HATCH_STEP;
    const hits: Point[] = [];
    for (let i = 0; i < cell.length; i++) {
      const a = cell[i];
      const b = cell[(i + 1) % cell.length];
      if (a === undefined || b === undefined) continue;
      const fa = a.x + a.y - c;
      const fb = b.x + b.y - c;
      if (fa === fb || fa * fb > 0) continue;
      const t = fa / (fa - fb);
      hits.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
    if (hits.length < 2) continue;
    hits.sort((p, q) => p.x - q.x);
    const p = hits[0];
    const q = hits[hits.length - 1];
    if (p !== undefined && q !== undefined && q.x - p.x > 1) out.push([p, q]);
  }
  return out;
}

/** The point is inside the (not convex) ring and at least `margin` from every side of it. */
function insideRingBy(ring: readonly Point[], at: Point, margin: number): boolean {
  if (!insidePolygon(ring, at)) return false;
  return ring.every((a, i) => {
    const b = ring[(i + 1) % ring.length];
    return b === undefined || distanceToSegment(at, { a, b }) >= margin;
  });
}

/**
 * Lines `x + y = c` cut to a ring that need not be convex: the crossings of a line with the ring,
 * sorted along it, pair up into the stretches inside (even-odd, like `insidePolygon`).
 */
function hatchingRing(ring: readonly Point[], box: Box): [Point, Point][] {
  const out: [Point, Point][] = [];
  const first = Math.ceil((box.x0 + box.y0) / HATCH_STEP);
  const last = Math.floor((box.x1 + box.y1) / HATCH_STEP);
  for (let k = first; k <= last; k++) {
    const c = k * HATCH_STEP;
    const hits: Point[] = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if (a === undefined || b === undefined) continue;
      const fa = a.x + a.y - c;
      const fb = b.x + b.y - c;
      // Half open (a vertex on the line belongs to the side `>= 0`): a line through a vertex
      // counts it once, or twice where it only touches.
      if (fa >= 0 === fb >= 0) continue;
      const t = fa / (fa - fb);
      hits.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
    hits.sort((p, q) => p.x - q.x);
    for (let i = 0; i + 1 < hits.length; i += 2) {
      const p = hits[i];
      const q = hits[i + 1];
      if (p !== undefined && q !== undefined && q.x - p.x > 1) out.push([p, q]);
    }
  }
  return out;
}
