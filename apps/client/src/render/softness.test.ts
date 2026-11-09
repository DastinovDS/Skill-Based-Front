import { describe, expect, it } from 'vitest';
import { ENGRAVED } from '../theme/tokens.ts';
import { hairFloor, hairWidth } from './engraving.ts';
import { DEFAULT_SOFT_LEVEL, SOFT, SOFT_LEVELS, softLevelOf } from './softness.ts';

const luminance = (color: number): number =>
  0.2126 * ((color >> 16) & 255) + 0.7152 * ((color >> 8) & 255) + 0.0722 * (color & 255);

describe('softness of the Engraved lines (#865)', () => {
  it('level 0 is the look of #829: the ivory token, full alpha, a one device pixel floor', () => {
    expect(SOFT_LEVELS[0]).toEqual({ ink: ENGRAVED.ink, line: 1, hatch: 1, weight: 1 });
  });

  it('every next level is softer: darker ink, fainter lines and hatches, a thicker floor', () => {
    for (let i = 1; i < SOFT_LEVELS.length; i++) {
      const [before, after] = [SOFT_LEVELS[i - 1], SOFT_LEVELS[i]];
      if (before === undefined || after === undefined) throw new Error('no level');
      expect(luminance(after.ink)).toBeLessThan(luminance(before.ink));
      expect(after.line).toBeLessThan(before.line);
      expect(after.hatch).toBeLessThan(before.hatch);
      expect(after.weight).toBeGreaterThan(before.weight);
    }
  });

  it('reads the level of ?soft= and ignores anything that is not one', () => {
    expect(softLevelOf('?soft=2')).toBe(2);
    expect(softLevelOf('?scene=orders&soft=3')).toBe(3);
    expect(softLevelOf('')).toBe(DEFAULT_SOFT_LEVEL);
    expect(softLevelOf('?soft=')).toBe(DEFAULT_SOFT_LEVEL);
    expect(softLevelOf('?soft=9')).toBe(DEFAULT_SOFT_LEVEL);
    expect(softLevelOf('?soft=1.5')).toBe(DEFAULT_SOFT_LEVEL);
    expect(softLevelOf('?soft=x', 1)).toBe(1);
  });

  it('the tests draw the default level', () => {
    expect(SOFT).toBe(SOFT_LEVELS[DEFAULT_SOFT_LEVEL]);
  });

  it('the hairline floor is `weight` device pixels', () => {
    expect(hairWidth(0.1, 1, 1, 1.5)).toBe(1.5);
    expect(hairWidth(0.1, 2, 2, 1.5)).toBeCloseTo(0.375);
    expect(hairWidth(2, 1, 1, 1.5)).toBe(2);
    expect(hairFloor(1, 1, 1.5)).toBeGreaterThanOrEqual(1.5);
    expect(hairFloor(1, 1, 1.5)).toBeGreaterThan(hairFloor(1, 1, 1));
  });
});
