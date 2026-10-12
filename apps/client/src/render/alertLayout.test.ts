import { describe, expect, it } from 'vitest';
import { arcFill, BEACON, beaconPulse, PILL_SCALE, pillScale } from './alertLayout.ts';

describe('arcFill', () => {
  it('fills as the loss comes closer', () => {
    expect(arcFill(30, 30)).toBe(0);
    expect(arcFill(15, 30)).toBeCloseTo(0.5);
    expect(arcFill(0, 30)).toBe(1);
  });

  it('stays within 0..1', () => {
    expect(arcFill(40, 30)).toBe(0);
    expect(arcFill(-3, 30)).toBe(1);
    expect(arcFill(5, 0)).toBe(1);
  });
});

describe('pillScale', () => {
  it('keeps the pill the same size on screen, within the bounds', () => {
    expect(pillScale(1)).toBe(1);
    expect(pillScale(2)).toBe(PILL_SCALE.min);
    expect(pillScale(0.25)).toBe(PILL_SCALE.max);
    expect(pillScale(0)).toBe(PILL_SCALE.max);
    expect(pillScale(0.5)).toBe(2);
  });
});

describe('beaconPulse', () => {
  it('swings 0 to 1 and back once per period', () => {
    expect(beaconPulse(0, false)).toBeCloseTo(0);
    expect(beaconPulse(BEACON.periodMs / 2, false)).toBeCloseTo(1);
    expect(beaconPulse(BEACON.periodMs, false)).toBeCloseTo(0);
  });

  it('is still without motion', () => {
    expect(beaconPulse(BEACON.periodMs / 2, true)).toBe(0);
  });
});
