/**
 * The `arteriya` scene of the dev screen (#344): one moment of a game on the real map with its
 * baked background, as in the style mockups (`docs/design/mockups/map-style-2.html`, the fragment
 * of nodes 3-16). The test maps of the other scenes have no background, so the background, the
 * shading, the fog and the roads of the map style are seen only here. Own and enemy cities and
 * groups, the border of the territory, the fog with a remembered ghost, roads of levels 1-3, a road
 * being built, a fight in a city and planned orders. Made here from the map file, not a fixture of
 * the protocol: it is a picture for the eyes, the numbers only have to be plausible.
 */
import { DEV_CAPACITY } from '../hud/devFeed.ts';
import type {
  Detail,
  EdgeView,
  FightView,
  GroupView,
  IntentView,
  MapFile,
  NodeView,
  PacketView,
  Seen,
  SnapshotMsg,
} from '../protocol.gen.ts';

/** The tick the scene is frozen at (4 minutes into the game, so the fog memory has ages). */
export const ARTERIYA_TICK = 2400;

/** The part of the map the mockups show, world units: where the camera looks. */
export const ARTERIYA_VIEW = { x: 230, y: 130, width: 720, height: 580 } as const;

const OWN = [0, 1, 2, 3, 4, 6, 9, 12, 13];
const ENEMY = [5, 14, 15, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30];
/** Own cities with a group standing in them: the neighbours of these are seen as presence. */
const STATIONED = [3, 4, 6, 9, 12];
/** Warehouse stock of the own cities (the capacity of the kind where not listed). */
const STOCK: Readonly<Record<number, number>> = {
  0: 6,
  1: 2,
  2: 1,
  3: 3,
  4: 2,
  6: 2,
  9: 2,
  12: 1,
  13: 1,
};
/** What the player knows of the road levels (`edge.width`); the others are level 1. */
const LEVEL: Readonly<Record<number, number>> = { 1: 3, 14: 2, 6: 2, 2: 2, 3: 2 };
/** Fog memory, ticks ago: a city or road not listed here and out of sight was never seen. */
const SEEN_NODE: Readonly<Record<number, number>> = { 15: 210, 14: 950, 8: 1500, 11: 2000 };
const SEEN_EDGE: Readonly<Record<number, number>> = { 3: 210, 18: 950, 11: 1500 };

const T = ARTERIYA_TICK;
const id = (n: number) => n.toString(16).padStart(16, '0');

function seen(level: Detail, ago: number, enemyModes: Seen['enemy_modes'] = []): Seen {
  const exact = level === 'exact';
  return {
    tick: T - ago,
    level,
    enemy_modes: enemyModes,
    enemy_units: exact ? 0 : null,
    enemy_charged: exact ? 0 : null,
    enemy_range: null,
  };
}

export function arteriyaSnapshot(map: MapFile): SnapshotMsg {
  const owner = (node: number) => (OWN.includes(node) ? 0 : ENEMY.includes(node) ? 1 : null);
  const isExact = (node: number) => OWN.includes(node) || STATIONED.includes(node);
  const nextToExact = (node: number) =>
    map.edges.some((e) => (e.a === node && isExact(e.b)) || (e.b === node && isExact(e.a)));

  const nodes: NodeView[] = map.nodes.map((n) => {
    const capacity = DEV_CAPACITY[n.kind];
    const mine = OWN.includes(n.id);
    const detail: Detail = isExact(n.id) ? 'exact' : nextToExact(n.id) ? 'presence' : 'fog';
    const ago = SEEN_NODE[n.id];
    const memory =
      detail === 'fog'
        ? ago === undefined
          ? null
          : seen('presence', ago, owner(n.id) === 1 ? ['attack'] : [])
        : seen(detail, 0, detail === 'presence' && owner(n.id) === 1 ? ['attack'] : []);
    return {
      id: n.id,
      owner: owner(n.id),
      capacity,
      detail,
      warehouse: mine ? (STOCK[n.id] ?? capacity) : null,
      seen: memory,
      attrition_in: null,
      grace_left: null,
      starve_in: null,
      recruit_queue: mine ? 0 : null,
      recruit_progress: mine ? 0 : null,
      recruit_waiting: mine ? false : null,
      has_barracks: mine ? n.kind === 'capital' : null,
      warehouse_level: mine ? 0 : null,
      warehouse_cap: mine ? capacity : null,
      building: null,
    };
  });

  const half = (node: number, ago: number | undefined): EdgeView['halves'][number] => {
    const detail = nodes[node]?.detail ?? 'fog';
    if (detail !== 'fog') return { detail, seen: seen(detail, 0) };
    return { detail, seen: ago === undefined ? null : seen('presence', ago) };
  };

  const edges: EdgeView[] = map.edges.map((e) => {
    const sight = isExact(e.a) || isExact(e.b);
    const bothOwn = OWN.includes(e.a) && OWN.includes(e.b);
    const width = LEVEL[e.id] ?? 1;
    const ago = SEEN_EDGE[e.id];
    return {
      id: e.id,
      width,
      detail: sight ? 'presence' : 'fog',
      upgrade_gain:
        sight && bothOwn && width < e.max_width
          ? { speed_pct: 50, unit_speed_pct: 15, amount: 1 }
          : null,
      // Each half as its city (DEC-21, item 5); a hidden half keeps the memory of the road.
      halves: [half(e.a, ago), half(e.b, ago)],
      // The road 4-13 is being built: 12 s to go (DEC-28, item 7).
      build: e.id === 16 ? { done_tick: T + 120 } : null,
      enemy_groups: [],
    };
  });

  const garrison = (node: number, units: number, charged: number, extra: Partial<GroupView> = {}) =>
    ({
      id: id(node + 1),
      units,
      charged,
      mode: 'attack',
      location: { kind: 'node', node },
      order: null,
      defense_bonus: null,
      defense_cap: null,
      ...extra,
    }) satisfies GroupView;
  const groups: GroupView[] = [
    garrison(3, 4, 3),
    garrison(4, 3, 2),
    garrison(6, 2, 2, { mode: 'defense', defense_bonus: 1, defense_cap: 2 }),
    garrison(12, 1, 1),
    // Marching along the road 6-7 on a normal order.
    {
      id: id(100),
      units: 3,
      charged: 2,
      mode: 'attack',
      location: { kind: 'edge', edge: 10, from_node: 6, progress: 360 },
      order: { dest: 7, path: [7], planned: false, bonus: 0 },
      defense_bonus: null,
      defense_cap: null,
    },
    // Waiting for a planned order to start: the bonus is a forecast by the charged units.
    garrison(9, 2, 2, { order: { dest: 10, path: [10], planned: true, bonus: 2 } }),
  ];

  const packet = (
    edge: number,
    from: number,
    to: number,
    charges: number,
    p: number,
    transfer: boolean,
  ) => {
    const ticks = map.edges[edge]?.travel_ticks ?? 50;
    const depart = T - Math.round(p * ticks);
    return {
      id: id(200 + edge * 10 + charges),
      edge,
      from_node: from,
      charges,
      depart_tick: depart,
      arrive_tick: depart + ticks,
      path: [to],
      dest_tick: depart + ticks,
      transfer,
    } satisfies PacketView;
  };
  const packets: PacketView[] = [
    packet(1, 3, 4, 2, 0.64, false),
    packet(1, 3, 4, 3, 0.77, true),
    packet(14, 4, 12, 1, 0.5, false),
  ];

  const intents: IntentView[] = [
    { id: id(300), owner: 0, kind: 'planned_move', origin: 9, target: 10, created_tick: T - 20 },
    { id: id(301), owner: 0, kind: 'defense', origin: 6, target: null, created_tick: T - 80 },
    { id: id(302), owner: 1, kind: 'planned_move', origin: 5, target: 4, created_tick: T - 30 },
  ];

  // The enemy attacks the city 4: both sides have discharged units, and bonus shots are left.
  const fights: FightView[] = [
    {
      id: id(400),
      node: 4,
      edge: null,
      point: null,
      attacker: 1,
      start_tick: T - 60,
      next_round_tick: T + 8,
      groups: [id(5)],
      enemy_units: 4,
      enemy_charged: 1,
      shots: [4, 2],
      losses: [0, 1],
      virtual_left: [2, 1],
      mute: [0, 0],
      last_round: {
        tick: T - 12,
        shots: [2, 1],
        virtual: [0, 0],
        spent: [2, 1],
        losses: [0, 1],
      },
    },
  ];

  return {
    type: 'snapshot',
    tick: T,
    view: {
      me: { cp: 420, stance: 'balance', fronts: [3, null], rear_min: 1 },
      vp: [9, 17],
      nodes,
      edges,
      groups,
      packets,
      intents,
      fights,
    },
  };
}
