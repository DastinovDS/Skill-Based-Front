/**
 * The key-hint bar of the match HUD hides after a few matches (ui-style 10.4, decided by the
 * owner: 3 matches). The counter lives in `localStorage`; a match counts once even if the page is
 * reloaded in it. Every access can throw (private window, blocked storage): the bar then shows.
 */

/** The bar shows in this many matches, then hides (the help overlay still has the keys). */
export const HINT_MATCHES = 3;

const COUNT_KEY = 'gow.hints.matches';
const LAST_KEY = 'gow.hints.last';

/**
 * Counts `matchId` and returns its ordinal (the first match is 1). The same id again does not
 * count twice; without a working storage the answer is 1, so the bar shows.
 */
export function registerMatch(
  matchId: string,
  storage: () => Storage = () => localStorage,
): number {
  try {
    const store = storage();
    const count = Number.parseInt(store.getItem(COUNT_KEY) ?? '0', 10);
    const known = Number.isFinite(count) && count > 0 ? count : 0;
    if (store.getItem(LAST_KEY) === matchId) return Math.max(1, known);
    store.setItem(COUNT_KEY, String(known + 1));
    store.setItem(LAST_KEY, matchId);
    return known + 1;
  } catch {
    return 1;
  }
}

/** Does the bar show in the match with this ordinal? */
export function hintsVisible(ordinal: number): boolean {
  return ordinal <= HINT_MATCHES;
}
