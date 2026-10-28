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

/** Air between the label at the `end` of a path and the rim it stops at. */
const END_AIR = 3;

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
 * Where on the path the label stands: `middle` of the stretch between the rims (a path that is one
 * known road), or `end`: the last piece before the destination's rim, for a path the client does
 * not know (the server answers only the total time), so the label stays off the cities between.
 */
export type EtaWhere = 'middle' | 'end';

/**
 * The centre of the label for `path` (the nodes of the order, ends included): the middle of the
 * part between `trim.start` and `trim.end` from the ends (the city rims; the whole path when it is
 * shorter than both), pushed off the road to the upper side of the screen (to the right on a
 * vertical road; `where` says which part of the stretch) by `gap` plus the half of the box along that side, so the box clears the road
 * and never covers it. `null`: a path with no length.
 */
export function etaSpot(
  path: readonly Point[],
  trim: { readonly start: number; readonly end: number },
  box: LabelBox,
  gap: number,
  where: EtaWhere = 'middle',
): Point | null {
  const length = pathLength(path);
  if (length <= 0) return null;
  const from = trim.start + trim.end < length ? trim.start : 0;
  const to = trim.start + trim.end < length ? length - trim.end : length;
  let found = along(path, (from + to) / 2);
  if (found !== null && where === 'end') {
    // The box ends at the rim: its half along the road, as the road runs, and a little air.
    const extent = Math.abs(found.dx) * box.width + Math.abs(found.dy) * box.height;
    found = along(path, Math.max(from, to - extent / 2 - END_AIR));
  }
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
