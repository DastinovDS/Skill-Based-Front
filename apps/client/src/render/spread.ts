/**
 * Tokens of one road that would sit on top of each other (two groups sent one after another that bounce
 * at the same moment, two enemy figures at the same place of a half) are moved apart sideways, so that no
 * token hides another (#547). Auto-merge (DEC-20) happens only in a city, so on a road they stay
 * separate groups: the picture must show them.
 *
 * Pure functions, no PixiJS. Only the place a token is drawn at changes; the snapshot's numbers do not.
 */
import type { Point } from './camera.ts';

/** A token to place: where it would be drawn, the unit normal it may move along, and its radius. */
export interface SpreadItem {
  readonly at: Point;
  /** The unit vector pointing away from the road, on the side of the token's lane. */
  readonly normal: Point;
  /** Half the extent of the token (and what hangs under it): two tokens closer than the sum overlap. */
  readonly radius: number;
}

/** A token moves outward in steps of this many world units, until it clears the placed ones. */
export const SPREAD_STEP = 4;

/** At most this many steps (a safety bound for a crowd). */
const MAX_STEPS = 40;

/**
 * The drawn places of `items`, in the same order. The first token stays where it is; each next one
 * moves along its normal by the fewest steps that leaves it clear of those already placed (its own
 * place if nothing overlaps). Order decides who yields: pass the frame's order, which is stable.
 */
export function spreadApart(items: readonly SpreadItem[]): Point[] {
  const placed: { at: Point; radius: number }[] = [];
  for (const item of items) {
    let at = item.at;
    for (let step = 1; step <= MAX_STEPS && overlaps(at, item.radius, placed); step++) {
      at = {
        x: item.at.x + item.normal.x * SPREAD_STEP * step,
        y: item.at.y + item.normal.y * SPREAD_STEP * step,
      };
    }
    placed.push({ at, radius: item.radius });
  }
  return placed.map((p) => p.at);
}

function overlaps(
  at: Point,
  radius: number,
  placed: readonly { at: Point; radius: number }[],
): boolean {
  return placed.some((p) => Math.hypot(p.at.x - at.x, p.at.y - at.y) < p.radius + radius);
}
