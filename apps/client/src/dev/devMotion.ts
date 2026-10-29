/**
 * Scripted motion for the live dev scene (`/?motion`, #508): the plain demo has groups that stand
 * still, so smooth motion could not be looked at. This makes one group march along a road and back
 * (it merges into the city's icon when it parks there and splits out when it leaves), and cycles the
 * charge of the groups in cities from full to empty and back, one unit at a time. Dev only: a stand-in
 * for what a server sends, not a rule.
 */
import type { GroupView, MapFile, NodeView } from '../protocol.gen.ts';

/** Ticks per step of the charge cycle: one charge less or more. */
export const CHARGE_STEP_TICKS = 25;
/** A whole march: wait, out, wait, back (ticks). */
const MARCH = { wait: 40, leg: 150 } as const;
export const MARCH_CYCLE = 2 * (MARCH.wait + MARCH.leg);
const MARCHER_UNITS = 5;

/** Charged units of a group of `units` at `tick`: `units` down to 0 and back, a step every `CHARGE_STEP_TICKS`. */
export function cycleCharge(units: number, tick: number, offset: number): number {
  if (units < 2) return units;
  const index = Math.floor(
    ((tick + offset * CHARGE_STEP_TICKS) % (2 * units * CHARGE_STEP_TICKS)) / CHARGE_STEP_TICKS,
  );
  return index <= units ? units - index : index - units;
}

/** The first road with an own city at both ends, or `null`. */
function ownRoad(
  map: MapFile,
  nodes: readonly NodeView[],
): { id: number; a: number; b: number } | null {
  const own = (id: number): boolean => {
    const node = nodes[id];
    return node?.owner === 0 && node.detail === 'exact';
  };
  const edge = map.edges.find((e) => own(e.a) && own(e.b));
  return edge === undefined ? null : { id: edge.id, a: edge.a, b: edge.b };
}

/** Where the marching group is at `tick`: parked at a city, or on the road (progress in thousandths). */
export function marchLocation(
  road: { id: number; a: number; b: number },
  tick: number,
): GroupView['location'] {
  const t = tick % MARCH_CYCLE;
  const half = MARCH.wait + MARCH.leg;
  const [from, to] = t < half ? [road.a, road.b] : [road.b, road.a];
  const local = t % half;
  if (local < MARCH.wait) return { kind: 'node', node: from };
  const progress = Math.round(((local - MARCH.wait) / MARCH.leg) * 1000);
  if (progress >= 1000) return { kind: 'node', node: to };
  return { kind: 'edge', edge: road.id, from_node: from, progress };
}

/** The groups of a dev snapshot with the scripted motion applied. */
export function devMotion(
  map: MapFile,
  nodes: readonly NodeView[],
  groups: readonly GroupView[],
  tick: number,
): GroupView[] {
  const cycled = groups.map((g, i) => ({ ...g, charged: cycleCharge(g.units, tick, i * 2) }));
  const road = ownRoad(map, nodes);
  if (road === null) return cycled;
  const location = marchLocation(road, tick);
  const march: GroupView = {
    id: 'dev-march',
    units: MARCHER_UNITS,
    charged: MARCHER_UNITS - 1,
    mode: 'attack',
    location,
    order: null,
    defense_bonus: null,
    defense_cap: null,
  };
  return [...cycled, march];
}
