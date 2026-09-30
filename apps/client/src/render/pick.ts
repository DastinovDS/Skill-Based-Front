import type { MapFile } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import { TOKEN_FULL, nodePoint } from './layout.ts';
import type { PickHit } from './interaction.ts';
import { CAPITAL_RADIUS, NODE_RADIUS } from './style.ts';

/** A click this far outside a city circle still hits it (world units): cities are small on screen. */
export const NODE_HIT_SLACK = 8;

/**
 * What a click at `world` hits: an own group token first (the topmost, i.e. the last drawn), then
 * the nearest city circle. `groups` are the drawn token centres by id. Pure: the order of the
 * checks is the only rule.
 */
export function pickAt(
  map: MapFile,
  world: Point,
  groups: ReadonlyMap<string, Point>,
): PickHit | null {
  let group: string | null = null;
  for (const [id, at] of groups) {
    if (
      Math.abs(world.x - at.x) <= TOKEN_FULL.width / 2 &&
      Math.abs(world.y - at.y) <= TOKEN_FULL.height / 2
    ) {
      group = id;
    }
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
  return best === null ? null : { kind: 'node', id: best };
}
