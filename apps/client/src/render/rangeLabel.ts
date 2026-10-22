import { tf } from '../i18n/index.ts';
import type { EnemyGroup, Seen, UnitsRange } from '../protocol.gen.ts';

/**
 * The text of a range of enemy units the view gives («1-2», «3-5», «21+»; DEC-21, item 4). The
 * bounds come from the server (`vision.range_starts`); nothing is computed here, and no charges
 * are shown at this level.
 */
export function rangeLabel(range: UnitsRange): string {
  return range.high === null
    ? tf('range.open', { low: range.low })
    : tf('range.closed', { low: range.low, high: range.high });
}

/** What a token can say about the enemy units of a place or a figure: exact numbers, a range, or nothing. */
export interface Known {
  counts: { units: number; charged: number } | null;
  range: string | null;
}

/**
 * Takes from a `Seen` only what its level carries: `exact` the totals, `range` the range (never
 * charges), `presence` nothing. A field the level does not carry is not guessed.
 */
export function knownOfSeen(seen: Seen): Known {
  if (seen.level === 'exact' && seen.enemy_units !== null && seen.enemy_charged !== null) {
    return { counts: { units: seen.enemy_units, charged: seen.enemy_charged }, range: null };
  }
  if (seen.level === 'range' && seen.enemy_range !== null) {
    return { counts: null, range: rangeLabel(seen.enemy_range) };
  }
  return { counts: null, range: null };
}

/** The same for an enemy figure on a half of a road (`EnemyGroup`, DEC-33). */
export function knownOfFigure(figure: EnemyGroup): Known {
  if (figure.detail === 'exact' && figure.units !== null && figure.charged !== null) {
    return { counts: { units: figure.units, charged: figure.charged }, range: null };
  }
  if (figure.detail === 'range' && figure.units_range !== null) {
    return { counts: null, range: rangeLabel(figure.units_range) };
  }
  return { counts: null, range: null };
}
