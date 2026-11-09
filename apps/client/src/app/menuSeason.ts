/**
 * The season of the menu picture (#474, BG4 of docs/design/mockups/menu-background.html, as a still
 * tint in BG5): the terrain of the menu map takes the colours of the season of the date, so the
 * start screen does not look the same all year. Decoration only; the match map keeps its colours.
 */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

/** By month (January first), the northern seasons by meteorological count. */
const BY_MONTH: readonly Season[] = [
  'winter',
  'winter',
  'spring',
  'spring',
  'spring',
  'summer',
  'summer',
  'summer',
  'autumn',
  'autumn',
  'autumn',
  'winter',
];

export function seasonOf(date: Date): Season {
  return BY_MONTH[date.getMonth()] ?? 'summer';
}

let override: Season | null = null;

/** The dev scenes pin a season (`/?menu=<id>&season=winter`); `null` goes back to the date. */
export function setSeasonOverride(season: Season | null): void {
  override = season;
}

export function isSeason(value: string | null): value is Season {
  return value === 'spring' || value === 'summer' || value === 'autumn' || value === 'winter';
}

/** The season the menu shows now. */
export function currentSeason(now: Date = new Date()): Season {
  return override ?? seasonOf(now);
}

/**
 * The grade of the baked ground of the menu map by season (#839: the ground is the match's
 * Intaglio now, not soft blobs of a season's colours): how much colour it keeps, how light it is,
 * and a tint per channel. Summer is the ground as baked, only darker behind the text.
 */
const GRADE: Readonly<
  Record<Season, { saturate: number; light: number; tint: readonly [number, number, number] }>
> = {
  summer: { saturate: 0.62, light: 0.6, tint: [1, 1, 1] },
  spring: { saturate: 0.72, light: 0.6, tint: [0.94, 1.07, 0.94] },
  autumn: { saturate: 0.66, light: 0.6, tint: [1.12, 0.98, 0.8] },
  winter: { saturate: 0.3, light: 0.64, tint: [0.95, 1, 1.1] },
};

/** The `feColorMatrix` values (4 rows of 5) of the season's grade of the ground. */
export function groundMatrix(season: Season): string {
  const { saturate: s, light, tint } = GRADE[season];
  // The luminance weights of the SVG `saturate` matrix.
  const [lr, lg, lb] = [0.213, 0.715, 0.072];
  const rows = [
    [lr + (1 - lr) * s, lg - lg * s, lb - lb * s],
    [lr - lr * s, lg + (1 - lg) * s, lb - lb * s],
    [lr - lr * s, lg - lg * s, lb + (1 - lb) * s],
  ].map((row, i) => [...row.map((v) => v * light * (tint[i] ?? 1)), 0, 0]);
  return [...rows, [0, 0, 0, 1, 0]]
    .map((row) => row.map((v) => Number(v.toFixed(4)).toString()).join(' '))
    .join(' ');
}
