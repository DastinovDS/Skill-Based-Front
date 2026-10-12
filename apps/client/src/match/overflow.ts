/**
 * "A city holds more units than its capacity" (ui-style 12) from a snapshot. The numbers come from
 * the server (`NodeView.attrition_in`, `grace_left`, only for own cities); the client counts only
 * the units standing there, to say "6 of 4".
 */
import type { PlayerId, SnapshotMsg } from '../protocol.gen.ts';

export interface OverflowAlert {
  readonly kind: 'overflow';
  readonly node: number;
  /** Own units standing in the city. */
  readonly units: number;
  readonly capacity: number;
  /** Ticks until the next unit dies; `null` while the grace after a capture lasts. */
  readonly attritionIn: number | null;
  /** Ticks the grace still lasts; `null` when it is over. */
  readonly graceLeft: number | null;
}

/** Ticks until a unit of this city is lost, for ordering (grace first, then the attrition count). */
export function lossIn(alert: OverflowAlert, attritionTicks: number): number {
  return alert.attritionIn ?? (alert.graceLeft ?? 0) + attritionTicks;
}

/**
 * Own overflowing cities in `snapshot`, the soonest loss first, then by city id.
 * `attritionTicks`: `ruleset_public.capacity.attrition_ticks`.
 */
export function overflowAlerts(
  snapshot: SnapshotMsg,
  me: PlayerId,
  attritionTicks: number,
): OverflowAlert[] {
  const { nodes, groups } = snapshot.view;
  const standing = new Map<number, number>();
  for (const group of groups) {
    if (group.location.kind === 'node') {
      standing.set(group.location.node, (standing.get(group.location.node) ?? 0) + group.units);
    }
  }
  const found: OverflowAlert[] = [];
  for (const node of nodes) {
    if (node.owner !== me || (node.attrition_in === null && node.grace_left === null)) continue;
    found.push({
      kind: 'overflow',
      node: node.id,
      units: standing.get(node.id) ?? 0,
      capacity: node.capacity,
      attritionIn: node.attrition_in,
      graceLeft: node.grace_left,
    });
  }
  return found.sort(
    (a, b) => lossIn(a, attritionTicks) - lossIn(b, attritionTicks) || a.node - b.node,
  );
}
