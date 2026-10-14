import { describe, expect, it } from 'vitest';
import { BADGE_SCALE, badgeScale, BEACON, beaconPulse } from './alertLayout.ts';

describe('badgeScale', () => {
  it('keeps the badge the same size on screen, within the bounds', () => {
    expect(badgeScale(1)).toBe(1);
    expect(badgeScale(2)).toBe(BADGE_SCALE.min);
    expect(badgeScale(0.25)).toBe(BADGE_SCALE.max);
    expect(badgeScale(0)).toBe(BADGE_SCALE.max);
    expect(badgeScale(0.5)).toBe(2);
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
