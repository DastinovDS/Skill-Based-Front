/**
 * What the «Supply» map mode draws (DEC-18, item 7), as plain data from one snapshot: the
 * priority marks of the own cities and the routes of the own packets. Pure functions, no PixiJS;
 * the client computes nothing about supply, it only reads the server's `priority` and `path`.
 */
import type { Priority, View } from '../protocol.gen.ts';
import type { Point } from './camera.ts';

export interface PriorityMark {
  readonly node: number;
  readonly priority: Priority;
}

/** An own packet on its way: the nodes from where it left its current road to the destination. */
export interface SupplyRoute {
  readonly id: string;
  readonly nodes: readonly number[];
  readonly transfer: boolean;
  readonly charges: number;
}

/** Own cities with their priority, in node order (the view gives one only for own cities). */
export function priorityMarks(view: View): PriorityMark[] {
  const marks: PriorityMark[] = [];
  for (const node of view.nodes) {
    if (node.priority !== null) marks.push({ node: node.id, priority: node.priority });
  }
  return marks;
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

/**
 * The corners of a priority sign of size `size` centred on `at` (screen y down): `high` a
 * triangle pointing up, `low` one pointing down; `normal` is a circle (no corners).
 */
export function signCorners(priority: Priority, at: Point, size: number): Point[] {
  const h = size / 2;
  switch (priority) {
    case 'high':
      return [
        { x: at.x, y: at.y - h },
        { x: at.x + h, y: at.y + h },
        { x: at.x - h, y: at.y + h },
      ];
    case 'low':
      return [
        { x: at.x - h, y: at.y - h },
        { x: at.x + h, y: at.y - h },
        { x: at.x, y: at.y + h },
      ];
    case 'normal':
      return [];
  }
}

/** Where the sign of a city sits: above and to the left of its rim, clear of its rings. */
export function signPoint(city: Point, radius: number, size: number): Point {
  const d = (radius + size / 2 + 6) * Math.SQRT1_2;
  return { x: city.x - d, y: city.y - d };
}
