/**
 * The `economy` scenes of the dev screen (economy v2, DEC-41, #649): the artery moment under the
 * rules of `mvp-3` (`DEV_RULES_V2`). On the map: the own capital and a built factory, a factory build
 * that still waits for two charges and a bunker build that runs, a bunker on an own city, a factory
 * and a bunker of the enemy next to an own city (DEC-31), a barracks build that owes a charge, and a
 * planned order that gathers its bonus (+1 of 3). On the «Supply» layer (`economy_supply`, Tab): the
 * own supply lines the player drew (one of them a relay to a third city, two of them sharing a road)
 * with charges gliding on them. No stances, front markers, rear minimum, road levels or "Defense".
 * A picture for the eyes: the numbers only have to be plausible.
 */
import type {
  GroupView,
  IntentView,
  LineView,
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

/** The own supply lines (`View.lines`): the capital feeds Watchpost and on to Forkway, Firwood and on to
 * Wood Hollow; Forkway, the target of a line, relays to Watchhouse; the capital feeds Forkway again. */
const LINES: readonly LineView[] = [
  { id: 1, path: [0, 3, 4] },
  { id: 2, path: [0, 1, 6] },
  { id: 3, path: [4, 12] },
  { id: 4, path: [0, 3] },
];

export function economySnapshot(map: MapFile): SnapshotMsg {
  const base = arterySnapshot(map);
  const nodes: NodeView[] = base.view.nodes.map((node) => {
    const v2 = { ...node, starve_in: null };
    switch (node.id) {
      // The capital is the main factory (DEC-41, item 2).
      case 0:
        return { ...v2, factory: true, factory_period: 50 };
      // A built factory with a bunker.
      case 3:
        return { ...v2, factory: true, factory_period: 100, fort: true };
      // A factory build that waits for two charges, and a bunker build that runs.
      case 4:
        return {
          ...v2,
          factory: false,
          factory_build: { done_tick: null, owed: 2 },
          fort: false,
          fort_build: { done_tick: T + 40, owed: 0 },
        };
      // A barracks build that still owes a charge (the progressive payment, item 7).
      case 6:
        return {
          ...v2,
          factory: false,
          fort: false,
          has_barracks: false,
          building: { kind: 'barracks', done_tick: null, owed: 1 },
        };
      // A bunker on an own city.
      case 12:
        return { ...v2, factory: false, fort: true };
      // The enemy city next door: its built factory and bunker are seen (DEC-31).
      case 5:
        return { ...v2, factory: true, fort: true };
      default:
        return node.owner === 0 && node.warehouse_cap !== null
          ? { ...v2, factory: false, fort: false }
          : v2;
    }
  });
  // Roads have no levels under v2 (item 8): every road is level 1 and none is being built.
  const edges = base.view.edges.map((edge) => ({
    ...edge,
    width: 1,
    upgrade_gain: null,
    build: null,
  }));
  const groups: GroupView[] = base.view.groups.map((g) => {
    // No "Defense" under v2: the bunker replaces it.
    const plain: GroupView = { ...g, mode: 'attack', defense_bonus: null, defense_cap: null };
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
        },
      };
    }
    // The planned order of the artery moment is a v1 one: it goes.
    return g.order?.planned === true ? { ...plain, order: null } : plain;
  });
  const intents: IntentView[] = [
    // The gathering plan is public at once (its size and its bonus are not).
    { id: id(1), owner: 0, kind: 'planned_move', origin: 12, target: 7, created_tick: T - 40 },
    ...base.view.intents.filter((i) => i.kind === 'planned_move' && i.owner === 1),
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
      transfer: false,
    } satisfies PacketView;
  };
  // A line carries one charge a dispatch (L1): single charges on the way.
  const packets: PacketView[] = [
    packet(0, 0, [3, 4], 0.3),
    packet(0, 0, [3], 0.75),
    packet(1, 3, [4], 0.55),
    packet(4, 0, [1, 6], 0.6),
    packet(14, 4, [12], 0.75),
  ];
  return {
    ...base,
    view: {
      ...base.view,
      me: { ...base.view.me, fronts: [null, null] },
      nodes,
      edges,
      groups,
      intents,
      packets,
      // No fight: the build plates over Forkway are the subject here.
      fights: [],
      lines: [...LINES],
    },
  };
}
