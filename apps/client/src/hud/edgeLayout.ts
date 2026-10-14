/**
 * Geometry of the arcs at the edge of the screen (UI round 2, like the hit marker of a shooter):
 * which way a city outside the camera view lies and the path of the arc that points there. Pure
 * functions; `EdgeAlerts.svelte` draws them.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** The part of the screen the map is visible in (client px). */
export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Angular width of an arc, degrees. */
export const ARC_SPAN = 34;

/** A city this close to the edge (or beyond) still counts as in view when its centre is inside. */
export const IN_VIEW_MARGIN = 6;

export function centreOf(view: Rect): Point {
  return { x: (view.left + view.right) / 2, y: (view.top + view.bottom) / 2 };
}

/** Radius of the ring the arcs sit on: nearly all the way from the middle to the nearest edge. */
export function arcRadius(view: Rect): number {
  return Math.max(40, Math.min(view.right - view.left, view.bottom - view.top) * 0.46);
}

/**
 * The direction (screen radians, y down) from the middle of `view` to `point`, or `null` while the
 * point is in view (inside the rectangle, shrunk by `IN_VIEW_MARGIN`).
 */
export function offscreenAngle(view: Rect, point: Point): number | null {
  const inside =
    point.x >= view.left + IN_VIEW_MARGIN &&
    point.x <= view.right - IN_VIEW_MARGIN &&
    point.y >= view.top + IN_VIEW_MARGIN &&
    point.y <= view.bottom - IN_VIEW_MARGIN;
  if (inside) return null;
  const middle = centreOf(view);
  return Math.atan2(point.y - middle.y, point.x - middle.x);
}

/** SVG path of the arc on the ring of `radius` around `middle`, centred on `angle`. */
export function arcPath(
  middle: Point,
  radius: number,
  angle: number,
  spanDegrees = ARC_SPAN,
): string {
  const half = (spanDegrees * Math.PI) / 360;
  const at = (a: number): string =>
    `${(middle.x + radius * Math.cos(a)).toFixed(1)} ${(middle.y + radius * Math.sin(a)).toFixed(1)}`;
  return `M${at(angle - half)} A${radius.toFixed(1)} ${radius.toFixed(1)} 0 0 1 ${at(angle + half)}`;
}

/** The tip of the little arrow at the middle of the arc, pointing away from the middle. */
export function arrowPoints(middle: Point, radius: number, angle: number): string {
  const tip = {
    x: middle.x + (radius + 16) * Math.cos(angle),
    y: middle.y + (radius + 16) * Math.sin(angle),
  };
  const base = {
    x: middle.x + (radius + 3) * Math.cos(angle),
    y: middle.y + (radius + 3) * Math.sin(angle),
  };
  const nx = -Math.sin(angle);
  const ny = Math.cos(angle);
  const h = 7;
  const f = (p: Point): string => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  return [
    f(tip),
    f({ x: base.x + nx * h, y: base.y + ny * h }),
    f({ x: base.x - nx * h, y: base.y - ny * h }),
  ].join(' ');
}
