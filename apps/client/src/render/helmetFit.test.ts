import { describe, expect, it } from 'vitest';
import { fitReach, ringRadius } from './cityLayout.ts';
import { helmetFit, helmetWidth, provinceHelmetShare } from './helmetFit.ts';
import { PROVINCE, UNIT_SIDES } from './style.ts';

describe('a small group in a province (A6 "Larger province", #949)', () => {
  it('has its ring 20 out, and the helmet keeps about its width over the cells', () => {
    expect(ringRadius(PROVINCE.radius)).toBe(20);
    const full = helmetWidth(UNIT_SIDES[0], true);
    const fitted = helmetFit('own', full, fitReach(PROVINCE.radius));
    expect(fitted).toBeLessThanOrEqual(full);
    // Before A6 (radius 9) the same helmet shrank to 17.25 of 29.59; now it keeps nine tenths.
    expect(fitted).toBeGreaterThan(0.85 * full);
    expect(provinceHelmetShare()).toBeCloseTo(fitted / full);
  });
});
