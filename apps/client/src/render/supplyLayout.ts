/**
 * What the «Supply» map mode draws (DEC-18, item 7), as plain data from one snapshot: the routes
 * of the own packets (the priority marks are gone with DEC-28; the front markers: #293). Pure
 * functions, no PixiJS; the client computes nothing about supply, it only reads the server's
 * `path`.
 */
import type { View } from '../protocol.gen.ts';

/** An own packet on its way: the nodes from where it left its current road to the destination. */
export interface SupplyRoute {
  readonly id: string;
  readonly nodes: readonly number[];
  readonly transfer: boolean;
  readonly charges: number;
}

/** Own packets as routes: `from_node` of the current road, then the server's `path`. */
export function supplyRoutes(view: View): SupplyRoute[] {
  return view.packets.map((p) => ({
    id: p.id,
    nodes: [p.from_node, ...p.path],
    transfer: p.transfer,
    charges: p.charges,
  }));
}
