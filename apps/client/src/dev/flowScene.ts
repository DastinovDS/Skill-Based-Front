/**
 * The `flow` scenes of the dev screen (DEC-43, #705): the artery moment under the flow rules
 * (`DEV_RULES_FLOW`): the automatic supply flow. Two fronts (the enemy at Archway
 * in the east, neutral ground at Bluff in the north and Oakgrove in the south), the capital and a
 * second factory, a pocket (West Shoulder, cut off with no factory), and the level at the front
 * (`flowSnapshot(map)`).
 *
 * The fields of DEC-43 item E are written out here by hand, from the map's roads, as the server
 * would send them for these stocks; this file is a picture for the eyes, not a copy of the rule:
 * the client reads the fields and never computes them (`AGENTS.md`, 7.1).
 */
import type {
  EdgeView,
  FlowIdle,
  GroupView,
  MapFile,
  NodeView,
  PacketView,
  SnapshotMsg,
} from '../protocol.gen.ts';
import { ARTERY_TICK, ARTERY_VIEW, arterySnapshot } from './arteryScene.ts';

const FLOW_TICK = ARTERY_TICK;
export const FLOW_VIEW = ARTERY_VIEW;

const T = FLOW_TICK;
/** The own nodes of the main body (the capital 0 and the factory 3) and the pocket 14. */
const OWN = [0, 1, 2, 3, 4, 6, 7, 9, 10, 12, 13, 14] as const;
const POCKET = [14];
const FACTORIES = [0, 3];
/** Roads to the nearest leaf (hops), `front_dist` before a shift: leaves 4, 7, 10 and the pocket 14. */
const FIELD: Readonly<Record<number, number>> = {
  0: 2,
  1: 2,
  2: 2,
  3: 1,
  4: 0,
  6: 1,
  7: 0,
  9: 1,
  10: 0,
  12: 1,
  13: 1,
  14: 0,
};
/** The downhill neighbours (`flow_down`) at the shift 0: towards the leaves. */
const DOWN0: Readonly<Record<number, readonly number[]>> = {
  0: [3, 6, 9],
  1: [6],
  2: [9],
  3: [4],
  6: [7],
  9: [10],
  12: [4, 7],
  13: [4, 10],
};
interface Variant {
  readonly stock: Readonly<Record<number, number>>;
  /** The receivers of the next dispatch (`flow_next`); a node not listed sends nothing. */
  readonly next: Readonly<Record<number, readonly number[]>>;
  readonly idle: Readonly<Record<number, FlowIdle>>;
}

/** The level is the front: the leaves keep, everything behind rolls towards them. */
const VARIANT: Variant = {
  stock: { 0: 6, 1: 2, 2: 1, 3: 3, 4: 1, 6: 2, 7: 0, 9: 3, 10: 0, 12: 1, 13: 2, 14: 0 },
  next: { 0: [6], 1: [6], 3: [4], 6: [7], 12: [7], 13: [4, 10] },
  idle: { 2: 'full', 4: 'leaf', 7: 'leaf', 9: 'full', 10: 'leaf', 14: 'leaf' },
};

const id = (n: number) => (0x7000 + n).toString(16).padStart(16, '0');

export function flowSnapshot(map: MapFile): SnapshotMsg {
  const base = arterySnapshot(map);
  const variant = VARIANT;
  const down = DOWN0;
  const exact = {
    tick: T,
    level: 'exact' as const,
    enemy_modes: [],
    enemy_units: 0,
    enemy_charged: 0,
    enemy_range: null,
  };
  const nodes: NodeView[] = base.view.nodes.map((node) => {
    const own = (OWN as readonly number[]).includes(node.id);
    if (!own) {
      // Archway (5), the enemy's, stays; every node of the own side before is replaced below.
      return node.owner === 0
        ? { ...node, owner: null, warehouse: null, warehouse_cap: null }
        : { ...node, front_dist: null, flow_down: null, flow_next: null, flow_idle: null };
    }
    const cap = node.id === 0 ? 6 : 3;
    const next = variant.next[node.id] ?? [];
    return {
      ...node,
      owner: 0,
      detail: 'exact',
      seen: exact,
      warehouse: variant.stock[node.id] ?? 0,
      warehouse_cap: cap,
      has_barracks: node.id === 0,
      factory: FACTORIES.includes(node.id),
      factory_period: FACTORIES.includes(node.id) ? (node.id === 0 ? 100 : 200) : null,
      front_dist: FIELD[node.id] ?? null,
      flow_down: [...(down[node.id] ?? [])],
      flow_next: [...next],
      flow_idle: next.length > 0 ? null : (variant.idle[node.id] ?? null),
      flow_pocket: POCKET.includes(node.id),
      terrain_mark: null,
    };
  });
  const edges: EdgeView[] = base.view.edges;
  const packet = (edge: number, from: number, to: number, p: number): PacketView => {
    const ticks = Math.round(((map.edges[edge]?.travel_ticks ?? 50) * 100) / 150);
    const depart = T - Math.round(p * ticks);
    return {
      id: id(edge),
      edge,
      from_node: from,
      charges: 1,
      depart_tick: depart,
      arrive_tick: depart + ticks,
      path: [to],
      dest_tick: depart + ticks,
    };
  };
  // Charges on the way, one per road at most: the leaf level is fed by the wave behind it.
  const packets: PacketView[] = [
    packet(1, 3, 4, 0.55),
    packet(12, 9, 10, 0.4),
    packet(8, 0, 6, 0.3),
    packet(15, 12, 7, 0.7),
  ];
  const garrison = (node: number, units: number, charged: number): GroupView => ({
    id: id(100 + node),
    units,
    charged,
    mode: 'attack',
    location: { kind: 'node', node },
    order: null,
  });
  return {
    ...base,
    view: {
      ...base.view,
      me: {
        cp: 320,
        stance: 'balance',
        leaf_shift: 0,
        leaf_shift_max: 2,
        next_dispatch_tick: T + 10,
        cp_ticks: null,
        capital_ticks: null,
      },
      nodes,
      edges,
      packets,
      groups: [garrison(4, 3, 3), garrison(7, 2, 0), garrison(10, 2, 2)],
      intents: [],
      fights: [],
    },
  };
}

/**
 * The `stances` scene (DEC-44, #772): the same moment under the stances rules, in War, 30 ticks into
 * the next CP quantum (of 40: half a CP, as `mvp-7`, #900) and 100 into the next charge of the capital
 * (of 400).
 */
export function stancesSnapshot(map: MapFile): SnapshotMsg {
  const base = flowSnapshot(map);
  return {
    ...base,
    view: {
      ...base.view,
      me: { ...base.view.me, stance: 'war', cp_ticks: 30, capital_ticks: 100 },
    },
  };
}
