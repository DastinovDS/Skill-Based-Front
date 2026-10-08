/** Numbers of the top bar (ui-style 10.2). Pure, so they are tested without a DOM. */

/**
 * The CP bar: one segment per whole CP of the cap; each entry is how full that segment is, in
 * percent. `value` and `cap` are hundredths of CP, as in the protocol.
 */
export function cpSegments(value: number, cap: number): number[] {
  const count = Math.max(1, Math.ceil(cap / 100));
  return Array.from({ length: count }, (_, i) =>
    Math.round(Math.min(100, Math.max(0, value - i * 100))),
  );
}

/** A segment that is neither empty nor full is the partial one: it is hatched. */
export const isPartial = (fill: number): boolean => fill > 0 && fill < 100;

/** Is the CP at its cap? Then the excess burns (DEC-02) and the bar says so. */
export const atCap = (value: number, cap: number): boolean => value >= cap;

/** The share of the tug-of-war bar that is mine, in percent: half and half while nobody scored. */
export function vpShare(mine: number, enemy: number): number {
  const total = mine + enemy;
  return total === 0 ? 50 : Math.round((100 * mine) / total);
}
