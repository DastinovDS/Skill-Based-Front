/**
 * The `provinces` scene of the dev screen (#348): one moment of a game on the pool map `crossroads`
 * (DEC-27: 22 of its 49 nodes are provinces), with its baked background. It shows what the other
 * scenes cannot: provinces as hollow rings (an own one, an own one with a group, nobody's with a
 * group of its own on it, the enemy's in sight and in the fog) next to cities with warehouses of
 * every level (places filled, frames, dashed). Made here from the map file, not a fixture of the
 * protocol: it is a picture for the eyes, the numbers only have to be plausible.
 */
import type {
  Detail,
  EdgeView,
  GroupView,
  MapFile,
  NodeView,
  Seen,
  SnapshotMsg,
} from '../protocol.gen.ts';
import { DEV_CAPACITY } from '../hud/devFeed.ts';
import { warehouseCapOf } from './devWarehouse.ts';

export const PROVINCES_TICK = 1200;

/** The part of the map (world units) the camera looks at: the own half and the middle. */
export const PROVINCES_VIEW = { x: 100, y: 140, width: 1000, height: 640 } as const;

const ENEMY = [10, 11, 15, 19, 20, 16];
/** Own groups stand here: the nodes are seen exactly, their neighbours as presence. */
const STATIONED = [2, 6, 7, 12];
/** Warehouse of the own cities at the level of `LEVEL` (the capacity of the level where not listed). */
const STOCK: Readonly<Record<number, number>> = { 0: 5, 1: 1, 4: 3, 6: 0, 7: 2, 8: 1 };
/** Warehouse level of the own cities: 0, 1 and 2 (the top level) all appear. */
const LEVEL: Readonly<Record<number, number>> = { 0: 1, 1: 0, 4: 2, 6: 1, 7: 2, 8: 0 };
/** Memory of a node in the fog, ticks ago. */
const SEEN_NODE: Readonly<Record<number, number>> = { 19: 400, 20: 900 };

const T = PROVINCES_TICK;
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

export function provincesSnapshot(map: MapFile): SnapshotMsg {
  const owner = (node: number) =>
    ENEMY.includes(node) ? 1 : (map.nodes[node]?.start_owner ?? null) === 0 ? 0 : null;
  const isExact = (node: number) => owner(node) === 0 || STATIONED.includes(node);
  const nextToExact = (node: number) =>
    map.edges.some((e) => (e.a === node && isExact(e.b)) || (e.b === node && isExact(e.a)));

  const nodes: NodeView[] = map.nodes.map((n) => {
    const capacity = DEV_CAPACITY[n.kind];
    const city = n.kind !== 'province';
    const mine = owner(n.id) === 0;
    const detail: Detail = isExact(n.id) ? 'exact' : nextToExact(n.id) ? 'presence' : 'fog';
    const ago = SEEN_NODE[n.id];
    const enemy = owner(n.id) === 1;
    const memory =
      detail === 'fog'
        ? ago === undefined
          ? null
          : seen('presence', ago, enemy ? ['attack'] : [])
        : seen(detail, 0, detail === 'presence' && enemy ? ['attack'] : []);
    const level = LEVEL[n.id] ?? 0;
    const cap = warehouseCapOf(n.kind, level);
    return {
      id: n.id,
      owner: owner(n.id),
      capacity,
      detail,
      // A node of a vision source carries its warehouse: a province's is 0, it has none (DEC-23).
      warehouse: detail === 'exact' ? (city && mine ? Math.min(STOCK[n.id] ?? cap, cap) : 0) : null,
      seen: memory,
      attrition_in: null,
      grace_left: null,
      starve_in: null,
      recruit_queue: mine && city ? 0 : null,
      recruit_progress: mine && city ? 0 : null,
      recruit_waiting: mine && city ? false : null,
      has_barracks: mine && city ? n.kind === 'capital' : null,
      warehouse_level: mine && city ? level : null,
      warehouse_cap: mine && city ? cap : null,
      building: null,
    };
  });

  const edges: EdgeView[] = map.edges.map((e) => {
    const sight = isExact(e.a) || isExact(e.b);
    const half = (node: number): EdgeView['halves'][number] => {
      const detail = nodes[node]?.detail ?? 'fog';
      return { detail, seen: detail === 'fog' ? null : seen(detail, 0) };
    };
    return {
      id: e.id,
      width: 1,
      detail: sight ? 'presence' : 'fog',
      upgrade_gain: null,
      halves: [half(e.a), half(e.b)],
      build: null,
      enemy_groups: [],
    };
  });

  const garrison = (node: number, units: number, charged: number) =>
    ({
      id: id(node + 1),
      units,
      charged,
      mode: 'attack',
      location: { kind: 'node', node },
      order: null,
      defense_bonus: null,
      defense_cap: null,
    }) satisfies GroupView;
  // Own groups in an own province (2), in a city (6, 7) and in a province nobody owns (12).
  const groups: GroupView[] = [
    garrison(2, 2, 1),
    garrison(6, 3, 3),
    garrison(7, 4, 2),
    garrison(12, 1, 0),
  ];

  return {
    type: 'snapshot',
    tick: T,
    view: {
      me: { cp: 380, stance: 'balance', fronts: [7, null], rear_min: 1 },
      vp: [6, 7],
      nodes,
      edges,
      groups,
      packets: [],
      intents: [],
      fights: [],
    },
  };
}
