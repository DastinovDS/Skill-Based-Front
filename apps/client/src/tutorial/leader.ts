/**
 * Where the hint card (Leader, `docs/design/tutorial.md`, section 8) stands: close to its target,
 * covering no place, no name, no mark, no HUD and no open menu (the walkthrough's placement: every
 * position of a 10 px grid is scored, overlap first, then the distance to the target). And where its
 * ruled leader runs: from the plate's point nearest to the target to the target's edge. Plain
 * functions, client px.
 */

/** A rectangle [x0, y0, x1, y1]. */
export type Rect = readonly [number, number, number, number];

/** A target: a circle (a place, a group, a menu item) or a box (a HUD piece). */
export type Target =
  | { readonly kind: 'circle'; readonly x: number; readonly y: number; readonly r: number }
  | {
      readonly kind: 'box';
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
    };

export function centreOf(t: Target): { x: number; y: number } {
  return t.kind === 'circle' ? { x: t.x, y: t.y } : { x: t.x + t.w / 2, y: t.y + t.h / 2 };
}

/** The area a target keeps clear of the card (its mark around it). */
export function targetRect(t: Target): Rect {
  if (t.kind === 'circle') {
    const r = t.r + 26;
    return [t.x - r, t.y - r, t.x + r, t.y + r];
  }
  return [t.x - 14, t.y - 14, t.x + t.w + 14, t.y + t.h + 14];
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? w * h : 0;
}

export interface Placement {
  readonly x: number;
  readonly y: number;
}

/**
 * The best place for a plate `w` x `h` inside `area` (the part of the screen below the top bar),
 * near `target`, away from `obstacles`.
 */
export function placeCard(
  target: Target,
  size: { readonly w: number; readonly h: number },
  area: Rect,
  obstacles: readonly Rect[],
): Placement {
  const { x: cx, y: cy } = centreOf(target);
  const [ax0, ay0, ax1, ay1] = area;
  let best: Placement = { x: ax0 + 14, y: ay0 + 10 };
  let bestScore = Number.POSITIVE_INFINITY;
  for (let y = ay0 + 10; y + size.h <= ay1 - 10; y += 10) {
    for (let x = ax0 + 14; x + size.w <= ax1 - 14; x += 10) {
      const r: Rect = [x - 6, y - 6, x + size.w + 6, y + size.h + 6];
      let ov = 0;
      for (const o of obstacles) ov += overlap(r, o);
      const nx = Math.min(x + size.w, Math.max(x, cx));
      const ny = Math.min(y + size.h, Math.max(y, cy));
      const d = Math.hypot(nx - cx, ny - cy);
      const score = ov * 4 + Math.max(0, 60 - d) * 30 + Math.max(0, d - 90) * 2;
      if (score < bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
}

/** The leader from the plate at `at` (size `size`) to the target: its two ends. */
export function leaderLine(
  target: Target,
  at: Placement,
  size: { readonly w: number; readonly h: number },
): { readonly from: Placement; readonly to: Placement } {
  const { x: cx, y: cy } = centreOf(target);
  const ex = Math.min(at.x + size.w, Math.max(at.x, cx));
  const ey = Math.min(at.y + size.h, Math.max(at.y, cy));
  let fx: number;
  let fy: number;
  if (target.kind === 'circle') {
    const a = Math.atan2(ey - cy, ex - cx);
    fx = cx + Math.cos(a) * (target.r + 16);
    fy = cy + Math.sin(a) * (target.r + 16);
  } else {
    fx = Math.min(target.x + target.w + 7, Math.max(target.x - 7, ex));
    fy = Math.min(target.y + target.h + 7, Math.max(target.y - 7, ey));
  }
  return { from: { x: ex, y: ey }, to: { x: fx, y: fy } };
}
