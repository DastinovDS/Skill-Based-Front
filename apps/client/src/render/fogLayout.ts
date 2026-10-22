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

/**
 * The border point of every road, in thousandths from the end `a` (`border_permille`, DEC-21,
 * item 5; DEC-23). The map files do not carry it yet and the default is 500 (map-format.md), so
 * it is a constant here; it moves into the map file reading together with `border_permille`.
 */
export const BORDER_PERMILLE = 500;

/** The border point of a road: where its two halves meet. */
export function borderPoint(map: MapFile, id: number): Point | undefined {
  const ends = edgeEnds(map, id);
  if (ends === undefined) return undefined;
  return edgePoint(ends.a, ends.b, true, BORDER_PERMILLE);
}

/**
 * Centre of the memory ghost of a half of a road (DEC-33, detail 8): at the border point, beside
 * the road, the half of the end `a` (0) to the left of the a → b way and the half of the end `b`
 * (1) to the right, so that two memories do not sit on top of each other.
 */
export function halfMarkerPoint(map: MapFile, id: number, half: 0 | 1): Point | undefined {
  const ends = edgeEnds(map, id);
  const at = borderPoint(map, id);
  if (ends === undefined || at === undefined) return undefined;
  return sideways(ends.a, ends.b, at, half === 0 ? EDGE_MARKER_OFFSET : -EDGE_MARKER_OFFSET);
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
