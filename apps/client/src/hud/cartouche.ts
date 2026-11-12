/**
 * The match clock's cartouche (#1005, T3 "Cartouche", ui-style 76): an engraved tablet round the
 * figures with corner brackets and a lozenge serif on each side. Pure geometry in CSS px, so it is
 * tested without a DOM.
 *
 * Every rule, dash and bracket is a rectangle on whole pixels (crisp at any whole device pixel
 * ratio), and the whole drawing is mirror-symmetric about both middle lines: the owner's one
 * condition for this sign was "even, with no visual skew". The two rules match the framed buttons
 * beside it (a rule, two pixels of plate, a faint rule).
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The box of the clock: even sides, so it sits on whole pixels in the 52 px bar (top 4). */
export const CARTOUCHE_W = 110;
export const CARTOUCHE_H = 44;
/** The horizontal middle line: a pixel boundary, like the middle of the 30 px buttons. */
export const CARTOUCHE_MID = CARTOUCHE_H / 2;

/** The outer rule's column and row (from the left and the top; the others mirror them). */
const OUTER_X = 8;
const OUTER_Y = 1;
/** The inner rule stands this far inside the outer one (a rule, two pixels of plate). */
const INSET = 3;
/** A bracket's arm: its length and its thickness (one pixel past the outer rule). */
const ARM = 8;
const ARM_W = 2;
/**
 * The dashes of a paused clock: 4 px on, 2 px off, every rule beginning and ending on a whole
 * dash, so the pattern reads the same from either end (each rule's length is `6n - 2`).
 */
const DASH = 4;
const GAP = 2;

/** One rule as one rectangle, or as its dashes. */
function rule(x: number, y: number, length: number, across: boolean, dashed: boolean): Rect[] {
  const piece = (at: number, len: number): Rect =>
    across ? { x: x + at, y, w: len, h: 1 } : { x, y: y + at, w: 1, h: len };
  if (!dashed) return [piece(0, length)];
  const period = DASH + GAP;
  if ((length + GAP) % period !== 0) {
    throw new Error(`a dashed rule of ${String(length)} px does not end on a dash`);
  }
  const n = (length + GAP) / period;
  return Array.from({ length: n }, (_, k) => piece(k * period, DASH));
}

/** The four sides of a frame from (`x`, `y`) to its mirror; the sides meet without overlapping. */
function frame(x: number, y: number, dashed: boolean): Rect[] {
  const right = CARTOUCHE_W - 1 - x;
  const bottom = CARTOUCHE_H - 1 - y;
  const across = right - x + 1;
  const down = bottom - y - 1;
  return [
    ...rule(x, y, across, true, dashed),
    ...rule(x, bottom, across, true, dashed),
    ...rule(x, y + 1, down, false, dashed),
    ...rule(right, y + 1, down, false, dashed),
  ];
}

/** The outer rule (solid, or dashed while paused). */
export const outerRule = (dashed: boolean): Rect[] => frame(OUTER_X, OUTER_Y, dashed);

/** The faint inner rule. */
export const innerRule = (dashed: boolean): Rect[] =>
  frame(OUTER_X + INSET, OUTER_Y + INSET, dashed);

/** The plate inside the inner rule (a shade darker than the bar). */
export const PLATE: Rect = {
  x: OUTER_X + INSET + 1,
  y: OUTER_Y + INSET + 1,
  w: CARTOUCHE_W - 2 * (OUTER_X + INSET + 1),
  h: CARTOUCHE_H - 2 * (OUTER_Y + INSET + 1),
};

/** The four corner brackets: an L of two arms over each corner of the outer rule. */
export const BRACKETS: readonly Rect[] = (() => {
  const x0 = OUTER_X + 1 - ARM_W;
  const y0 = OUTER_Y + 1 - ARM_W;
  const x1 = CARTOUCHE_W - x0 - ARM_W;
  const y1 = CARTOUCHE_H - y0 - ARM_W;
  const out: Rect[] = [];
  for (const [x, y, dx, dy] of [
    [x0, y0, 0, 0],
    [x1, y0, ARM - ARM_W, 0],
    [x0, y1, 0, ARM - ARM_W],
    [x1, y1, ARM - ARM_W, ARM - ARM_W],
  ] as const) {
    // The arm along the top or bottom rule, then the one down or up the side, not overlapping.
    out.push({ x: x - dx, y, w: ARM, h: ARM_W });
    out.push({ x, y: dy === 0 ? y + ARM_W : y - dy, w: ARM_W, h: ARM - ARM_W });
  }
  return out;
})();

/** The centres of the two serifs: on the outer rule's columns, on the middle line. */
export const SERIF_X: readonly [number, number] = [OUTER_X + 0.5, CARTOUCHE_W - OUTER_X - 0.5];

/** A lozenge of half-diagonal `r` round (`cx`, `cy`), as SVG polygon points. */
export function lozenge(cx: number, cy: number, r: number): string {
  return `${String(cx)},${String(cy - r)} ${String(cx + r)},${String(cy)} ${String(cx)},${String(cy + r)} ${String(cx - r)},${String(cy)}`;
}

/**
 * The serif, as half-diagonals: its dark casing (cutting both rules), its ink, the swell of the
 * last minute's beat, and the hole of a hollow (paused) one. GPU rasterisers sample a slanted edge
 * unevenly unless its corners sit on device pixels, so a lozenge is even only where it is drawn
 * for the pixel grid: from a device pixel ratio of 2 the serifs are polygons with these
 * half-diagonals (every corner on a device pixel); under 2 they are pixel lozenges
 * (`pixelLozenge`) a quarter pixel larger, so that no pixel centre falls on an edge.
 */
export const SERIF_CASING = 7;
export const SERIF_INK = 4;
export const SERIF_SWELL = 5.5;
export const SERIF_HOLE = 2;
/** What a pixel lozenge adds to the half-diagonal (see above). */
export const PIXEL_PAD = 0.25;

/**
 * A lozenge of half-diagonal `r` round (`cx`, `cy`) as whole-pixel rows: a row is every pixel whose
 * centre lies inside. `cx` is a pixel's centre and `cy` a pixel boundary (the serifs' places).
 */
export function pixelLozenge(cx: number, cy: number, r: number): Rect[] {
  const out: Rect[] = [];
  for (let k = 0; k < Math.ceil(r); k++) {
    const half = Math.floor(r - (k + 0.5));
    if (half < 0) continue;
    const x = cx - 0.5 - half;
    const w = 2 * half + 1;
    out.push({ x, y: cy - 1 - k, w, h: 1 }, { x, y: cy + k, w, h: 1 });
  }
  return out;
}

/**
 * Where the figures sit: the baseline lies this many em below the middle line, so that the figures,
 * not their line box, are centred on the frame. Lining figures of EB Garamond stand 0.63 em tall
 * (measured on every digit at 400 and 700); the bold round figures and the tail of a bold 9 reach a
 * little lower, so the bold figures sit a little higher. Both stand a hair above the exact middle,
 * where the eye puts the centre of a line of figures, and at a device pixel ratio of 1 the
 * baseline rounds up rather than down (the shots measure 1 px more below than above at ratio 1,
 * equal at ratio 2).
 */
export const BASELINE_EM: Record<400 | 700, number> = { 400: 0.31, 700: 0.295 };

/**
 * The left side bearings of the digits in EB Garamond, in em, at the clock's two weights
 * (measured with `measureText`), and the mean right side bearing of a last digit. Tabular figures
 * share one advance, but a leading "1" has a wide left bearing: centred by the advance, "11:04"
 * would stand a pixel right of the middle.
 */
const LEFT_BEARING: Record<400 | 700, readonly number[]> = {
  400: [0.045, 0.092, 0.032, 0.05, 0.019, 0.072, 0.047, 0.036, 0.065, 0.053],
  700: [0.026, 0.096, 0.06, 0.071, 0.021, 0.085, 0.066, 0.037, 0.06, 0.055],
};
const RIGHT_BEARING_MEAN: Record<400 | 700, number> = { 400: 0.027, 700: 0.029 };

/**
 * How far to move the figures (in em, negative is left) so that their ink, not their advance,
 * is centred. Only the leading digit counts: it changes at most once a minute, so the figures
 * never move as the seconds run.
 */
export function figureNudge(text: string, weight: 400 | 700): number {
  const lead = Number(text[0]);
  const bearing = Number.isInteger(lead) ? (LEFT_BEARING[weight][lead] ?? 0) : 0;
  return (RIGHT_BEARING_MEAN[weight] - bearing) / 2;
}
