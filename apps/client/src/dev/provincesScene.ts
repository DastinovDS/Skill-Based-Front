/**
 * The `provinces` scene of the dev screen (#348): one moment of a game on the pool map `crossroads`
 * (DEC-27: 22 of its 49 nodes are provinces), with its baked background. It shows what the other
 * scenes cannot: provinces as pale dots (PB, #431) (an own one, an own one with a group, nobody's with a
 * group of its own on it, the enemy's in sight and in the fog) next to cities with warehouses of
 * every level (places filled, frames, dashed). Made here from the map file, not a fixture of the
 * protocol: it is a picture for the eyes, the numbers only have to be plausible.
 *
 * Vision as DEC-35: only own groups see. An own node without a group is `presence` (its own data
 * exact, an enemy in it seen without numbers) and gives its halves of roads no zone (`fog`); the
 * own territory is still drawn without the veil (the owner's decision of 2026-10-29).
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
/** Own groups stand here: the only sources, seen exactly; their neighbours as presence. */
const STATIONED = [2, 6, 7, 12];
/** Warehouse stock of the own cities (the capacity where not listed). */
const STOCK: Readonly<Record<number, number>> = { 0: 5, 1: 1, 4: 3, 6: 0, 7: 2, 8: 1 };
/** An enemy group stands in this own province without an own group: seen as presence (DEC-35). */
const INTRUDED = 3;
/** Terrain marks of some own places (`NodeView.terrain_mark`): up, down, up (#940). */
const TERRAIN_MARKS: Readonly<Record<number, number>> = { 2: 1, 6: -2, 12: 1 };
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
  const isExact = (node: number) => STATIONED.includes(node);
  const nextToExact = (node: number) =>
    map.edges.some((e) => (e.a === node && isExact(e.b)) || (e.b === node && isExact(e.a)));
  // The level of a node's halves of roads: an own node without a source has none (DEC-35).
  const zone = (node: number): Detail =>
    isExact(node) ? 'exact' : nextToExact(node) ? 'presence' : 'fog';

  const nodes: NodeView[] = map.nodes.map((n) => {
    const capacity = DEV_CAPACITY[n.kind];
    const city = n.kind !== 'province';
    const mine = owner(n.id) === 0;
    const near = zone(n.id);
    const detail: Detail = near === 'fog' && mine ? 'presence' : near;
    const ago = SEEN_NODE[n.id];
    const enemy = owner(n.id) === 1;
    const memory =
      detail === 'fog'
        ? ago === undefined
          ? null
          : seen('presence', ago, enemy ? ['attack'] : [])
        : seen(detail, 0, detail === 'presence' && (enemy || n.id === INTRUDED) ? ['attack'] : []);
    const cap = warehouseCapOf(n.kind);
    return {
      id: n.id,
      owner: owner(n.id),
      capacity,
      detail,
      // An own node and a node of a vision source carry their warehouse: a province's is 0, it
      // has none (DEC-23).
      warehouse: mine
        ? city
          ? Math.min(STOCK[n.id] ?? cap, cap)
          : 0
        : detail === 'exact'
          ? 0
          : null,
      seen: memory,
      attrition_in: null,
      grace_left: null,
      starve_in: null,
      recruit_queue: mine && city ? 0 : null,
      recruit_progress: mine && city ? 0 : null,
      recruit_waiting: mine && city ? false : null,
      has_barracks: mine && city ? n.kind === 'capital' : null,
      warehouse_cap: mine && city ? cap : null,
      building: null,
      factory: null,
      factory_period: null,
      factory_build: null,
      front_dist: null,
      flow_down: null,
      flow_next: null,
      flow_idle: null,
      flow_pocket: null,
      // The own provinces and cities with a group stand on terrain with a mark: the badges stand
      // outside the capacity ring, the helmet inside it (#940).
      terrain_mark: TERRAIN_MARKS[n.id] ?? null,
      rally_point: null,
    };
  });

  const edges: EdgeView[] = map.edges.map((e) => {
    const sight = isExact(e.a) || isExact(e.b);
    const half = (node: number): EdgeView['halves'][number] => {
      const detail = zone(node);
      return { detail, seen: detail === 'fog' ? null : seen(detail, 0) };
    };
    return {
      id: e.id,
      detail: sight ? 'presence' : 'fog',
      halves: [half(e.a), half(e.b)],
      enemy_groups: [],
      forts: [],
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
      me: {
        cp: 380,
        stance: 'balance',
        leaf_shift: null,
        leaf_shift_max: null,
        next_dispatch_tick: null,
        cp_ticks: null,
        capital_ticks: null,
      },
      vp: [6, 7],
      vp_gain: [3, 4],
      nodes,
      edges,
      groups,
      packets: [],
      intents: [],
      fights: [],
    },
  };
}
