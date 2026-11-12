/**
 * What the supply flow looks like on the normal map (DEC-43, item E; `docs/design/ui-style.md`,
 * section 42), as plain data from one snapshot. Pure functions, no PixiJS. The «Supply» layer and
 * the leaf shift were removed (DEC-50, #928); only the starving marks stay.
 *
 * The client computes no part of the dispatch rule (`AGENTS.md`, 7.1): every number here is a field
 * the server sends for the own nodes (`front_dist`, `me.leaf_shift`) or an own packet. What this
 * module does is only picking which nodes are starving: a display class of ui-style 42, not a rule
 * of the simulation; "on the level" is the protocol's own definition (`NodeView.front_dist`: the
 * level is `front_dist == View.me.leaf_shift`), so nothing here copies DEC-43 (ARC-C03).
 */
import type { PlayerId, View } from '../protocol.gen.ts';

/** The view carries the fields of the supply flow (`me.leaf_shift` is set, DEC-43). */
export function flowOn(view: View): boolean {
  return typeof view.me.leaf_shift === 'number';
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
