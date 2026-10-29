import { afterEach, describe, expect, it } from 'vitest';
import { currentSeason, isSeason, seasonOf, setSeasonOverride } from './menuSeason.ts';

describe('the season of the menu (#474)', () => {
  afterEach(() => {
    setSeasonOverride(null);
  });

  it('follows the month', () => {
    const at = (month: number): string => seasonOf(new Date(2026, month, 15));
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(at)).toEqual([
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
    ]);
  });

  it('can be pinned by the dev scenes', () => {
    setSeasonOverride('spring');
    expect(currentSeason(new Date(2026, 9, 29))).toBe('spring');
    setSeasonOverride(null);
    expect(currentSeason(new Date(2026, 9, 29))).toBe('autumn');
    expect(isSeason('winter')).toBe(true);
    expect(isSeason('monsoon')).toBe(false);
  });
});
