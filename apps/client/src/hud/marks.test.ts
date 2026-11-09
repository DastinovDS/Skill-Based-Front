import { describe, expect, it } from 'vitest';
import { cutIconOf } from '../theme/cutIcons.ts';
import { markPaths, markRowWidth } from './marks.ts';

describe('markPaths (Lozenges, ui-style 57u)', () => {
  it('draws one casing and one mark per charge, the casings first', () => {
    const paths = markPaths(3, 1, 0, 0);
    expect(paths.map((p) => p.kind)).toEqual([
      'casing',
      'casing',
      'casing',
      'fill',
      'hollow',
      'hollow',
    ]);
  });

  it('draws nothing for no charge, and a row as wide as its marks', () => {
    expect(markPaths(0, 0, 0, 0)).toEqual([]);
    expect(markRowWidth(0)).toBe(0);
    expect(markRowWidth(2)).toBeGreaterThan(markRowWidth(1));
    expect(markRowWidth(2, 2)).toBeCloseTo(2 * markRowWidth(2));
  });
});

describe('cutIconOf', () => {
  it('maps the menu names to their cut drawing, and none for the rest', () => {
    expect(cutIconOf('factory')).toBe('factory');
    expect(cutIconOf('stanceWar')).toBe('war');
    expect(cutIconOf('warehouse')).toBeNull();
    expect(cutIconOf('toString')).toBeNull();
  });
});
