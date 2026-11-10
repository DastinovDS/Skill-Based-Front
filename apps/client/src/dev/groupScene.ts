/**
 * The `group_*` scenes of the dev screen (DEC-48, #896): the group order and the recruit rally point
 * on the artery moment, to look at the look the owner chose (item K8, mockup `group-order.html`):
 *
 * - `group_select`: three groups selected together (A1 frames, A2 seals, A3 card), the box of a
 *   Shift drag over a fourth, the pointer on an enemy city: the members' lines and the dashed seal
 *   with the price (B1 before the click);
 * - `group_plan`: the same with `E` held: a hatched planned ribbon a member (D2) and the bonus counter;
 * - `group_order`: a synchronized attack the server has timed: two members wait in their cities (C3),
 *   one is on its way, the seal over the target (B1); a city with its rally point (E3).
 *
 * Made from `arterySnapshot`: a picture for the eyes, the numbers only have to be plausible.
 */
import type { EventMsg, GroupView, MapFile, OrderView, SnapshotMsg } from '../protocol.gen.ts';
import type { WorldRect } from '../render/interaction.ts';
import { ARTERY_TICK, ARTERY_VIEW, arterySnapshot } from './arteryScene.ts';

export const GROUP_TICK = ARTERY_TICK;
export const GROUP_VIEW = ARTERY_VIEW;

const id = (n: number) => (0x6000 + n).toString(16).padStart(16, '0');

/** Watchpost, Watchhouse, Wood Hollow: the three groups selected together, in this order. */
const PICKED = [3, 12, 6] as const;
/** Archway: the enemy city the pointer rests on. */
const TARGET = 5;

/** What a scene pins on the frozen dev screen: the selection, the pointer, `E`, a box. */
export interface ScenePins {
  /** Groups selected together (`OrderController.selectBox`), in this order. */
  readonly picks?: readonly string[];
  /** The node under the pointer, whatever the real pointer does. */
  readonly hover?: number;
  /** `E` is held: a planned order. */
  readonly eHeld?: boolean;
  /** A selection box being dragged, world units. */
  readonly box?: WorldRect;
}

const garrison = (node: number, units: number, charged: number, order: OrderView | null = null) =>
  ({
    id: id(node),
    units,
    charged,
    mode: 'attack',
    location: { kind: 'node', node },
    order,
  }) satisfies GroupView;

/** The artery moment with the groups of the selection standing in their cities and Forkway's too. */
export function groupSelectSnapshot(map: MapFile): SnapshotMsg {
  const base = arterySnapshot(map);
  const groups: GroupView[] = [
    garrison(3, 4, 3),
    garrison(12, 2, 2),
    garrison(6, 3, 2),
    garrison(4, 3, 2),
  ];
  return { ...base, view: { ...base.view, groups, intents: [], fights: [] } };
}

export const GROUP_SELECT_PINS: ScenePins = {
  picks: PICKED.map((node) => id(node)),
  hover: TARGET,
  // Half dragged over Forkway, from below and to the left of it.
  box: { x0: 430, y0: 560, x1: 575, y1: 445 },
};

export const GROUP_PLAN_PINS: ScenePins = {
  picks: PICKED.map((node) => id(node)),
  hover: TARGET,
  eHeld: true,
};

const T = GROUP_TICK;
/** The common arrival of the timed order: six seconds from now. */
const ARRIVE = T + 60;

const member = (path: [number, ...number[]], depart: number): OrderView => ({
  dest: TARGET,
  path,
  planned: false,
  bonus: 0,
  gathering: false,
  plan: 0,
  next_charge_tick: null,
  depart_tick: depart,
  group_order: id(900),
  arrive_tick: ARRIVE,
});

/**
 * A synchronized attack on Archway: Watchpost's group waits 2 s, Wood Hollow's (the farthest) has
 * left, Watchhouse's waits 4 s; Stonegate sends its recruits to Watchhouse (its rally point).
 */
export function groupOrderSnapshot(map: MapFile): SnapshotMsg {
  const base = arterySnapshot(map);
  const groups: GroupView[] = [
    garrison(3, 4, 3, member([4, 5], T + 20)),
    garrison(12, 2, 2, member([4, 5], T + 40)),
    {
      ...garrison(6, 3, 2, member([7, 12, 4, 5], T - 30)),
      id: id(106),
      location: { kind: 'edge', edge: 10, from_node: 6, progress: 520 },
      order: member([7, 12, 4, 5], T - 30),
    },
    garrison(4, 3, 2),
  ];
  // Stonegate (the capital) sends its recruits to Watchhouse; Ford has a barracks and no point.
  const nodes = base.view.nodes.map((n) =>
    n.id === 0 ? { ...n, rally_point: 12 } : n.id === 13 ? { ...n, has_barracks: true } : n,
  );
  return { ...base, view: { ...base.view, groups, nodes, intents: [], fights: [] } };
}

/** The tick of the rally scene: 18 s into a 30 s VP period (#930, P1). */
export const RALLY_TICK = GROUP_TICK + 180;

/**
 * #930 (W10 "Plan, due, pay" and P1 "Ruled rail"): Stonegate (the capital) has three recruits queued
 * and Ford one, both sending them to Watchhouse; with 1.25 CP the two nearest walks are paid and the
 * two after them are not (the empty red earmarks). Ford's last recruit just stayed home for want of
 * CP (`rally_walk_no_cp`: the strip and the crossed mark at its gate). 18 s into the VP period.
 */
export function rallyDueSnapshot(map: MapFile): SnapshotMsg {
  const base = arterySnapshot(map);
  const nodes = base.view.nodes.map((n) =>
    n.id === 0
      ? { ...n, rally_point: 12, recruit_queue: 3, recruit_progress: 22 }
      : n.id === 13
        ? { ...n, has_barracks: true, rally_point: 12, recruit_queue: 1, recruit_progress: 6 }
        : n,
  );
  return {
    ...base,
    tick: RALLY_TICK,
    view: {
      ...base.view,
      me: { ...base.view.me, cp: 125 },
      nodes,
      vp_gain: [5, 7],
      intents: [],
      fights: [],
    },
  };
}

/** One step of the played rally scene: what the HUD gets `atMs` after the scene opens. */
export interface RallyPlayStep {
  readonly atMs: number;
  readonly events: readonly EventMsg[];
  readonly snapshot: SnapshotMsg;
}

/**
 * `?play=rally` on the rally scene (#930), for the HUD alone (the map stays frozen): Stonegate's
 * first recruit leaves and pays its walk (the CP mark flies into the gauge), then the VP credit of
 * tick 2700 rolls the totals and the gains slide into them.
 */
export function rallyPlay(map: MapFile): RallyPlayStep[] {
  const base = rallyDueSnapshot(map);
  const paid: SnapshotMsg = {
    ...base,
    tick: RALLY_TICK + 9,
    view: {
      ...base.view,
      me: { ...base.view.me, cp: 75 },
      nodes: base.view.nodes.map((n) =>
        n.id === 0 ? { ...n, recruit_queue: 2, recruit_progress: 0 } : n,
      ),
    },
  };
  const credit = 2700;
  const credited: SnapshotMsg = {
    ...paid,
    tick: credit,
    view: { ...paid.view, vp: [base.view.vp[0] + 5, base.view.vp[1] + 7] },
  };
  const ev = (tick: number, kind: string, data: EventMsg['data']): EventMsg => ({
    type: 'event',
    tick,
    kind,
    data,
  });
  return [
    {
      atMs: 0,
      events: [
        ev(paid.tick, 'rally_walk_paid', {
          player: 0,
          group: 'dev-walker',
          node: 0,
          target: 12,
          cost: 50,
        }),
      ],
      snapshot: paid,
    },
    {
      atMs: 2000,
      events: [
        ev(credit, 'vp_awarded', { player: 0, vp: 5 }),
        ev(credit, 'vp_awarded', { player: 1, vp: 7 }),
      ],
      snapshot: credited,
    },
  ];
}

/** The recruit of Ford that just stayed home in the rally scene (#930). */
export const RALLY_STAY: EventMsg = {
  type: 'event',
  tick: RALLY_TICK,
  kind: 'rally_walk_no_cp',
  data: { player: 0, group: 'dev-stay', node: 13, target: 12 },
};
