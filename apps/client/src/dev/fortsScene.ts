/**
 * The `forts` scenes of the dev screen (DEC-43, item D; #707): the artery moment under the flow
 * rules (`DEV_RULES_FLOW`) with road fortifications in every state the map shows: an own line
 * built (road 4-5, the border with Archway) with the enemy's line on the other side of the same
 * border (seen), an own line being built (55%, road 12-7), an own line with a neutral city across
 * (road 10-11), an enemy line being built (known to exist, no progress; road 5-15), and a toll in the
 * air: an own group paying at the enemy line (road 4-5) and an own line collecting from an enemy
 * group (road 7-8). Made here from the flow scene, not a fixture of the protocol: it is a picture for
 * the eyes, the numbers only have to be plausible.
 */
import type {
  EdgeView,
  EnemyGroup,
  EventMsg,
  GroupView,
  MapFile,
  NodeView,
  RoadFort,
  SnapshotMsg,
} from '../protocol.gen.ts';
import { ARTERY_TICK } from './arteryScene.ts';
import { FLOW_VIEW, flowSnapshot } from './flowScene.ts';
import { PROVINCES_TICK, PROVINCES_VIEW, provincesSnapshot } from './provincesScene.ts';

export const FORTS_TICK = ARTERY_TICK;
export const FORTS_VIEW = FLOW_VIEW;

const T = FORTS_TICK;

/** `ruleset_public.fort.build_ticks` of the dev rules: the progress of the own build below. */
const BUILD_TICKS = 100;

const fort = (node: number, owner: 0 | 1, built: boolean, doneTick: number | null): RoadFort => ({
  node,
  owner,
  built,
  done_tick: doneTick,
});

/** The forts by road: the end `a` first (the sort of the server). */
const FORTS: Readonly<Record<number, readonly RoadFort[]>> = {
  // 4-5: both sides of the border at x = 580, built.
  2: [fort(4, 0, true, null), fort(5, 1, true, null)],
  // 7-8: an own line on the border with the city 8 (enemy in this scene).
  11: [fort(7, 0, true, null)],
  // 12-7: an own line being built, 55% done (an internal road).
  15: [fort(12, 0, false, T + Math.round(BUILD_TICKS * 0.45))],
  // 10-11: an own line, the city across is nobody's.
  13: [fort(10, 0, true, null)],
  // 5-15: an enemy line being built: only that it exists.
  3: [fort(5, 1, false, null)],
};

/** The own group that pays at the line of Archway, and the enemy group that pays at the line of 7. */
export const FORTS_PAYER = '00000000000f0001';

const figure = (id: string, pos: number): EnemyGroup => ({
  id,
  pos,
  toward_b: false,
  detail: 'exact',
  mode: 'attack',
  units: 5,
  charged: 3,
  units_range: null,
});

export function fortsSnapshot(map: MapFile): SnapshotMsg {
  const base = flowSnapshot(map, 0);
  const nodes: NodeView[] = base.view.nodes.map((node) =>
    // The city 8 is the enemy's here: an enemy group comes out of it towards the line of 7.
    node.id === 8 ? { ...node, owner: 1, detail: 'presence' } : node,
  );
  const edges: EdgeView[] = base.view.edges.map((edge) => {
    const forts = FORTS[edge.id];
    const withForts = forts === undefined ? edge : { ...edge, forts: [...forts] };
    // 7-8: the enemy group just past the border point, going to 7 (`toward_b` false: to the end `a`).
    return edge.id === 11
      ? { ...withForts, enemy_groups: [figure('00000000000e0001', 470)] }
      : withForts;
  });
  // The own group on the road 4-5, just past the border point: it has paid the line of Archway.
  const payer: GroupView = {
    id: FORTS_PAYER,
    units: 5,
    charged: 2,
    mode: 'attack',
    location: { kind: 'edge', edge: 2, from_node: 4, progress: 530 },
    order: {
      dest: 5,
      path: [5],
      planned: false,
      bonus: 0,
      gathering: false,
      plan: 0,
      next_charge_tick: null,
      depart_tick: null,
      group_order: null,
      arrive_tick: null,
    },
  };
  return {
    ...base,
    view: { ...base.view, nodes, edges, groups: [...base.view.groups, payer] },
  };
}

/** The tolls of the scene, `age` ticks old at the tick of the snapshot. */
export function fortsEvents(age: number): EventMsg[] {
  return [
    {
      type: 'event',
      tick: T - age,
      kind: 'toll_paid',
      data: { player: 0, group: FORTS_PAYER, node: 5, edge: 2, charges: 2 },
    },
    {
      type: 'event',
      tick: T - age,
      kind: 'toll_taken',
      data: { player: 0, node: 7, edge: 11, charges: 1 },
    },
  ];
}

/** The `forts_geo` scene: the same on the pool map `crossroads`, whose areas come from a geography (curved borders). */
export const FORTS_GEO_TICK = PROVINCES_TICK;
export const FORTS_GEO_VIEW = PROVINCES_VIEW;

const GEO_FORTS: Readonly<Record<number, readonly RoadFort[]>> = {
  // 6-10: the border with the enemy: both sides, built.
  14: [fort(6, 0, true, null), fort(10, 1, true, null)],
  // 7-11: an own city against a neutral province, built.
  16: [fort(7, 0, true, null)],
  // 7-12 and 7-11: the second line of the city 7 on a neighbouring road (they share a stretch of border).
  17: [fort(7, 0, false, PROVINCES_TICK + 45)],
  // 1-6: an own line on an internal road.
  6: [fort(6, 0, true, null)],
};

export function fortsGeoSnapshot(map: MapFile): SnapshotMsg {
  const base = provincesSnapshot(map);
  const edges: EdgeView[] = base.view.edges.map((edge) => {
    const forts = GEO_FORTS[edge.id];
    return forts === undefined ? edge : { ...edge, forts: [...forts] };
  });
  return { ...base, view: { ...base.view, edges } };
}
