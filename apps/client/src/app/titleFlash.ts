/**
 * Flashes the title of the page while the tab is in the background (CLI-10): a player who tabs
 * away while waiting for an opponent sees "Opponent found" in the tab strip. There is no sound
 * (the game has none), and no notification permission is asked. The title is the one the page had
 * when the flash was started and comes back when the tab is shown again or the flash is stopped.
 * Best effort: a browser may slow the timers of a tab that has been hidden for long, and then the
 * title changes more slowly, but the first change is immediate.
 */

export const FLASH_PERIOD_MS = 1_000;

/** Starts the flash of `message`; returns the function that stops it and restores the title. */
export function flashTitle(
  message: string,
  doc: Document = document,
  periodMs: number = FLASH_PERIOD_MS,
): () => void {
  const original = doc.title;
  let timer: ReturnType<typeof setInterval> | undefined;

  const start = (): void => {
    if (timer !== undefined) return;
    let shown = true;
    doc.title = message;
    timer = setInterval(() => {
      shown = !shown;
      doc.title = shown ? message : original;
    }, periodMs);
  };
  const halt = (): void => {
    clearInterval(timer);
    timer = undefined;
    doc.title = original;
  };
  // Only a tab that is out of sight needs it: the title of the visible one is not looked at.
  const sync = (): void => {
    if (doc.visibilityState === 'hidden') start();
    else halt();
  };

  sync();
  doc.addEventListener('visibilitychange', sync);
  return () => {
    doc.removeEventListener('visibilitychange', sync);
    halt();
  };
}
