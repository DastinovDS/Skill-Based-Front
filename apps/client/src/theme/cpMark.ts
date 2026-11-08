/**
 * The CP mark (#841): the sign of command points, a Roman standard (vexillum): a pole, a crossbar
 * and a square banner with a cut-in foot, in ivory ink on a dark casing (the Engraved language;
 * Lapis's Roman epigraphy). A charge is the lozenge (ui-style 57u), so CP never takes it: the mark
 * is upright and asymmetric top to bottom, the lozenge a turned square, and the two differ in
 * shape also in grey.
 *
 * One geometry for every renderer: `CpMark.svelte` draws it as SVG, and a PixiJS bake draws the
 * same polygons (`casing` stroke first, then the `ink` fill) into one `SpriteCache` texture per
 * size bucket. It is laid on a 16-unit grid so the edges fall on whole pixels at 16 px and on half
 * pixels at 12 px, and stays readable from 12 to 16 px; the box keeps one unit round it for the
 * casing.
 */

export interface CpMarkSpec {
  /** The view box, in grid units: the 16-unit grid plus room for the casing. */
  readonly box: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  /** The polygons of the mark, each a flat list of x, y pairs. */
  readonly shapes: readonly (readonly number[])[];
  /** The casing: drawn first as a stroke of every polygon, mitred. */
  readonly casing: { readonly color: number; readonly width: number };
  /** The ink: the fill of every polygon over the casing. */
  readonly ink: number;
}

export const CP_MARK: CpMarkSpec = {
  box: { x: -1, y: -1, width: 18, height: 18 },
  shapes: [
    // the pole, through the banner to the ground
    [7.25, 1.5, 8.75, 1.5, 8.75, 15.5, 7.25, 15.5],
    // the finial: a short spear point
    [8, 0, 10, 3, 6, 3],
    // the crossbar
    [1.5, 3, 14.5, 3, 14.5, 4.5, 1.5, 4.5],
    // the banner, its foot cut in to a notch
    [2.5, 4.5, 13.5, 4.5, 13.5, 12, 8, 9.5, 2.5, 12],
  ],
  casing: { color: 0x060504, width: 2 },
  ink: 0xece4d1,
};

/** `0xRRGGBB` as a CSS hex colour. */
export function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** The `points` attribute of an SVG polygon from a flat list of x, y pairs. */
export function svgPoints(flat: readonly number[]): string {
  const pairs: string[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2)
    pairs.push(`${String(flat[i])},${String(flat[i + 1])}`);
  return pairs.join(' ');
}
