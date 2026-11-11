/**
 * The `economy` scenes of the dev screen (DEC-41, #649): the artery moment. On the map: the own
 * capital and a built factory, a factory build that still waits for two charges, a factory of the
 * enemy next to an own city (DEC-31), a barracks build that owes a charge, and a planned order that
 * gathers its bonus (+1 of 3). A picture for the eyes: the numbers only have to be plausible.
 */
import type {
  EventMsg,
  GroupView,
  IntentView,
  MapFile,
  NodeView,
  PacketView,
  SnapshotMsg,
} from '../protocol.gen.ts';
import { ARTERY_TICK, ARTERY_VIEW, arterySnapshot } from './arteryScene.ts';

export const ECONOMY_TICK = ARTERY_TICK;
export const ECONOMY_VIEW = ARTERY_VIEW;

const T = ECONOMY_TICK;
const id = (n: number) => (0x6000 + n).toString(16).padStart(16, '0');

export function economySnapshot(map: MapFile): SnapshotMsg {
  const base = arterySnapshot(map);
  const nodes: NodeView[] = base.view.nodes.map((node) => {
    const v2 = { ...node, starve_in: null };
    switch (node.id) {
      // The capital is the main factory (DEC-41, item 2).
      case 0:
        return { ...v2, factory: true, factory_period: 50 };
      // A built factory.
      case 3:
        return { ...v2, factory: true, factory_period: 100 };
      // A factory build that waits for two charges.
      case 4:
        return { ...v2, factory: false, factory_build: { done_tick: null, owed: 2 } };
      // A barracks build that still owes a charge (the progressive payment, item 7).
      case 6:
        return {
          ...v2,
          factory: false,
          has_barracks: false,
          building: { kind: 'barracks', done_tick: null, owed: 1 },
        };
      // The enemy city next door: its built factory is seen (DEC-31).
      case 5:
        return { ...v2, factory: true };
      default:
        return node.owner === 0 && node.warehouse_cap !== null ? { ...v2, factory: false } : v2;
    }
  });
  const edges = base.view.edges;
  const groups: GroupView[] = base.view.groups.map((g) => {
    const plain: GroupView = { ...g, mode: 'attack' };
    if (g.location.kind === 'node' && g.location.node === 12) {
      return {
        ...plain,
        units: 3,
        charged: 3,
        order: {
          dest: 7,
          path: [7],
          planned: true,
          bonus: 1,
          gathering: true,
          plan: 3,
          next_charge_tick: T + 12,
          depart_tick: null,
          group_order: null,
          arrive_tick: null,
        },
      };
    }
    // The planned order of the artery moment is not a gathering plan: it goes.
    return g.order?.planned === true ? { ...plain, order: null } : plain;
  });
  const intents: IntentView[] = [
    // The gathering plan is public at once (its size and its bonus are not).
    { id: id(1), owner: 0, kind: 'planned_move', origin: 12, target: 7, created_tick: T - 40 },
    ...base.view.intents.filter((i) => i.owner === 1),
  ];
  const packet = (edge: number, from: number, path: [number, ...number[]], p: number) => {
    const ticks = Math.round(((map.edges[edge]?.travel_ticks ?? 50) * 100) / 150);
    const depart = T - Math.round(p * ticks);
    return {
      id: id(100 + edge * 10 + Math.round(p * 10)),
      edge,
      from_node: from,
      charges: 1,
      depart_tick: depart,
      arrive_tick: depart + ticks,
      path,
      dest_tick: depart + ticks * path.length,
    } satisfies PacketView;
  };
  // A line carries one charge a dispatch (L1): single charges on the way.
  const packets: PacketView[] = [
    packet(0, 0, [3, 4], 0.3),
    packet(0, 0, [3], 0.75),
    packet(1, 3, [4], 0.55),
    packet(4, 0, [1, 6], 0.6),
    packet(14, 4, [12], 0.75),
    packet(16, 4, [13], 0.4),
  ];
  return {
    ...base,
    view: {
      ...base.view,
      me: { ...base.view.me },
      nodes,
      edges,
      groups,
      intents,
      packets,
      // No fight: the build plates over Forkway are the subject here.
      fights: [],
    },
  };
}

/** The `build_pay` scene (#872): close on Forkway and Watchhouse, the payment of two builds in motion. */
export const BUILD_PAY_VIEW = { x: 440, y: 300, width: 150, height: 250 } as const;

/**
 * The `build_pay` scene: the `economy` moment with Forkway's factory (4 charges) owing one, the
 * second charge landed 150 ms ago (its pop), the third and fourth in the air (from the warehouse,
 * nearly there; from the group standing in the city, just leaving its helmet); Watchhouse's barracks
 * (3 charges) paid in full 0.6 s ago, its lozenges running into the icon.
 */
export function buildPaySnapshot(map: MapFile): SnapshotMsg {
  const base = economySnapshot(map);
  const nodes = base.view.nodes.map((node): NodeView => {
    switch (node.id) {
      case 4:
        return {
          ...node,
          warehouse: 0,
          factory_build: { done_tick: null, owed: 1 },
        };
      case 12:
        return {
          ...node,
          has_barracks: false,
          building: { kind: 'barracks', done_tick: T - 6 + 100, owed: 0 },
        };
      default:
        return node;
    }
  });
  // Forkway's group paid one charge; Watchhouse's gathering plan goes (its ribbon would hide the arc).
  const groups = base.view.groups.map((g) => {
    if (g.location.kind !== 'node') return g;
    if (g.location.node === 4) return { ...g, charged: 1 };
    return g.location.node === 12 ? { ...g, order: null } : g;
  });
  const intents = base.view.intents.filter((i) => i.origin !== 12);
  return { ...base, view: { ...base.view, nodes, groups, intents } };
}

/** The `build_paid` events of `build_pay`, by their age in ticks at the tick of the snapshot. */
export function buildPayEvents(): EventMsg[] {
  const paid = (
    age: number,
    node: number,
    kind: string,
    warehouse: number,
    units: number,
    owed: number,
  ): EventMsg => ({
    type: 'event',
    tick: T - age,
    kind: 'build_paid',
    data: { player: 0, node, kind, warehouse, units, owed },
  });
  return [
    paid(6, 4, 'factory', 1, 0, 3),
    paid(6, 12, 'barracks', 1, 0, 0),
    paid(3, 4, 'factory', 1, 1, 1),
  ];
}
