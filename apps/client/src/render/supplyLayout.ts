/**
 * What the «Supply» map layer draws (DEC-43), as plain data from one snapshot. Pure functions, no
 * PixiJS; the client computes nothing about supply: it reads the own packets (their `path` is the
 * server's) and the flow fields the view carries (`flowLayout.ts`). The enemy shows only as
 * territory (the map view) and as presence here (DEC-04, DEC-17): no warehouse, no packet of the
 * opponent is in a view at all, and this layer does not look for them.
 */
import type { MapFile, View } from '../protocol.gen.ts';
import type { Point } from './camera.ts';

/** Where the enemy is known to be present now (no numbers: the view gives none here). */
export type SupplyPresence =
  { readonly kind: 'node'; readonly id: number } | { readonly kind: 'edge'; readonly id: number };

/** `edge id` of the road between two nodes, by the ends of the map's edges. */
export type EdgeIndex = ReadonlyMap<string, number>;

const pairKey = (a: number, b: number): string =>
  `${String(Math.min(a, b))}:${String(Math.max(a, b))}`;

export function edgeIndex(map: MapFile): EdgeIndex {
  const index = new Map<string, number>();
  for (const edge of map.edges) index.set(pairKey(edge.a, edge.b), edge.id);
  return index;
}

/**
 * The places where the enemy is seen now: a node or a road half seen (not in fog), with an enemy in
 * it. A fogged place keeps an older sighting (a ghost of the normal map), which this layer does not
 * draw.
 */
export function presenceOf(view: View): SupplyPresence[] {
  const presence: SupplyPresence[] = [];
  for (const node of view.nodes) {
    if (node.detail !== 'fog' && node.seen !== null && node.seen.enemy_modes.length > 0) {
      presence.push({ kind: 'node', id: node.id });
    }
  }
  for (const edge of view.edges) {
    const seen = edge.halves.some(
      (half) => half.detail !== 'fog' && half.seen !== null && half.seen.enemy_modes.length > 0,
    );
    if (seen || edge.enemy_groups.length > 0) {
      presence.push({ kind: 'edge', id: edge.id });
    }
  }
  return presence;
}

// --- Lanes ------------------------------------------------------------------------------

/** The point of a road at `at` (0..1) of the way `from` to `to`, moved sideways by `lane`. */
export function lanePoint(from: Point, to: Point, at: number, lane: number): Point {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const x = from.x + (to.x - from.x) * at;
  const y = from.y + (to.y - from.y) * at;
  if (length === 0) return { x, y };
  // Right-hand normal of (dx, dy) in a y-down plane is (-dy, dx): flows of opposite directions
  // get opposite lanes and do not lie on top of each other.
  return { x: x + (-(to.y - from.y) / length) * lane, y: y + ((to.x - from.x) / length) * lane };
}
