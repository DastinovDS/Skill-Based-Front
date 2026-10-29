import type { Terrain } from '../protocol.gen.ts';
import type { Point } from './camera.ts';

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

export function patternMarks(cell: readonly Point[], terrain: Terrain): PatternMarks {
  if (cell.length < 3) return NONE;
  const box = boundsOf(cell);
  switch (terrain) {
    case 'plains':
      return { ...NONE, dots: gridPoints(cell, box, DOT_STEP, DOT_MARGIN) };
    case 'forest':
      return { ...NONE, firs: gridPoints(cell, box, FIR_STEP, FIR_MARGIN) };
    case 'mountains':
      return { ...NONE, hatches: hatching(cell, box) };
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
function gridPoints(cell: readonly Point[], box: Box, step: number, margin: number): Point[] {
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
      if (insideBy(cell, at, margin)) out.push(at);
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
