import type { Toast, ToastBody } from './toasts.ts';

/** How many toasts show at once; a new one pushes the oldest out. */
export const TOAST_LIMIT = 3;
/** How long a toast stays, ms. */
export const TOAST_MS = 6000;
/**
 * The longest a toast waits for the map to draw its tick, ms. The render clock stops short of the
 * newest tick (a paused match, the last tick before the end, a hidden tab), so the wait has a cap.
 */
export const TOAST_HOLD_MS = 600;

/**
 * The toasts on screen (ui-style 10.4): up to three, each fades after six seconds. One field,
 * replaced as a whole on a change (AGENTS.md 7.2).
 */
export class ToastState {
  /** Newest first; replaced, never mutated. */
  current = $state.raw<readonly Toast[]>([]);

  #seq = 0;
  /** Toasts of events the map has not drawn yet, oldest first. */
  #waiting: { id: number; tick: number; body: ToastBody; timer: ReturnType<typeof setTimeout> }[] =
    [];
  readonly #timers: { id: number; timer: ReturnType<typeof setTimeout> }[] = [];

  push(body: ToastBody): void {
    this.#seq += 1;
    this.#add({ id: this.#seq, ...body });
  }

  #show(id: number): void {
    const at = this.#waiting.findIndex((entry) => entry.id === id);
    const entry = this.#waiting[at];
    if (entry === undefined) return;
    this.#waiting.splice(at, 1);
    clearTimeout(entry.timer);
    this.#add({ id, ...entry.body });
  }

  #add(toast: Toast): void {
    const kept = [toast, ...this.current];
    for (const gone of kept.slice(TOAST_LIMIT)) this.#forget(gone.id);
    this.current = kept.slice(0, TOAST_LIMIT);
    this.#timers.push({
      id: toast.id,
      timer: setTimeout(() => {
        this.dismiss(toast.id);
      }, TOAST_MS),
    });
  }

  /**
   * Holds a toast until the map shows tick `tick` (`release`): the map is drawn a few ticks behind
   * the newest snapshot (AGENTS.md 7.3), and a toast ahead of the picture tells the news early.
   * It shows at once when the wait runs past `TOAST_HOLD_MS`.
   */
  later(tick: number, body: ToastBody): void {
    this.#seq += 1;
    const id = this.#seq;
    const timer = setTimeout(() => {
      this.#show(id);
    }, TOAST_HOLD_MS);
    this.#waiting.push({ id, tick, body, timer });
  }

  /** The map has drawn `renderTick`: the toasts of events up to it show now, in order. */
  release(renderTick: number): void {
    if (this.#waiting.length === 0) return;
    for (const entry of [...this.#waiting]) {
      if (entry.tick <= renderTick) this.#show(entry.id);
    }
  }

  dismiss(id: number): void {
    this.#forget(id);
    if (this.current.some((t) => t.id === id)) {
      this.current = this.current.filter((t) => t.id !== id);
    }
  }

  /** Drops every toast and timer (the match ended or the timeline broke). */
  clear(): void {
    for (const entry of this.#waiting) clearTimeout(entry.timer);
    this.#waiting = [];
    for (const { id } of [...this.#timers]) this.#forget(id);
    this.current = [];
  }

  #forget(id: number): void {
    const at = this.#timers.findIndex((entry) => entry.id === id);
    if (at < 0) return;
    clearTimeout(this.#timers[at]?.timer);
    this.#timers.splice(at, 1);
  }
}
