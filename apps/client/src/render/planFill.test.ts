import { describe, expect, it } from 'vitest';
import { planShown, planStep } from './planFill.ts';
import { RIBBON_ENGRAVED } from './style.ts';

const step = RIBBON_ENGRAVED.stepMs / 1000;
const delay = RIBBON_ENGRAVED.stepDelayMs / 1000;

describe('planFill (Eased steps, #851)', () => {
  it('starts at the server value without a step', () => {
    const { fill, gained } = planStep(null, 1, 10, false);
    expect(gained).toBe(0);
    expect(planShown(fill, 10)).toBe(1);
  });

  it('eases a new bonus in after the delay, never past the server value', () => {
    const first = planStep(null, 0, 0, false).fill;
    const { fill, gained } = planStep(first, 1, 5, false);
    expect(gained).toBe(1);
    expect(planShown(fill, 5)).toBe(0);
    expect(planShown(fill, 5 + delay)).toBe(0);
    expect(planShown(fill, 5 + delay + step / 2)).toBeCloseTo(0.5);
    expect(planShown(fill, 5 + delay + step)).toBe(1);
    expect(planShown(fill, 100)).toBe(1);
  });

  it('starts a step that comes while one runs from where the fill is', () => {
    const a = planStep(planStep(null, 0, 0, false).fill, 1, 0, false).fill;
    const mid = delay + step / 2;
    const b = planStep(a, 2, mid, false);
    expect(b.gained).toBe(1);
    expect(b.fill.from).toBeCloseTo(planShown(a, mid));
    expect(planShown(b.fill, mid + delay + step)).toBe(2);
  });

  it('keeps the same value, jumps for a smaller one and under less motion', () => {
    const a = planStep(null, 2, 0, false).fill;
    expect(planStep(a, 2, 3, false).fill).toBe(a);
    expect(planShown(planStep(a, 0, 3, false).fill, 3)).toBe(0);
    const reduced = planStep(a, 3, 3, true);
    expect(reduced.gained).toBe(1);
    expect(planShown(reduced.fill, 3)).toBe(3);
  });
});
