/**
 * "Less motion" for the map effects (docs/design/ui-style.md, 14.2): the OS setting
 * `prefers-reduced-motion`, or an explicit choice of the player (package F: `setReducedMotion`).
 * Without motion the map shows no flash, wave or bounce arrow, only the numbers.
 */

let override: boolean | null = null;
let query: MediaQueryList | null | undefined;

/** An explicit choice overrides the system setting; `null` goes back to the system setting. */
export function setReducedMotion(value: boolean | null): void {
  override = value;
}

export function reducedMotion(): boolean {
  if (override !== null) return override;
  if (query === undefined) {
    query =
      typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  }
  return query?.matches ?? false;
}
