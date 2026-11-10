/**
 * The walks to a rally point the CP will pay (#930, W10 "Plan, due, pay"; DEC-48, item H3): every
 * recruit queued in an own city that has a rally point walks there when it is made and pays
 * `recruit.rally_cost` as it leaves (the tick after it appears). The CP gauge earmarks each of
 * them, the nearest first, and the city ring marks each queued recruit with the CP mark.
 *
 * Only the view's numbers: the queue, the production of its first unit and the rally point of each
 * own city (`NodeView.recruit_queue`, `recruit_progress`, `recruit_waiting`, `rally_point`), the
 * own CP and the ruleset (`recruit.unit_ticks`, `rally_cost`). A unit already made and still in
 * its city (`pending`, from its `recruited` event) is the nearest walk. Whether the CP pay a walk
 * is the comparison of the CP now with the sum of the walks before it and its own, as the price
 * bracket of a move compares its price (the CP may grow before the walk; the server decides at the
 * charge, `rally_walk_paid` or `rally_walk_no_cp`). Pure, no Svelte and no PixiJS.
 */
import type { NodeView, PlayerId } from '../protocol.gen.ts';

/** One walk the CP will pay. */
export interface DueWalk {
  /** The city the recruit leaves. */
  readonly node: number;
  /** Its place in the queue of that city (0: in production); -1: made, waiting to leave. */
  readonly slot: number;
  /** Ticks until it leaves and pays, by the production of the queue (at least 1). */
  readonly ticks: number;
  /** How much of the recruit is made, 0..1 (1: made); 0 while it waits for those before it. */
  readonly share: number;
  /** It is being made now (or made): the fuse of the gauge burns for it. */
  readonly running: boolean;
  /** The CP now do not pay it together with the nearer walks. */
  readonly short: boolean;
}

/** A recruit already made in a city with a rally point, not yet gone (its `recruited` event). */
export interface PendingWalk {
  readonly node: number;
}

/**
 * The walks due, the nearest first (ties: by city, then by slot). `cp` and `cost` in hundredths;
 * `cost` 0 (no rally point in the ruleset) gives none.
 */
export function rallyDues(
  nodes: readonly NodeView[],
  me: PlayerId,
  cp: number,
  unitTicks: number,
  cost: number,
  pending: readonly PendingWalk[] = [],
): DueWalk[] {
  if (cost <= 0 || unitTicks <= 0) return [];
  const walks: Omit<DueWalk, 'short'>[] = pending.map((p) => ({
    node: p.node,
    slot: -1,
    ticks: 1,
    share: 1,
    running: true,
  }));
  for (const node of nodes) {
    if (node.owner !== me || node.rally_point === null) continue;
    const queue = node.recruit_queue ?? 0;
    if (queue <= 0) continue;
    const progress = Math.min(unitTicks, Math.max(0, node.recruit_progress ?? 0));
    const ready = node.recruit_waiting === true;
    // The first unit leaves the tick after it is made; each next one a full production later.
    const first = ready ? 1 : unitTicks - progress + 1;
    for (let slot = 0; slot < queue; slot++) {
      walks.push({
        node: node.id,
        slot,
        ticks: first + slot * unitTicks,
        share: slot > 0 ? 0 : ready ? 1 : progress / unitTicks,
        running: slot === 0,
      });
    }
  }
  walks.sort((a, b) => a.ticks - b.ticks || a.node - b.node || a.slot - b.slot);
  return walks.map((walk, k) => ({ ...walk, short: (k + 1) * cost > cp }));
}

/** The walks due of one city, by slot (`-1` first): what its ring marks. */
export function cityDues(dues: readonly DueWalk[], node: number): DueWalk[] {
  return dues.filter((d) => d.node === node).sort((a, b) => a.slot - b.slot);
}
