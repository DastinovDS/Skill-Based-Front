/**
 * Geometry of the fog of war (CLI-05, #61): where enemy markers sit and the age of a memory.
 *
 * Pure functions, no PixiJS and no DOM. Nothing here decides what is visible: the server does
 * (`detail` of a node or an edge); the client only draws that level.
 */
import type { MapFile, NodeView } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import { edgeEnds, edgePoint, nodePoint, sideways } from './layout.ts';
import { cellEdges, type Segment } from './regionLayout.ts';
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
 * The border point of road `id` in thousandths from its end `a`: `border_permille` of the map
 * file (DEC-21, item 5; DEC-23, item 5). 500 (the middle) for a map without the field: the map of
 * a replay frames file written before DEC-23 (replay-frames.md keeps the map as it was).
 */
export function borderPermille(map: MapFile, id: number): number {
  return (map.edges[id] as Partial<MapFile['edges'][number]> | undefined)?.border_permille ?? 500;
}

/** The border point of a road: where its two halves meet. */
export function borderPoint(map: MapFile, id: number): Point | undefined {
  const ends = edgeEnds(map, id);
  if (ends === undefined) return undefined;
  return edgePoint(ends.a, ends.b, true, borderPermille(map, id));
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

/**
 * The cities under the veil of the haze (F1): those whose `detail` is `fog`, by id. Only what the
 * `PlayerView` says is hidden; the veil never depends on `seen` (the memory is a ghost, not a shade).
 */
export function veilCities(nodes: readonly Pick<NodeView, 'id' | 'detail'>[]): number[] {
  return nodes
    .filter((node) => node.detail === 'fog')
    .map((node) => node.id)
    .sort((a, b) => a - b);
}

/** The same set of hidden cities: the haze is redrawn only when this is false. */
export function sameVeil(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * A Voronoi cell for the veil: every vertex that lies on the edge of the map `[0, width] x [0, height]`
 * moves `margin` outward along that edge's normal, so that the blur does not thin the veil at the
 * edge of the map (the map mask cuts what is outside). Inner vertices stay.
 */
export function veilPolygon(
  cell: readonly Point[],
  bounds: { readonly width: number; readonly height: number },
  margin: number,
): Point[] {
  const eps = 1e-6;
  return cell.map((p) => ({
    x: p.x <= eps ? p.x - margin : p.x >= bounds.width - eps ? p.x + margin : p.x,
    y: p.y <= eps ? p.y - margin : p.y >= bounds.height - eps ? p.y + margin : p.y,
  }));
}

/**
 * The front of the haze: the edges of the cells between a hidden city and a city in sight. The
 * soft edge of the veil reads only by brightness, which is weak where the terrain is as dark as
 * the veil (and in grey scale), so a thin light line marks the front (not hatching, ui-style 26.3).
 * Each shared edge once, from the hidden side; the map border is not a front.
 */
export function veilFrontier(
  cells: readonly (readonly Point[])[],
  hidden: readonly number[],
): Segment[] {
  const covered = new Set(hidden);
  const lines: Segment[] = [];
  for (const edge of cellEdges(cells)) {
    if (!covered.has(edge.cell) || edge.neighbour === null || covered.has(edge.neighbour)) continue;
    lines.push({ a: edge.a, b: edge.b });
  }
  return lines;
}
