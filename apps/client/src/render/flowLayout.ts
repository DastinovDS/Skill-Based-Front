/**
 * What the supply flow looks like (DEC-43, item E; the look: `docs/design/ui-style.md`, section 42),
 * as plain data from one snapshot. Pure functions, no PixiJS.
 *
 * The client computes no part of the dispatch rule (`AGENTS.md`, 7.1): every number here is a field
 * the server sends for the own nodes (`front_dist`, `flow_down`, `flow_pocket`, `me.leaf_shift`) or
 * an own packet. What this module does is only picking: which nodes are the level, where the
 * chevrons of the «Supply» layer go, which nodes are starving.
 */
import type { MapFile, PlayerId, View } from '../protocol.gen.ts';
import type { EdgeIndex } from './supplyLayout.ts';

/** The supply is the automatic flow (`ruleset_public.supply_model = "flow"`), seen in the view. */
export function flowOn(view: View): boolean {
  return typeof view.me.leaf_shift === 'number';
}

/** A road the charges roll down: from `from` to its downhill neighbour `to`. */
export interface FlowRoad {
  readonly edge: number;
  readonly from: number;
  readonly to: number;
}

const pairKey = (a: number, b: number): string =>
  `${String(Math.min(a, b))}:${String(Math.max(a, b))}`;

/** `edge id` of the road between two nodes (the map's own index, shared with the supply layer). */
export function edgeBetween(index: EdgeIndex, a: number, b: number): number | undefined {
  return index.get(pairKey(a, b));
}

/**
 * The own nodes that make the leaf level (T1): `front_dist == leaf_shift`, the nodes a tired army
 * pulled to the level included (the server has already put them there). Empty without a flow.
 */
export function levelNodes(view: View, me: PlayerId): number[] {
  const shift = view.me.leaf_shift;
  if (shift === null) return [];
  return view.nodes
    .filter((n) => n.owner === me && n.front_dist === shift)
    .map((n) => n.id)
    .sort((a, b) => a - b);
}

/** The own nodes ahead of the level (`front_dist < leaf_shift`): they neither get nor give. */
export function aheadNodes(view: View, me: PlayerId): number[] {
  const shift = view.me.leaf_shift;
  if (shift === null) return [];
  return view.nodes
    .filter((n) => n.owner === me && n.front_dist !== null && n.front_dist < shift)
    .map((n) => n.id);
}

/** The own nodes whose component has no own factory (`flow_pocket`). */
export function pocketNodes(view: View, me: PlayerId): number[] {
  return view.nodes.filter((n) => n.owner === me && n.flow_pocket === true).map((n) => n.id);
}

/** Every downhill road of the own nodes (`flow_down`), by node then neighbour. */
export function downhillRoads(view: View, me: PlayerId, index: EdgeIndex): FlowRoad[] {
  const roads: FlowRoad[] = [];
  for (const node of view.nodes) {
    if (node.owner !== me || node.flow_down === null) continue;
    for (const to of node.flow_down) {
      const edge = edgeBetween(index, node.id, to);
      if (edge !== undefined) roads.push({ edge, from: node.id, to });
    }
  }
  return roads;
}

/** `road key` of a road in one direction, for matching the roads with the packets on them. */
export const roadKey = (edge: number, from: number): string => `${String(edge)}:${String(from)}`;

/** The roads an own packet is on now, by `roadKey` (the first leg of the packet is its road). */
export function packetRoads(view: View): Set<string> {
  const keys = new Set<string>();
  for (const packet of view.packets) keys.add(roadKey(packet.edge, packet.from_node));
  return keys;
}

/**
 * A node shown as starving (a shape, the `!` triangle, not a colour only): its warehouse is empty
 * and either an own group stands there short of a charge, or it is on the level with no own packet
 * on the way to it. A display class from the snapshot; whether and when charges come is the
 * server's.
 */
export function starvingNodes(view: View, me: PlayerId): number[] {
  const shift = view.me.leaf_shift;
  if (shift === null) return [];
  const incoming = new Set<number>();
  for (const packet of view.packets) {
    incoming.add(packet.path[0]);
  }
  const tired = new Set<number>();
  for (const group of view.groups) {
    if (group.location.kind === 'node' && group.charged < group.units) {
      tired.add(group.location.node);
    }
  }
  return view.nodes
    .filter((n) => {
      if (n.owner !== me || n.warehouse !== 0) return false;
      if (tired.has(n.id)) return true;
      return n.front_dist === shift && !incoming.has(n.id);
    })
    .map((n) => n.id);
}

/** An own node whose warehouse is full (the lid over its squares). */
export function fullNodes(view: View, me: PlayerId): number[] {
  return view.nodes
    .filter(
      (n) =>
        n.owner === me &&
        n.warehouse !== null &&
        n.warehouse_cap !== null &&
        n.warehouse_cap > 0 &&
        n.warehouse >= n.warehouse_cap,
    )
    .map((n) => n.id);
}

/**
 * Bottlenecks (the pinch mark `)(` of the mockup): the downhill road into an own province, whose
 * warehouse holds one charge and passes them on one at a time. Taken from the map (a province) and
 * the public warehouse numbers; no throughput is computed here.
 */
export function pinchRoads(
  view: View,
  me: PlayerId,
  map: MapFile,
  index: EdgeIndex,
  provinceWarehouse: number,
): number[] {
  if (provinceWarehouse !== 1) return [];
  const edges = new Set<number>();
  for (const road of downhillRoads(view, me, index)) {
    if (map.nodes[road.to]?.kind === 'province') edges.add(road.edge);
  }
  return [...edges].sort((a, b) => a - b);
}

/** `leaf_shift` as the words of the control: "front" at 0, "−n" otherwise (a real minus sign). */
export function shiftLabel(shift: number, front: string): string {
  return shift <= 0 ? front : `−${String(shift)}`;
}
