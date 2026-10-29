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
