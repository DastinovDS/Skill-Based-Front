/**
 * The motion of the CP gauge "Double frame" (ui-style 54a, 55a, 57a). The bar is a tween between
 * values the server sent, never ahead of them: every change of the CP eases in on its own clock
 * (easeInOutSine), and the bar shows the server's value minus what is still to come of every
 * running change, so overlapping changes add up and nothing jumps. A spend leaves a hatched sliver
 * that sinks and fades; an income sets solid behind a burin edge. Pure: `CpGauge.svelte` keeps
 * the list and paints the result.
 */
import { DURATION, easeEngrave } from '../theme/tokens.ts';

/** One change of the CP the gauge is still easing in. Amounts are whole CP (fractions allowed). */
export interface CpChange {
  /** When it was seen, in ms (`performance.now()`). */
  readonly at: number;
  /** How much the value moved: negative for a spend, positive for an income. */
  readonly delta: number;
  /** The value after it. */
  readonly after: number;
}

/** How long a change eases in: a spend retracts the bar, an income sets it solid (ms). */
const changeMs = (change: CpChange): number =>
  change.delta < 0 ? DURATION.cpSpend : DURATION.cpIncome;

/** How long a change stays on the list: the spent sliver outlasts the retracting bar. */
const lifeMs = (change: CpChange): number =>
  change.delta < 0 ? Math.max(DURATION.cpSpend, DURATION.cpSliver) : DURATION.cpIncome;

const clamp01 = (p: number): number => Math.min(1, Math.max(0, p));

/** The changes still running at `now`, oldest first. */
export function running(changes: readonly CpChange[], now: number): CpChange[] {
  return changes.filter((change) => now - change.at < lifeMs(change));
}

/**
 * The value the bar shows at `now`: the server's `value` minus the rest of every change still
 * easing in, kept on the scale `0..cap`.
 */
export function shownValue(
  value: number,
  cap: number,
  changes: readonly CpChange[],
  now: number,
): number {
  let shown = value;
  for (const change of changes) {
    const p = clamp01((now - change.at) / changeMs(change));
    shown -= change.delta * (1 - easeEngrave(p));
  }
  return Math.min(cap, Math.max(0, shown));
}

/** A spent length dropping away under the bar: from `lo` to `hi` (CP), sunk by `drop` (0..1). */
/**
 * The end of the ruled "next quantum" part of the gauge, in CP: the value plus `next` (0..1) of
 * one quantum (`step` hundredths, `cp.per_period`: 50 under `mvp-7`), at most the scale `n`.
 */
export function quantumEnd(cp: number, n: number, next: number, step: number): number {
  return Math.min(n, cp + (Math.max(0, next) * step) / 100);
}

export interface Sliver {
  readonly lo: number;
  readonly hi: number;
  /** How far it has sunk and faded, eased: 0 just spent, 1 gone. */
  readonly drop: number;
}

export function slivers(changes: readonly CpChange[], now: number): Sliver[] {
  const out: Sliver[] = [];
  for (const change of changes) {
    if (change.delta >= 0) continue;
    const p = (now - change.at) / DURATION.cpSliver;
    if (p < 0 || p >= 1) continue;
    out.push({ lo: change.after, hi: change.after - change.delta, drop: easeEngrave(p) });
  }
  return out;
}

/** The burin edge of the newest income still setting solid: its opacity, 0 when there is none. */
export function burinEdge(changes: readonly CpChange[], now: number): number {
  for (let i = changes.length - 1; i >= 0; i--) {
    const change = changes[i];
    if (change === undefined || change.delta <= 0) continue;
    const p = (now - change.at) / DURATION.cpIncome;
    return p >= 0 && p < 1 ? 1 - easeEngrave(p) : 0;
  }
  return 0;
}

/** The earmark of one walk due on the scale (#930, W1/W2), in CP. */
export interface Earmark {
  readonly lo: number;
  readonly hi: number;
  /** Past the value: the CP now do not pay it (an empty red frame). */
  readonly short: boolean;
}

/**
 * The earmarks of the walks due (`dues`, the nearest first), each `cost` CP wide: those the CP pay
 * are the top of the shown bar, one under the other from `shown` down; those they do not lie past
 * it, one after the other. Kept on the scale `0..n`; one that would lie wholly past it is left out.
 */
export function earmarks(
  shown: number,
  n: number,
  dues: readonly { readonly short: boolean }[],
  cost: number,
): Earmark[] {
  const out: Earmark[] = [];
  let hi = shown;
  let over = shown;
  for (const due of dues) {
    let lo: number;
    let top: number;
    if (due.short) {
      lo = over;
      top = over + cost;
      over = top;
    } else {
      top = hi;
      lo = hi - cost;
      hi = lo;
    }
    const a = Math.max(0, lo);
    const b = Math.min(n, top);
    if (b > a + 1e-9) out.push({ lo: a, hi: b, short: due.short });
  }
  return out;
}

/**
 * The price of a hovered order as a bracket under the scale (ui-style 53a): over the CP it would
 * take, or, when the CP do not pay for it (`short`), from the value to the price.
 */
export function priceBracket(
  value: number,
  price: number,
): { readonly from: number; readonly to: number; readonly short: boolean } {
  const short = price > value;
  return short
    ? { from: value, to: price, short }
    : { from: Math.max(0, value - price), to: value, short };
}
