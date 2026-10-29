import type { MapFile } from '../protocol.gen.ts';
import { hitHalf, type Point } from './camera.ts';
import type { CityIcon } from './cityStacks.ts';
import { edgeEnds, nodePoint, type TokenSpot } from './layout.ts';
import { insideConvex } from './regionLayout.ts';
import { areaAt } from './territory.ts';
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

/** What the map has drawn to pick from, besides the roads and the city circles of the map file. */
export interface PickScene {
  /** Own groups on roads, by id. */
  readonly groups: ReadonlyMap<string, TokenSpot>;
  /** Icons of own units standing in cities. */
  readonly icons?: readonly CityIcon[];
  /** The Voronoi cells of the cities (`MapView.cells`): the area of a city. */
  readonly cells?: readonly (readonly Point[])[];
  /**
   * The cells are the areas of a geography (DEC-36): not convex, and water between them belongs to
   * no city, so a click on a lake or a river hits no area.
   */
  readonly geo?: boolean;
}

/** The city whose area holds `world`, or `null`. */
export function cellAt(
  cells: readonly (readonly Point[])[] | undefined,
  world: Point,
): number | null {
  const found = cells?.findIndex((cell) => insideConvex(cell, world)) ?? -1;
  return found < 0 ? null : found;
}

/**
 * What a click at `world` hits: an own group token on a road, or the icon of own units in a city
 * (the topmost, i.e. the last drawn), then the nearest city circle, then the nearest road, then
 * the area of a city (any other place inside its cell). `scale` is the camera scale (CSS px per
 * world unit): a triangle is hit within at least 28 px on screen, whatever the zoom (`hitHalf`).
 * Pure: the order of the checks is the only rule.
 */
export function pickAt(map: MapFile, world: Point, scene: PickScene, scale = 1): PickHit | null {
  let group: string | null = null;
  for (const [id, at] of scene.groups) {
    const half = hitHalf(at.side, scale);
    if (Math.abs(world.x - at.x) <= half && Math.abs(world.y - at.y) <= half) group = id;
  }
  if (group !== null) return { kind: 'group', id: group };

  let icon: CityIcon | null = null;
  for (const candidate of scene.icons ?? []) {
    const half = hitHalf(candidate.spot.side, scale);
    if (
      Math.abs(world.x - candidate.spot.x) <= half &&
      Math.abs(world.y - candidate.spot.y) <= half
    ) {
      icon = candidate;
    }
  }
  if (icon !== null) {
    const [only] = icon.ids;
    return icon.ids.length === 1 && only !== undefined
      ? { kind: 'group', id: only, node: icon.node }
      : { kind: 'stack', node: icon.node, ids: icon.ids };
  }

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

  const cell =
    scene.geo === true && scene.cells !== undefined
      ? areaAt(scene.cells, world)
      : cellAt(scene.cells, world);
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
  if (road !== null)
    return cell === null ? { kind: 'edge', id: road } : { kind: 'edge', id: road, cell };
  return cell === null ? null : { kind: 'node', id: cell };
}
