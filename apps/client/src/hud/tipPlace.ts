/**
 * Where a map tag stands (Leader, ui-style 54q): up and to the right of the point the pointer rests
 * on, tied to it by a ruled leader from the tag's foot. It turns to the left or below near the edge
 * of the window and never leaves it. Pure, so it is tested without a DOM.
 */

export interface TipSpot {
  /** The tag's top left corner, window px. */
  readonly left: number;
  readonly top: number;
  /** Where the leader leaves the tag, in the tag's own px. */
  readonly foot: { readonly x: number; readonly y: number };
}

/** How far the tag stands off the object, and how far in from its corner the leader leaves it. */
export const TIP = { dx: 18, dy: 22, inset: 14, margin: 4 } as const;

/** A circle the tag keeps clear of: the helmet or the city ring under the pointer (window px). */
export interface Clear {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

/**
 * The tag's nearest corner starts at the corner of the circle's bounding square (plus the offsets),
 * so the tag clears the circle and the marks round its rim (the VP lozenge, the brackets).
 */
const CLEAR_SHARE = 1;

export function tipPlacement(
  point: { readonly x: number; readonly y: number },
  size: { readonly width: number; readonly height: number },
  view: { readonly width: number; readonly height: number },
  clear: Clear | null = null,
): TipSpot {
  // Which way the tag turns is decided from the pointer; with a circle to keep clear of, the tag's
  // corner starts at the circle's diagonal on that side instead of at the pointer.
  const right = point.x + TIP.dx + size.width <= view.width - TIP.margin;
  const above = point.y - TIP.dy - size.height >= TIP.margin;
  const at =
    clear === null
      ? point
      : {
          x: clear.x + (right ? 1 : -1) * clear.r * CLEAR_SHARE,
          y: clear.y + (above ? -1 : 1) * clear.r * CLEAR_SHARE,
        };
  const left = right ? at.x + TIP.dx : at.x - TIP.dx - size.width;
  const top = above ? at.y - TIP.dy - size.height : at.y + TIP.dy;
  const clampedLeft = Math.max(TIP.margin, Math.min(left, view.width - TIP.margin - size.width));
  const clampedTop = Math.max(TIP.margin, Math.min(top, view.height - TIP.margin - size.height));
  const inset = Math.min(TIP.inset, size.width / 2);
  return {
    left: clampedLeft,
    top: clampedTop,
    foot: { x: right ? inset : size.width - inset, y: above ? size.height : 0 },
  };
}
