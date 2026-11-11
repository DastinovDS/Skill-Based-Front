/**
 * The charge's own mark in the HTML interface (Lozenges, ui-style 57u): the map's lozenge
 * (`LOZENGE`, part 2 of #829) as SVG paths, so a price in a radial menu reads like the warehouse
 * under a city. Pure: `ChargeMarks.svelte` and `Radial.svelte` draw the paths.
 */
import { lozengeRow } from '../render/pieceLayout.ts';
import { LOZENGE } from '../render/style.ts';

/** One drawn part of a mark: the casing, the filled charge or the hollow place. */
export interface MarkPath {
  readonly kind: 'casing' | 'fill' | 'hollow';
  readonly d: string;
}

const lozenge = (x: number, y: number, r: number): string =>
  `M${x.toFixed(2)} ${(y - r).toFixed(2)}L${(x + r).toFixed(2)} ${y.toFixed(2)}` +
  `L${x.toFixed(2)} ${(y + r).toFixed(2)}L${(x - r).toFixed(2)} ${y.toFixed(2)}Z`;

/** Half the width of one mark at `scale` (its casing's half diagonal). */
const markHalf = (scale = 1): number => (LOZENGE.casing / Math.SQRT2) * scale;

/**
 * `count` marks in a row centred on (`cx`, `cy`), set in threes past four, `filled` of them
 * filled and the rest hollow; every casing first, so neighbours never cut into a mark.
 */
export function markPaths(
  count: number,
  filled: number,
  cx: number,
  cy: number,
  scale = 1,
): MarkPath[] {
  const xs = lozengeRow(count).map((x) => cx + x * scale);
  const casings = xs.map((x) => ({ kind: 'casing' as const, d: lozenge(x, cy, markHalf(scale)) }));
  const marks = xs.map((x, j) =>
    j < filled
      ? { kind: 'fill' as const, d: lozenge(x, cy, (LOZENGE.fill / Math.SQRT2) * scale) }
      : { kind: 'hollow' as const, d: lozenge(x, cy, (LOZENGE.hollow / Math.SQRT2) * scale) },
  );
  return [...casings, ...marks];
}

/** The width of a row of `count` marks at `scale`, casings included. */
export function markRowWidth(count: number, scale = 1): number {
  const xs = lozengeRow(count);
  if (xs.length === 0) return 0;
  return ((xs[xs.length - 1] ?? 0) - (xs[0] ?? 0)) * scale + 2 * markHalf(scale);
}
