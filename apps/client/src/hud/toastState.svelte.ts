import type { Toast, ToastBody } from './toasts.ts';

/** How many toasts show at once; a new one pushes the oldest out. */
export const TOAST_LIMIT = 3;
/** How long a toast stays, ms. */
export const TOAST_MS = 6000;

/**
 * The toasts on screen (ui-style 10.4): up to three, each fades after six seconds. One field,
 * replaced as a whole on a change (AGENTS.md 7.2).
 */
export class ToastState {
  /** Newest first; replaced, never mutated. */
  current = $state.raw<readonly Toast[]>([]);

  #seq = 0;
  readonly #timers: { id: number; timer: ReturnType<typeof setTimeout> }[] = [];

  push(body: ToastBody): void {
    this.#seq += 1;
    const toast: Toast = { id: this.#seq, ...body };
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

  dismiss(id: number): void {
    this.#forget(id);
    if (this.current.some((t) => t.id === id)) {
      this.current = this.current.filter((t) => t.id !== id);
    }
  }

  /** Drops every toast and timer (the match ended or the timeline broke). */
  clear(): void {
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
