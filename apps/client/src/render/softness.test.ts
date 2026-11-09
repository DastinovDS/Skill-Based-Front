import { describe, expect, it } from 'vitest';
import { ENGRAVED } from '../theme/tokens.ts';
import { BORDER_BAND, BORDER_ENGRAVING, ENGRAVE, hairFloor, hairWidth } from './engraving.ts';
import { SOFT } from './softness.ts';
import { INK } from './style.ts';

const luminance = (color: number): number =>
  0.2126 * ((color >> 16) & 255) + 0.7152 * ((color >> 8) & 255) + 0.0722 * (color & 255);

describe('softness of the Engraved lines (#865)', () => {
  it('the ink of the map is darker than the ivory of the interface, and warm', () => {
    expect(luminance(SOFT.ink)).toBeLessThan(luminance(ENGRAVED.ink));
    expect((SOFT.ink >> 16) & 255).toBeGreaterThan(SOFT.ink & 255);
    expect(INK).toBe(SOFT.ink);
    expect(ENGRAVE.ink).toBe(SOFT.ink);
  });

  it('lines and hatches are fainter, the thinnest stroke a little thicker', () => {
    expect(SOFT.line).toBeLessThan(1);
    expect(SOFT.hatch).toBeLessThan(1);
    expect(SOFT.weight).toBeGreaterThan(1);
    expect(BORDER_ENGRAVING.alpha).toBe(SOFT.line);
    expect(BORDER_BAND.alpha).toBeCloseTo(0.85 * SOFT.hatch);
  });

  it('the hairline floor is `weight` device pixels', () => {
    expect(hairWidth(0.1, 1, 1)).toBeCloseTo(SOFT.weight);
    expect(hairWidth(0.1, 2, 2, 1.5)).toBeCloseTo(0.375);
    expect(hairWidth(2, 1, 1)).toBe(2);
    expect(hairFloor(1, 1)).toBeGreaterThanOrEqual(SOFT.weight);
    expect(hairFloor(1, 1, 1.5)).toBeGreaterThan(hairFloor(1, 1, 1));
  });
});
