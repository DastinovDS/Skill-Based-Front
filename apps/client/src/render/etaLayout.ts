/**
 * Where the travel-time label of a move order sits (#432): on the order path, above the road, in
 * the middle of the stretch between the two city rims. Pure geometry, no PixiJS and no DOM. The
 * time itself is the server's (`ack` / `reach`, AGENTS.md 7.1); this only places it.
 */
import type { Point } from './camera.ts';

/** The label box, in the units of the map (after the screen-size scale). */
export interface LabelBox {
  readonly width: number;
  readonly height: number;
}

/** The point at arc length `at` of the polyline and the unit direction of the segment it is on. */
function along(
  path: readonly Point[],
  at: number,
): { point: Point; dx: number; dy: number } | null {
  let left = at;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (a === undefined || b === undefined) continue;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) continue;
    if (left <= length || i === path.length - 1) {
      const t = Math.min(1, Math.max(0, left / length));
      return {
        point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
        dx: (b.x - a.x) / length,
        dy: (b.y - a.y) / length,
      };
    }
    left -= length;
  }
  return null;
}

/** Length of the polyline. */
export function pathLength(path: readonly Point[]): number {
  let sum = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (a !== undefined && b !== undefined) sum += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return sum;
}

/**
 * The centre of the label for `path` (the nodes of the order, ends included): the middle of the
 * part between `trim.start` and `trim.end` from the ends (the city rims; the whole path when it is
 * shorter than both), pushed off the road to the upper side of the screen (to the right on a
 * vertical road) by `gap` plus the half of the box along that side, so the box clears the road
 * and never covers it. `null`: a path with no length.
 *
 * `rims` (the radius of each node of `path`, the cities in between matter): a middle that falls
 * on a city in between, or so near it that the box would cover it, slides along the path to the
 * first place the box clears that city by, on the side where the stretch is longer.
 */
export function etaSpot(
  path: readonly Point[],
  trim: { readonly start: number; readonly end: number },
  box: LabelBox,
  gap: number,
  rims: readonly number[] = [],
): Point | null {
  const length = pathLength(path);
  if (length <= 0) return null;
  const from = trim.start + trim.end < length ? trim.start : 0;
  const to = trim.start + trim.end < length ? length - trim.end : length;
  let at = (from + to) / 2;
  let arc = 0;
  for (let i = 1; i < path.length - 1; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (a === undefined || b === undefined) continue;
    arc += Math.hypot(b.x - a.x, b.y - a.y);
    const rim = rims[i];
    if (rim === undefined) continue;
    const clear = rim + box.width / 2;
    if (Math.abs(at - arc) < clear) {
      at = to - arc >= arc - from ? arc + clear : arc - clear;
      at = Math.min(to, Math.max(from, at));
    }
  }
  const found = along(path, at);
  if (found === null) return null;
  // The normal of the road that points up the screen (y grows downward), else to the right.
  let nx = -found.dy;
  let ny = found.dx;
  if (ny > 1e-9 || (Math.abs(ny) <= 1e-9 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  const lift = gap + (Math.abs(nx) * box.width) / 2 + (Math.abs(ny) * box.height) / 2;
  return { x: found.point.x + nx * lift, y: found.point.y + ny * lift };
}
