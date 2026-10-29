/**
 * The `supply` scene of the dev screen (#429): the `artery` moment for the «Supply» view (Tab),
 * with what the pipes need to be seen: roads of all three levels, a flow in both directions of one
 * road, an automatic flow and a transfer on one road, a flow that goes on over two roads, both
 * front markers, a city cut off from the capital, and warehouses full, half full and empty. Made
 * here from the artery scene, not a fixture of the protocol: it is a picture for the eyes, the
 * numbers only have to be plausible.
 */
import type { EdgeView, MapFile, NodeView, PacketView, SnapshotMsg } from '../protocol.gen.ts';
import { ARTERY_TICK, arterySnapshot } from './arteryScene.ts';

export const SUPPLY_TICK = ARTERY_TICK;

/** Road levels over those of the artery scene, so that all three are seen on the own roads. */
const LEVEL: Readonly<Record<number, number>> = { 0: 2, 4: 3, 5: 2, 8: 1, 9: 3 };
/** The own city cut off from the capital (DEC-19): ticks to the next starvation. */
const CUT: Readonly<Record<number, number>> = { 13: 73 };
/** Warehouse stock over the artery scene: a city full, one empty. */
const STOCK: Readonly<Record<number, number>> = { 1: 0, 13: 1 };

const id = (n: number) => n.toString(16).padStart(16, '0');

export function supplySnapshot(map: MapFile): SnapshotMsg {
  const base = arterySnapshot(map);
  const nodes: NodeView[] = base.view.nodes.map((node) => {
    const cut = CUT[node.id];
    const stock = STOCK[node.id];
    return {
      ...node,
      starve_in: cut ?? node.starve_in,
      warehouse:
        stock === undefined || node.warehouse === null || node.warehouse_cap === null
          ? node.warehouse
          : Math.min(stock, node.warehouse_cap),
    };
  });
  const edges: EdgeView[] = base.view.edges.map((edge) => {
    const level = LEVEL[edge.id];
    return level === undefined ? edge : { ...edge, width: level };
  });
  const packet = (
    edge: number,
    from: number,
    path: [number, ...number[]],
    charges: number,
    progress: number,
    transfer: boolean,
  ): PacketView => {
    const ticks = map.edges[edge]?.travel_ticks ?? 50;
    const depart = SUPPLY_TICK - Math.round(progress * ticks);
    return {
      id: id(500 + edge * 10 + charges),
      edge,
      from_node: from,
      charges,
      depart_tick: depart,
      arrive_tick: depart + ticks,
      path,
      dest_tick: depart + ticks * path.length,
      transfer,
    };
  };
  const packets: PacketView[] = [
    // The road 3-4: an automatic flow and a transfer one way, an automatic flow the other way.
    packet(1, 3, [4], 2, 0.64, false),
    packet(1, 3, [4], 3, 0.77, true),
    packet(1, 4, [3], 1, 0.3, false),
    // The capital to the cities 3 and 4: one flow over two roads.
    packet(0, 0, [3, 4], 4, 0.4, false),
    // The capital to Firwood and on to Wood Hollow; a transfer to Featherdale.
    packet(4, 0, [1, 6], 2, 0.55, false),
    packet(5, 0, [2], 5, 0.35, true),
    // Forkway to Watchhouse (Ford, cut off, gets nothing).
    packet(14, 4, [12], 1, 0.5, false),
  ];
  return {
    ...base,
    view: {
      ...base.view,
      me: { ...base.view.me, fronts: [3, 1] },
      nodes,
      edges,
      packets,
    },
  };
}
