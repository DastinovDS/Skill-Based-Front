/**
 * The look of the cue of `X` on the map (#764). Pure functions, no PixiJS and no DOM. Nothing here
 * decides what was undone: the marks come from the server's `ack` (`match/orderController.ts`).
 */
import type { Point } from './camera.ts';
import { polylineLength } from './intentLayout.ts';
import { UNDO_CUE } from './style.ts';

export interface UndoLook {
  /** The share of the order's arrow still out, 1..0. */
  readonly arrow: number;
  /** The size of the ring against its resting size, `ringFrom`..1. */
  readonly ring: number;
  readonly alpha: number;
}

/**
 * The cue `ageMs` after the undo; `null`: over. It rolls back quickly and slows down, holds, then
 * fades. With "less motion" nothing runs: the arrow and the ring stand still and only fade.
 */
export function undoLook(ageMs: number, reduced: boolean): UndoLook | null {
  if (ageMs < 0 || ageMs >= UNDO_CUE.ms) return null;
  const t = ageMs / UNDO_CUE.ms;
  const alpha = t <= UNDO_CUE.fadeFrom ? 1 : 1 - (t - UNDO_CUE.fadeFrom) / (1 - UNDO_CUE.fadeFrom);
  if (reduced) return { arrow: 1, ring: 1, alpha };
  const run = Math.min(1, ageMs / UNDO_CUE.rollbackMs);
  const ease = run * (2 - run);
  return { arrow: 1 - ease, ring: UNDO_CUE.ringFrom + (1 - UNDO_CUE.ringFrom) * ease, alpha };
}

/** The first `share` (0..1) of the polyline `points`, by length; fewer than 2 points: nothing left. */
export function cutPolyline(points: readonly Point[], share: number): Point[] {
  let left = polylineLength(points) * Math.min(1, Math.max(0, share));
  if (left <= 0) return [];
  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p === undefined) continue;
    const before = points[i - 1];
    if (before !== undefined) {
      const step = Math.hypot(p.x - before.x, p.y - before.y);
      if (step >= left) {
        const k = step === 0 ? 0 : left / step;
        out.push({ x: before.x + (p.x - before.x) * k, y: before.y + (p.y - before.y) * k });
        return out;
      }
      left -= step;
    }
    out.push(p);
  }
  return out;
}

/** `points` with its end pulled back by `inset` along the last piece (the arrow stops at the city). */
export function insetEnd(points: readonly Point[], inset: number): Point[] {
  const last = points.at(-1);
  const before = points.at(-2);
  if (last === undefined || before === undefined) return [...points];
  const length = Math.hypot(last.x - before.x, last.y - before.y);
  const k = length <= inset ? 0 : (length - inset) / length;
  const end = { x: before.x + (last.x - before.x) * k, y: before.y + (last.y - before.y) * k };
  return [...points.slice(0, -1), end];
}

/** A full circle as a closed polyline, for dashes. */
export function circlePoints(centre: Point, radius: number): Point[] {
  const steps = Math.max(24, Math.ceil(radius));
  return Array.from({ length: steps }, (_, i) => {
    const a = (2 * Math.PI * i) / steps;
    return { x: centre.x + radius * Math.cos(a), y: centre.y + radius * Math.sin(a) };
  });
}

/** The round arrow of the sign: an arc that goes back round the top, and the head at its end. */
export function undoGlyph(
  centre: Point,
  radius: number,
): { readonly arc: Point[]; readonly head: readonly [Point, Point, Point] } {
  const from = (120 * Math.PI) / 180;
  const to = (-150 * Math.PI) / 180;
  const steps = 18;
  const at = (a: number, r: number): Point => ({
    x: centre.x + r * Math.cos(a),
    y: centre.y + r * Math.sin(a),
  });
  const arc = Array.from({ length: steps + 1 }, (_, i) =>
    at(from + ((to - from) * i) / steps, radius),
  );
  // Going round this way the tangent at `to` is (sin, -cos): the head points along it.
  const size = radius * 0.8;
  const end = at(to, radius);
  const dir = { x: Math.sin(to), y: -Math.cos(to) };
  const tip = { x: end.x + dir.x * size, y: end.y + dir.y * size };
  const side = { x: -dir.y * size * 0.75, y: dir.x * size * 0.75 };
  return {
    arc,
    head: [tip, { x: end.x + side.x, y: end.y + side.y }, { x: end.x - side.x, y: end.y - side.y }],
  };
}
