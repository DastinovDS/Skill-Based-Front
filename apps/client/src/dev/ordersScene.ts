/**
 * The `orders` scene of the dev screen (#519): the planned orders of both sides in every state on
 * the artery moment, to look at ODb "Low relief" (ui-style 33.3): an own order that waits (the
 * delay half filled, with the forecast of the bonus), one that leaves just now (the pulse), one on
 * the way (the running band) going left, going right and going down, and the opponent's orders
 * waiting and on the way, over an own city (amber ring) and over a neutral one (red ring). Made
 * from `arterySnapshot`, a picture for the eyes: the numbers only have to be plausible.
 */
import type { GroupView, IntentView, MapFile, SnapshotMsg } from '../protocol.gen.ts';
import { ARTERY_TICK, ARTERY_VIEW, arterySnapshot } from './arteryScene.ts';

export const ORDERS_TICK = ARTERY_TICK;
export const ORDERS_VIEW = ARTERY_VIEW;

/** The delay of a planned order in the dev rules (`DEV_RULES.orders.planned_delay_ticks`). */
const DELAY = 30;
const id = (n: number) => (0x5000 + n).toString(16).padStart(16, '0');

interface Plan {
  readonly owner: 0 | 1;
  readonly origin: number;
  readonly target: number;
  /** Ticks since the delay ran out; negative while it runs (-15: half way). */
  readonly since: number;
  readonly bonus?: number;
}

const PLANS: readonly Plan[] = [
  // Own: waiting half way, going up and left (the arc must bulge up, not over the caption below).
  { owner: 0, origin: 12, target: 7, since: -15, bonus: 2 },
  // Own: the pulse of the departure, going right.
  { owner: 0, origin: 6, target: 12, since: 4, bonus: 1 },
  // Own: on the way, a long order to the right past an enemy city.
  { owner: 0, origin: 4, target: 14, since: 40, bonus: 2 },
  // Own: waiting at the start, going down.
  { owner: 0, origin: 3, target: 13, since: -27, bonus: 1 },
  // The opponent: waiting, against my city; and on the way, against a neutral one, going left.
  { owner: 1, origin: 5, target: 4, since: -18 },
  { owner: 1, origin: 14, target: 8, since: 30 },
];

export function ordersSnapshot(map: MapFile): SnapshotMsg {
  const base = arterySnapshot(map);
  const T = base.tick;
  const planned = new Set(PLANS.filter((p) => p.owner === 0).map((p) => p.origin));
  const groups: GroupView[] = base.view.groups
    // One group a city: the stationed ones of the artery moment give way to the plans.
    .map((g) => (g.location.kind === 'node' && planned.has(g.location.node) ? null : g))
    .filter((g): g is GroupView => g !== null);
  PLANS.forEach((p, i) => {
    if (p.owner !== 0) return;
    groups.push({
      id: id(i),
      units: 3,
      charged: 2,
      mode: 'attack',
      location: { kind: 'node', node: p.origin },
      order: { dest: p.target, path: [p.target], planned: true, bonus: p.bonus ?? 0 },
      defense_bonus: null,
      defense_cap: null,
    });
  });
  const intents: IntentView[] = [
    ...base.view.intents.filter((i) => i.kind === 'defense'),
    ...PLANS.map((p, i) => ({
      id: id(100 + i),
      owner: p.owner,
      kind: 'planned_move' as const,
      origin: p.origin,
      target: p.target,
      created_tick: T - DELAY - p.since,
    })),
  ];
  return { ...base, view: { ...base.view, groups, intents } };
}
