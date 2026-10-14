import type { MapFile } from '../protocol.gen.ts';
import { hitHalf, type Point } from './camera.ts';
import { edgeEnds, nodePoint, type TokenSpot } from './layout.ts';
import type { PickHit } from './interaction.ts';
import { CAPITAL_RADIUS, NODE_RADIUS } from './style.ts';

/** A click this far outside a city circle still hits it (world units): cities are small on screen. */
export const NODE_HIT_SLACK = 8;

/** A road is hit this close to its centre line (world units). */
export const EDGE_HIT = 9;

/** Distance from `p` to the segment `a`-`b`. */
export function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t =
    length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * What a click at `world` hits: an own group token first (the topmost, i.e. the last drawn), then
 * the nearest city circle, then the nearest road. `groups` are the drawn tokens by id and `scale`
 * is the camera scale (CSS px per world unit): a triangle is hit within at least 28 px on screen,
 * whatever the zoom (`hitHalf`). Pure: the order of the checks is the only rule.
 */
export function pickAt(
  map: MapFile,
  world: Point,
  groups: ReadonlyMap<string, TokenSpot>,
  scale = 1,
): PickHit | null {
  let group: string | null = null;
  for (const [id, at] of groups) {
    const half = hitHalf(at.side, scale);
    if (Math.abs(world.x - at.x) <= half && Math.abs(world.y - at.y) <= half) group = id;
  }
  if (group !== null) return { kind: 'group', id: group };

  let best: number | null = null;
  let bestDistance = Infinity;
  for (const node of map.nodes) {
    const at = nodePoint(map, node.id);
    if (at === undefined) continue;
    const reach = (node.capital_of === null ? NODE_RADIUS : CAPITAL_RADIUS) + NODE_HIT_SLACK;
    const distance = Math.hypot(world.x - at.x, world.y - at.y);
    if (distance <= reach && distance < bestDistance) {
      best = node.id;
      bestDistance = distance;
    }
  }
  if (best !== null) return { kind: 'node', id: best };

  let road: number | null = null;
  let roadDistance = EDGE_HIT;
  for (const edge of map.edges) {
    const ends = edgeEnds(map, edge.id);
    if (ends === undefined) continue;
    const distance = segmentDistance(world, ends.a, ends.b);
    if (distance <= roadDistance) {
      road = edge.id;
      roadDistance = distance;
    }
  }
  return road === null ? null : { kind: 'edge', id: road };
}
