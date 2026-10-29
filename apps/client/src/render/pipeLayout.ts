/**
 * The geometry of the supply pipes (#429, variant B "Pipes" of docs/design/mockups/supply-terrain.html).
 *
 * Pure functions, no PixiJS: `SupplyView` draws their results and Vitest checks them directly.
 * Nothing here knows a game rule: the level of a road and the flows come from the snapshot.
 */
import type { Point } from './camera.ts';
import { SUPPLY_PIPE } from './style.ts';
import { lanePoint } from './supplyLayout.ts';

/** The bore of the pipe of a road of `level` (1..3; anything else is clamped). */
export function pipeBore(level: number): number {
  const index = Math.min(SUPPLY_PIPE.bore.length, Math.max(1, Math.round(level)));
  return SUPPLY_PIPE.bore[index - 1] ?? SUPPLY_PIPE.bore[0];
}

/** The inside of a pipe: its bore minus the two walls. */
export function pipeInside(bore: number): number {
  return bore - SUPPLY_PIPE.wall * 2;
}

/**
 * Where the flow of one direction runs inside a pipe: its distance from the axis (to the right of
 * its own direction, so opposite flows take opposite halves) and the width of its band. A pipe
 * with one direction in use is filled across; with both, each fills one half.
 */
export function flowBand(bore: number, both: boolean): { lane: number; width: number } {
  const inside = pipeInside(bore);
  return both ? { lane: inside / 4, width: inside / 2 - 0.6 } : { lane: 0, width: inside - 0.6 };
}

/** Where a pipe lies between two cities: from the rim of `a` to the rim of `b`. */
export function pipeSpan(
  a: Point,
  b: Point,
  insetA: number,
  insetB: number,
): { start: Point; end: Point; length: number } | null {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length <= insetA + insetB) return null;
  return {
    start: lanePoint(a, b, insetA / length, 0),
    end: lanePoint(a, b, (length - insetB) / length, 0),
    length: length - insetA - insetB,
  };
}

/**
 * The dashes that flow from `from` to `to`: `dash` long with `gap` between, shifted along the
 * direction of the flow by `phase` (any number: it wraps by `dash + gap`). A dash cut by the end of
 * the pipe is shortened, one cut by the start is too, so a pipe never shows a dash outside it.
 */
export function flowDashes(
  from: Point,
  to: Point,
  dash: number,
  gap: number,
  phase: number,
): [Point, Point][] {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const period = dash + gap;
  if (length === 0 || dash <= 0 || period <= 0) return [];
  const ux = (to.x - from.x) / length;
  const uy = (to.y - from.y) / length;
  const shift = ((phase % period) + period) % period;
  const runs: [Point, Point][] = [];
  for (let start = shift - period; start < length; start += period) {
    const s = Math.max(0, start);
    const e = Math.min(length, start + dash);
    if (e <= s) continue;
    runs.push([
      { x: from.x + ux * s, y: from.y + uy * s },
      { x: from.x + ux * e, y: from.y + uy * e },
    ]);
  }
  return runs;
}

/** The phase of the flowing dashes at render tick `tick` (the dashes run at `speed` units a second). */
export function flowPhase(tick: number, tickHz: number, still: boolean): number {
  if (still || tickHz <= 0) return 0;
  // Whole units only: a pipe is redrawn when the phase changes, not on every frame.
  return Math.floor((tick / tickHz) * SUPPLY_PIPE.speed);
}

/**
 * A label that lies along a pipe: its centre, above the pipe by half its bore plus `lift`, and the
 * rotation (radians) of the text, turned so that it never reads upside down.
 */
export function labelPose(
  from: Point,
  to: Point,
  at: number,
  bore: number,
): { x: number; y: number; rotation: number } {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const flipped = angle > Math.PI / 2 || angle < -Math.PI / 2;
  const rotation = flipped ? angle + Math.PI : angle;
  const ux = length === 0 ? 0 : (to.x - from.x) / length;
  const uy = length === 0 ? 0 : (to.y - from.y) / length;
  const lift = bore / 2 + SUPPLY_PIPE.labelLift;
  // "Above" the text is its local (0, -1) turned by the rotation.
  return {
    x: from.x + ux * at + Math.sin(rotation) * lift,
    y: from.y + uy * at - Math.cos(rotation) * lift,
    rotation,
  };
}

/**
 * Parallel chords of a circle at 45 degrees, `period` apart: the hatching of a cut-off city.
 * Each chord is `[start, end]`, both on the circle, from the lower left to the upper right.
 */
export function circleHatch(centre: Point, radius: number, period: number): [Point, Point][] {
  const chords: [Point, Point][] = [];
  if (radius <= 0 || period <= 0) return chords;
  const step = period * Math.SQRT2;
  const count = Math.floor(radius / step);
  for (let i = -count; i <= count; i++) {
    // The chord lies at distance `d` from the centre along the normal (1, 1) / sqrt 2.
    const d = i * step;
    const half = Math.sqrt(Math.max(0, radius * radius - d * d));
    const nx = Math.SQRT1_2;
    const ny = Math.SQRT1_2;
    const mx = centre.x + nx * d;
    const my = centre.y + ny * d;
    // The direction of the chord is (1, -1) / sqrt 2.
    chords.push([
      { x: mx - nx * half, y: my + ny * half },
      { x: mx + nx * half, y: my - ny * half },
    ]);
  }
  return chords;
}

/** The triangle of a valve cap: its tip at `tip`, pointing along (`ux`, `uy`), `length` long and `width` wide. */
export function headPoly(
  tip: Point,
  ux: number,
  uy: number,
  length: number,
  width: number,
): [Point, Point, Point] {
  const base = { x: tip.x - ux * length, y: tip.y - uy * length };
  const half = width / 2;
  return [
    tip,
    { x: base.x - uy * half, y: base.y + ux * half },
    { x: base.x + uy * half, y: base.y - ux * half },
  ];
}

/** The bulkhead across a road at `at`: a short line at right angles to the road from `a` to `b`. */
export function bulkheadLine(a: Point, b: Point, at: Point, half: number): [Point, Point] {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length === 0) return [at, at];
  const nx = -(b.y - a.y) / length;
  const ny = (b.x - a.x) / length;
  return [
    { x: at.x + nx * half, y: at.y + ny * half },
    { x: at.x - nx * half, y: at.y - ny * half },
  ];
}
