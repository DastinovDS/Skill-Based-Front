/**
 * Geometry of the fog of war (CLI-05, #61): where enemy markers sit and the age of a memory.
 *
 * Pure functions, no PixiJS and no DOM. Nothing here decides what is visible: the server does
 * (`detail` of a node or an edge); the client only draws that level.
 */
import type { MapFile } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import { edgeEnds, edgePoint, nodePoint, sideways } from './layout.ts';
import { GHOST_ALPHA, GHOST_FADE_START_S, GHOST_HIDE_S, RING_GAP } from './style.ts';

/** Enemy markers on an edge sit this far from the road, to the left of the a → b way. */
export const EDGE_MARKER_OFFSET = -24;

/**
 * Centre of the enemy marker (or the memory ghost) of a city: to the right of it, in the lower
 * half, because the VP badge is above and the warehouse bar below the ring. `width` is the marker width.
 */
export function nodeMarkerPoint(
  map: MapFile,
  id: number,
  width: number,
  radius: number,
): Point | undefined {
  const point = nodePoint(map, id);
  if (point === undefined) return undefined;
  // Beyond the capacity ring (it reaches `RING_GAP + 4` outside the body).
  return { x: point.x + radius + RING_GAP + 8 + width / 2, y: point.y + 6 };
}

/** Centre of the enemy marker (or the memory ghost) of a road: the middle, beside the road. */
export function edgeMarkerPoint(map: MapFile, id: number): Point | undefined {
  const ends = edgeEnds(map, id);
  if (ends === undefined) return undefined;
  const middle = edgePoint(ends.a, ends.b, true, 500);
  return sideways(ends.a, ends.b, middle, EDGE_MARKER_OFFSET);
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

/**
 * Opacity of a memory ghost `ageSeconds` after the sighting (9.8): `GHOST_ALPHA` up to
 * `GHOST_FADE_START_S`, then linearly down to 0 at `GHOST_HIDE_S`; 0 (not drawn) after that.
 * Only what is shown: the memory itself stays in the `PlayerView`.
 */
export function ghostAlpha(ageSeconds: number): number {
  if (ageSeconds <= GHOST_FADE_START_S) return GHOST_ALPHA;
  if (ageSeconds >= GHOST_HIDE_S) return 0;
  return (GHOST_ALPHA * (GHOST_HIDE_S - ageSeconds)) / (GHOST_HIDE_S - GHOST_FADE_START_S);
}
