/**
 * Geometry of the fog of war (CLI-05, #61): where enemy markers sit, hatching of hidden cities,
 * dashes of hidden roads and the age of a memory.
 *
 * Pure functions, no PixiJS and no DOM. Nothing here decides what is visible: the server does
 * (`detail` of a node or an edge); the client only draws that level.
 */
import type { MapFile } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import { edgeEnds, edgePoint, nodePoint, sideways } from './layout.ts';
import { CAPITAL_RADIUS, NODE_RADIUS } from './style.ts';

/** Enemy markers on an edge sit this far from the road, to the left of the a → b way. */
export const EDGE_MARKER_OFFSET = -24;

/** Radius of a city, capital or not. */
export function nodeRadius(map: MapFile, id: number): number {
  return map.nodes[id]?.capital_of === null ? NODE_RADIUS : CAPITAL_RADIUS;
}

/**
 * Centre of the enemy marker (or the memory ghost) of a city: to the right of it, in the lower
 * half, because the VP badge and the warehouse bar are above. `width` is the marker width.
 */
export function nodeMarkerPoint(map: MapFile, id: number, width: number): Point | undefined {
  const point = nodePoint(map, id);
  if (point === undefined) return undefined;
  return { x: point.x + nodeRadius(map, id) + 8 + width / 2, y: point.y + 6 };
}

/** Centre of the enemy marker (or the memory ghost) of a road: the middle, beside the road. */
export function edgeMarkerPoint(map: MapFile, id: number): Point | undefined {
  const ends = edgeEnds(map, id);
  if (ends === undefined) return undefined;
  const middle = edgePoint(ends.a, ends.b, true, 500);
  return sideways(ends.a, ends.b, middle, EDGE_MARKER_OFFSET);
}

/**
 * Diagonal hatching inside a circle of `radius` around (0, 0): chords of lines at 45 degrees,
 * `spacing` apart. A hidden city is hatched, so it differs from a visible one without colour.
 */
export function hatchChords(radius: number, spacing: number): [Point, Point][] {
  const chords: [Point, Point][] = [];
  // Lines x + y = c (written in rotated coordinates: distance `d` from the centre).
  for (let d = -Math.floor(radius / spacing) * spacing; d < radius; d += spacing) {
    const half = Math.sqrt(radius * radius - d * d);
    // Along the line direction (1, -1)/sqrt2, at distance d along the normal (1, 1)/sqrt2.
    const nx = d / Math.SQRT2;
    const hx = half / Math.SQRT2;
    chords.push([
      { x: nx - hx, y: nx + hx },
      { x: nx + hx, y: nx - hx },
    ]);
  }
  return chords;
}

/**
 * Darkening dashes along a hidden road of `length`: `[start, end]` pairs on the road axis. The
 * gaps between them let the road shine through, so a hidden road looks broken, not just darker.
 */
export function fogDashes(length: number, dash: number, gap: number): [number, number][] {
  const dashes: [number, number][] = [];
  if (length <= 0 || dash <= 0) return dashes;
  for (let at = 0; at < length; at += dash + gap) {
    dashes.push([at, Math.min(length, at + dash)]);
  }
  return dashes;
}

/**
 * How long ago a place was seen, as `-m:ss` (for example `-0:21`), language-neutral. Ticks
 * before the present only: a sighting "from the future" (clock skew) counts as just now.
 */
export function ageLabel(ticksAgo: number, tickHz: number): string {
  const seconds = tickHz > 0 ? Math.max(0, Math.floor(ticksAgo / tickHz)) : 0;
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return `-${String(minutes)}:${rest}`;
}
