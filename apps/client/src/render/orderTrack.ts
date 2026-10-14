/**
 * The arrow of an ordinary order (UI round 2): drawn from where the order began to its target and
 * kept in place while the group walks along it; the part already walked fades. The client never
 * finds a route: the chain of nodes is the server's `order.path` (the nodes still ahead) put
 * behind the place the order was first seen at. Pure functions, no PixiJS.
 */
import type { Point } from './camera.ts';

export interface TrackedOrder {
  /** The nodes of the arrow from where the order began to its target. */
  readonly chain: number[];
  /** The arrow's segment the group is on: from `chain[segment]` to `chain[segment + 1]`. */
  readonly segment: number;
}

/**
 * The chain of nodes of an order from where it began to its target. `previous` is the chain kept
 * from earlier frames: while `remaining` (the server's nodes ahead, shrinking as the group walks)
 * is the tail of it the chain stays as it was; otherwise (a new order, a changed path, a reversal)
 * it starts again at `start`, the node the group stands in or has just left.
 */
export function trackOrder(
  previous: readonly number[] | null,
  remaining: readonly number[],
  start: number,
): TrackedOrder {
  const ahead = remaining[0] === start ? remaining.slice(1) : [...remaining];
  if (previous !== null && ahead.length > 0 && previous.length > ahead.length) {
    const offset = previous.length - ahead.length;
    if (ahead.every((node, i) => previous[offset + i] === node)) {
      return { chain: [...previous], segment: offset - 1 };
    }
  }
  return { chain: [start, ...ahead], segment: 0 };
}

/** How far along the segment `a`-`b` the point `p` projects, 0..1. */
export function projectOnSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  if (length2 === 0) return 0;
  return Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
}

export interface SplitOrder {
  /** The walked part of the segment the group is on (the earlier segments are gone), may be empty. */
  readonly walked: Point[];
  /** From the group to the target. */
  readonly ahead: Point[];
}

/**
 * Splits the arrow `points` (the chain's places) at the group `at`: the group is on the segment
 * `segment` (the one from `points[segment]`), the nodes before it are passed.
 */
export function splitOrder(points: readonly Point[], segment: number, at: Point): SplitOrder {
  const last = points.length - 2;
  const k = Math.max(0, Math.min(last, segment));
  const a = points[k];
  const b = points[k + 1];
  if (a === undefined || b === undefined) return { walked: [], ahead: [...points] };
  const t = projectOnSegment(at, a, b);
  const cut = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  return { walked: t > 0 ? [a, cut] : [], ahead: [cut, ...points.slice(k + 1)] };
}
