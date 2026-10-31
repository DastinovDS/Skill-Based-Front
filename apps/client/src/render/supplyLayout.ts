/**
 * What the «Supply» map layer draws (DEC-28, item 8), as plain data from one snapshot. Pure
 * functions, no PixiJS; the client computes nothing about supply: it reads the own packets (their
 * `path` is the server's), the own warehouses, the front markers and the starvation timers the
 * view carries. The enemy shows only as territory (the map view) and as presence here (DEC-04,
 * DEC-17): no warehouse, no packet, no marker of the opponent is in a view at all, and this layer
 * does not look for them.
 */
import type { MapFile, PlayerId, View } from '../protocol.gen.ts';
import type { Point } from './camera.ts';

/**
 * Charges moving along one road in one direction: the sum over the own packets whose remaining
 * route (the road they are on, then the server's `path`) uses it. Flows to one city may come by
 * different roads (the automatics goes round a busy road); each road has an arrow of its own.
 */
export interface SupplyFlow {
  readonly edge: number;
  readonly from: number;
  readonly to: number;
  readonly charges: number;
  /** A one-off transfer (DEC-18, item 6), drawn dashed; the automatics is solid. */
  readonly transfer: boolean;
  /**
   * Economy v2 (DEC-41, item 3): a leg of the own supply lines drawn by the player, not packets;
   * `charges` is then the number of lines that use the leg.
   */
  readonly line?: boolean;
}

/** The warehouse of an own city: charges held and the capacity of the warehouse. */
export interface SupplyStock {
  readonly node: number;
  readonly stock: number;
  readonly cap: number;
}

/** A front marker (`marker` 0 or 1) standing in an own city. */
export interface SupplyMarker {
  readonly marker: number;
  readonly node: number;
}

/** An own city cut off from the capital: ticks until its garrison next starves (DEC-19). */
export interface SupplyCut {
  readonly node: number;
  readonly ticks: number;
}

/** Where the enemy is known to be present now (no numbers: the view gives none here). */
export type SupplyPresence =
  { readonly kind: 'node'; readonly id: number } | { readonly kind: 'edge'; readonly id: number };

/** An own road with both ends in own cities: the supply runs there, drawn as a pipe of its level (#429). */
export interface SupplyPipe {
  readonly edge: number;
  readonly a: number;
  readonly b: number;
  /** The road level 1..3 (the wire `width`, DEC-22); the bore of the pipe. */
  readonly level: number;
}

/** A road between an own city and a place that is not own: supply stops at its border point. */
export interface SupplyBulkhead {
  readonly edge: number;
  readonly a: number;
  readonly b: number;
}

export interface SupplyScene {
  readonly pipes: readonly SupplyPipe[];
  readonly bulkheads: readonly SupplyBulkhead[];
  /** The level of every road the view knows, by road id (a flow on a road without a pipe uses it). */
  readonly levels: ReadonlyMap<number, number>;
  readonly flows: readonly SupplyFlow[];
  readonly stocks: readonly SupplyStock[];
  readonly markers: readonly SupplyMarker[];
  readonly cut: readonly SupplyCut[];
  readonly presence: readonly SupplyPresence[];
  /** Economy v2: the own factories (DEC-41, item 2), marked on the layer since the city marks hide. */
  readonly factories: readonly number[];
}

/** `edge id` of the road between two nodes, by the ends of the map's edges. */
export type EdgeIndex = ReadonlyMap<string, number>;

const pairKey = (a: number, b: number): string =>
  `${String(Math.min(a, b))}:${String(Math.max(a, b))}`;

export function edgeIndex(map: MapFile): EdgeIndex {
  const index = new Map<string, number>();
  for (const edge of map.edges) index.set(pairKey(edge.a, edge.b), edge.id);
  return index;
}

/** Own packets as flows: charges per road and direction, in a stable order (road, from, transfer). */
export function supplyFlows(view: View, index: EdgeIndex): SupplyFlow[] {
  const sums = new Map<string, SupplyFlow>();
  for (const packet of view.packets) {
    const nodes = [packet.from_node, ...packet.path];
    for (let i = 1; i < nodes.length; i++) {
      const from = nodes[i - 1];
      const to = nodes[i];
      if (from === undefined || to === undefined) continue;
      // The first leg is the road the packet is on now; the rest are the server's route.
      const edge = i === 1 ? packet.edge : index.get(pairKey(from, to));
      if (edge === undefined) continue;
      const key = `${String(edge)}:${String(from)}:${packet.transfer ? 't' : 'a'}`;
      const prev = sums.get(key);
      sums.set(key, {
        edge,
        from,
        to,
        charges: (prev?.charges ?? 0) + packet.charges,
        transfer: packet.transfer,
      });
    }
  }
  return [...sums.values()].sort(
    (a, b) =>
      a.edge - b.edge || a.from - b.from || Number(a.transfer) - Number(b.transfer) || a.to - b.to,
  );
}

/**
 * Economy v2 (DEC-41, item 3): the own supply lines as flows, one per road and direction they use,
 * `charges` the number of lines on it (lines never merge, but they share a road). The path is the
 * server's (`LineView.path`: the drawn one, or the reroute after a break).
 */
export function lineFlows(view: View, index: EdgeIndex): SupplyFlow[] {
  const sums = new Map<string, SupplyFlow>();
  for (const line of view.lines) {
    for (let i = 1; i < line.path.length; i++) {
      const from = line.path[i - 1];
      const to = line.path[i];
      if (from === undefined || to === undefined) continue;
      const edge = index.get(pairKey(from, to));
      if (edge === undefined) continue;
      const key = `${String(edge)}:${String(from)}`;
      const prev = sums.get(key);
      sums.set(key, {
        edge,
        from,
        to,
        charges: (prev?.charges ?? 0) + 1,
        transfer: false,
        line: true,
      });
    }
  }
  return [...sums.values()].sort((a, b) => a.edge - b.edge || a.from - b.from);
}

const clampLevel = (width: number): number => Math.min(3, Math.max(1, Math.round(width)));

/**
 * Everything the layer shows of the snapshot `view` for the player `me`. `edges`: the ends of the
 * roads of the map by road id (the view has the level of a road, not its ends).
 */
export function supplyScene(
  view: View,
  me: PlayerId,
  index: EdgeIndex,
  edges: readonly { readonly a: number; readonly b: number }[] = [],
): SupplyScene {
  const stocks: SupplyStock[] = [];
  const cut: SupplyCut[] = [];
  const presence: SupplyPresence[] = [];
  for (const node of view.nodes) {
    if (node.owner === me) {
      // Only an own city has a warehouse to show: `warehouse_cap` is null for a province (no
      // warehouse) and for every node that is not own.
      if (node.warehouse !== null && node.warehouse_cap !== null) {
        stocks.push({ node: node.id, stock: node.warehouse, cap: node.warehouse_cap });
      }
      if (node.starve_in !== null) cut.push({ node: node.id, ticks: node.starve_in });
    }
    // Presence is told for a place seen now; a fogged place keeps an older sighting (a ghost of
    // the normal map), which this layer does not draw.
    if (node.detail !== 'fog' && node.seen !== null && node.seen.enemy_modes.length > 0) {
      presence.push({ kind: 'node', id: node.id });
    }
  }
  for (const edge of view.edges) {
    const seen = edge.halves.some(
      (half) => half.detail !== 'fog' && half.seen !== null && half.seen.enemy_modes.length > 0,
    );
    if (seen || edge.enemy_groups.length > 0) {
      presence.push({ kind: 'edge', id: edge.id });
    }
  }
  const levels = new Map<number, number>();
  const pipes: SupplyPipe[] = [];
  const bulkheads: SupplyBulkhead[] = [];
  for (const edge of view.edges) {
    const level = clampLevel(edge.width);
    levels.set(edge.id, level);
    const ends = edges[edge.id];
    if (ends === undefined) continue;
    const a = view.nodes[ends.a]?.owner;
    const b = view.nodes[ends.b]?.owner;
    if (a === me && b === me) pipes.push({ edge: edge.id, a: ends.a, b: ends.b, level });
    else if (a === me || b === me) bulkheads.push({ edge: edge.id, a: ends.a, b: ends.b });
  }
  const factories = view.nodes
    .filter((node) => node.owner === me && node.factory === true)
    .map((node) => node.id);
  const markers: SupplyMarker[] = [];
  view.me.fronts.forEach((node, marker) => {
    if (node !== null) markers.push({ marker, node });
  });
  return {
    pipes,
    bulkheads,
    levels,
    // Economy v2: the lines the player drew are the flows; the packets on them glide as dots.
    flows: view.lines.length > 0 ? lineFlows(view, index) : supplyFlows(view, index),
    stocks,
    markers,
    cut,
    presence,
    factories,
  };
}

// --- Lanes ------------------------------------------------------------------------------

/** The point of a road at `at` (0..1) of the way `from` to `to`, moved sideways by `lane`. */
export function lanePoint(from: Point, to: Point, at: number, lane: number): Point {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const x = from.x + (to.x - from.x) * at;
  const y = from.y + (to.y - from.y) * at;
  if (length === 0) return { x, y };
  // Right-hand normal of (dx, dy) in a y-down plane is (-dy, dx): flows of opposite directions
  // get opposite lanes and do not lie on top of each other.
  return { x: x + (-(to.y - from.y) / length) * lane, y: y + ((to.x - from.x) / length) * lane };
}
