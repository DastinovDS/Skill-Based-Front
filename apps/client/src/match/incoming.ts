/**
 * "They are coming for your city" (ui-style U7) from a snapshot. Only what the player may know
 * goes in: the public intents of planned orders (DEC-04, DEC-17: an intent shows where it starts
 * and where it aims, never the size or the path) and the owners of cities, which are public. The
 * client decides nothing about the fight to come.
 */
import type { PlayerId, SnapshotMsg } from '../protocol.gen.ts';
import { delayLeft } from '../render/intentLayout.ts';

/** Enemy planned orders aimed at one of my cities. */
export interface IncomingAlert {
  readonly kind: 'incoming';
  /** My city they aim at. */
  readonly node: number;
  /** How many enemy planned orders aim at it. */
  readonly count: number;
  /**
   * Ticks until the first of them leaves (`created_tick + planned_delay_ticks - tick`); `null`:
   * all of them have left already (their way is the enemy's secret, so no arrival time).
   */
  readonly ticksLeft: number | null;
}

/**
 * Incoming attacks in `snapshot` for player `me`: enemy intents `planned_move` whose target is a
 * city of mine. Soonest first, then by city id. `delayTicks`: `ruleset_public.orders.planned_delay_ticks`.
 */
export function incomingAlerts(
  snapshot: SnapshotMsg,
  me: PlayerId,
  delayTicks: number,
): IncomingAlert[] {
  const per = new Map<number, { count: number; left: number | null }>();
  for (const intent of snapshot.view.intents) {
    if (intent.owner === me || intent.kind !== 'planned_move' || intent.target === null) continue;
    if (snapshot.view.nodes[intent.target]?.owner !== me) continue;
    const left = delayLeft(intent.created_tick, snapshot.tick, delayTicks);
    const entry = per.get(intent.target) ?? { count: 0, left: null };
    entry.count += 1;
    if (left > 0) entry.left = entry.left === null ? left : Math.min(entry.left, left);
    per.set(intent.target, entry);
  }
  return [...per]
    .map(([node, { count, left }]): IncomingAlert => ({
      kind: 'incoming',
      node,
      count,
      ticksLeft: left,
    }))
    .sort((a, b) => (a.ticksLeft ?? Infinity) - (b.ticksLeft ?? Infinity) || a.node - b.node);
}
