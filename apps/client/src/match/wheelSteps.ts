/**
 * Turns wheel events into whole steps of a counter (the planned order bonus under Shift, #793):
 * one notch of a mouse wheel is one step, the many small deltas of a trackpad swipe add up to a
 * step per `WHEEL_STEP_PX` of travel, so a swipe does not jump to the end of the range.
 *
 * Browsers and devices differ in what a notch is: some report it in pixels (100 or more, or only
 * a few with the system's wheel acceleration), some in lines (`deltaMode` 1). The real devices
 * were not measured (#793: Playwright's synthetic events pass through as sent), so a notch is
 * recognised three ways: an event in lines or pages, an event of at least
 * `WHEEL_STEP_PX`, or the first event after a pause of `WHEEL_GESTURE_GAP_MS` (a trackpad sends its
 * events a frame apart, a hand turning a wheel notch by notch pauses between them).
 *
 * Shift + wheel often arrives as a horizontal scroll (`deltaX`, macOS turns it so before the
 * browser sees it): the axis with the larger delta counts.
 */

import type { WheelInput } from '../render/interaction.ts';

/** Pixels of a smooth scroll per step. */
export const WHEEL_STEP_PX = 100;
/** A wheel event after a pause this long (ms) starts a new gesture: it steps at once. */
export const WHEEL_GESTURE_GAP_MS = 150;

const DOM_DELTA_PIXEL = 0;

/** The delta of the axis that moved more; a vertical tie wins. */
function dominantDelta(input: WheelInput): number {
  return Math.abs(input.deltaX) > Math.abs(input.deltaY) ? input.deltaX : input.deltaY;
}

export class WheelSteps {
  /** Pixels gathered toward the next step, signed like the delta. */
  #gathered = 0;
  /** When the last event came (ms); `null`: none yet. */
  #lastAt: number | null = null;

  /**
   * The step of one event: +1 (the wheel turned up or left: a bigger value), -1 (down or right)
   * or 0 (gathered, not a step yet). Never more than one step for one event.
   */
  push(input: WheelInput, now: number): -1 | 0 | 1 {
    const delta = dominantDelta(input);
    const pause = this.#lastAt === null || now - this.#lastAt >= WHEEL_GESTURE_GAP_MS;
    this.#lastAt = now;
    if (delta === 0) return 0;
    // A turn the other way drops what was gathered.
    if (Math.sign(delta) !== Math.sign(this.#gathered)) this.#gathered = 0;
    this.#gathered += delta;
    const notch =
      input.deltaMode !== DOM_DELTA_PIXEL || pause || Math.abs(this.#gathered) >= WHEEL_STEP_PX;
    if (!notch) return 0;
    this.#gathered = 0;
    return delta < 0 ? 1 : -1;
  }

  /** Forgets the gathered pixels (Shift went up: the next gesture starts afresh). */
  reset(): void {
    this.#gathered = 0;
    this.#lastAt = null;
  }
}
