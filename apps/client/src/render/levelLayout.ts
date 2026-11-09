/**
 * The fade of the supply view's crosshatch over the own nodes ahead of the leaf level (DEC-43; Canal,
 * #858) when the level moves. Pure functions, no PixiJS.
 */

/**
 * How much of the fill a cell has while the level changes: a cell in both the old and the new set
 * stays at 1, one that enters grows with `share` (0..1), one that leaves shrinks with it.
 */
export function levelShare(
  cell: number,
  from: ReadonlySet<number>,
  to: ReadonlySet<number>,
  share: number,
): number {
  const was = from.has(cell);
  const now = to.has(cell);
  if (was && now) return 1;
  if (now) return share;
  if (was) return 1 - share;
  return 0;
}
