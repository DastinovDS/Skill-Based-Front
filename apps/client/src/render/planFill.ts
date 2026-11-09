/**
 * The fill of a gathering plan, Eased steps (#851, ui-style 53e, 54e; mockup `planShown` 1/E1): a
 * tween between two values the server sent (`OrderView.bonus`), never a guess ahead of them. Each
 * new bonus eases in over `RIBBON_ENGRAVED.stepMs`, starting `stepDelayMs` after the snapshot that
 * reported it (the charge flies in from the warehouse meanwhile); a step that comes while one runs
 * starts from where the fill is. A smaller value (a plan restarted) and "less motion" jump.
 */
import { easeTravel } from '../theme/tokens.ts';
import { RIBBON_ENGRAVED } from './style.ts';

export interface PlanFill {
  /** The bonus shown when the tween began, and the server's bonus it eases to. */
  readonly from: number;
  readonly to: number;
  /** Seconds (the render clock) the easing starts. */
  readonly start: number;
}

/** The bonus shown at `now` (seconds), in bonus units between `from` and `to`. */
export function planShown(fill: PlanFill, now: number): number {
  const p = (now - fill.start) / (RIBBON_ENGRAVED.stepMs / 1000);
  if (p <= 0) return fill.from;
  if (p >= 1) return fill.to;
  return fill.from + (fill.to - fill.from) * easeTravel(p);
}

/**
 * The fill after the server reports `value` at `now`: unchanged for the same value, a new tween
 * from what is shown for a higher one, a jump for a lower one or under `reduced` motion. `gained`:
 * how many charges this report added (each one flies from the warehouse).
 */
export function planStep(
  previous: PlanFill | null,
  value: number,
  now: number,
  reduced: boolean,
): { fill: PlanFill; gained: number } {
  if (previous === null) return { fill: { from: value, to: value, start: now }, gained: 0 };
  if (value === previous.to) return { fill: previous, gained: 0 };
  if (value < previous.to || reduced) {
    return {
      fill: { from: value, to: value, start: now },
      gained: Math.max(0, value - previous.to),
    };
  }
  return {
    fill: {
      from: planShown(previous, now),
      to: value,
      start: now + RIBBON_ENGRAVED.stepDelayMs / 1000,
    },
    gained: value - previous.to,
  };
}
