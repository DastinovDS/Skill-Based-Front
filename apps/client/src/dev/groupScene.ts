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
import type { GroupView, MapFile, OrderView, SnapshotMsg } from '../protocol.gen.ts';
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
 * left, Watchhouse's waits 4 s; Ford sends its recruits to Watchhouse (its rally point).
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
  const nodes = base.view.nodes.map((n) => (n.id === 13 ? { ...n, rally_point: 12 } : n));
  return { ...base, view: { ...base.view, groups, nodes, intents: [], fights: [] } };
}
