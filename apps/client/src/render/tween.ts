/**
 * A displayed number that eases toward the value the server last sent (#508). Pure and
 * frame-rate independent: `step(dtMs)` advances by real time, so 30, 60 and 144 FPS show the same
 * curve. It animates what it is given and decides nothing: the client computes no rules.
 *
 * A new target mid-flight starts from the value shown now, so the display never jumps. An ease-out
 * curve starts fast, so a chain of small changes (a fight draining one charge a round) stays lively.
 */

/** Ease-out cubic: fast at the start, slow at the end. `t` in [0, 1]. */
export function easeOutCubic(t: number): number {
  const u = 1 - Math.min(1, Math.max(0, t));
  return 1 - u * u * u;
}

/** How long a displayed value takes to reach a new one, in ms (inside the 250-400 ms of #508). */
export const TWEEN_MS = 320;

export class EaseTween {
  private from: number;
  private to: number;
  private shown: number;
  private elapsed = 0;

  constructor(
    value: number,
    private readonly durationMs: number = TWEEN_MS,
  ) {
    this.from = value;
    this.to = value;
    this.shown = value;
    this.elapsed = durationMs;
  }

  /** The value to draw now. */
  get value(): number {
    return this.shown;
  }

  /** The value it is heading for. */
  get target(): number {
    return this.to;
  }

  /** Still moving: `step` has work to do. */
  get active(): boolean {
    return this.shown !== this.to;
  }

  /** Jump to `value` with no animation (a new token, "less motion"). */
  snap(value: number): void {
    this.from = value;
    this.to = value;
    this.shown = value;
    this.elapsed = this.durationMs;
  }

  /** Head for `target`, starting from what is shown now. The same target changes nothing. */
  setTarget(target: number): void {
    if (target === this.to) return;
    this.from = this.shown;
    this.to = target;
    this.elapsed = 0;
  }

  /** Advance by `dtMs` of real time; returns the value to draw. */
  step(dtMs: number): number {
    if (this.shown === this.to) return this.shown;
    this.elapsed += Math.max(0, dtMs);
    if (this.elapsed >= this.durationMs) {
      this.shown = this.to;
    } else {
      this.shown = this.from + (this.to - this.from) * easeOutCubic(this.elapsed / this.durationMs);
    }
    return this.shown;
  }
}
