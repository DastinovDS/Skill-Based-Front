import { describe, expect, it } from 'vitest';
import { spreadApart, SPREAD_STEP, type SpreadItem } from './spread.ts';

const item = (x: number, y = 0, radius = 12): SpreadItem => ({
  at: { x, y },
  normal: { x: 0, y: 1 },
  radius,
});

const gap = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

describe('spreadApart', () => {
  it('leaves tokens that do not overlap where they are', () => {
    expect(spreadApart([item(0), item(30)])).toEqual([
      { x: 0, y: 0 },
      { x: 30, y: 0 },
    ]);
  });

  it('moves the second of two tokens at the same place along its normal', () => {
    const [first, second] = spreadApart([item(10), item(10)]);
    expect(first).toEqual({ x: 10, y: 0 });
    expect(second?.x).toBe(10);
    expect(second?.y).toBeGreaterThanOrEqual(24);
    expect(second?.y).toBeLessThan(24 + SPREAD_STEP);
  });

  it('moves a token only as far as it needs when it is nearly at the same place', () => {
    const [, second] = spreadApart([item(0), item(20)]);
    // 20 apart along the road, 24 needed: a short step sideways is enough.
    expect(second).toBeDefined();
    expect(gap({ x: 0, y: 0 }, second ?? { x: 0, y: 0 })).toBeGreaterThanOrEqual(24);
    expect(second?.y).toBeLessThanOrEqual(16);
  });

  it('keeps three tokens at one place all apart', () => {
    const places = spreadApart([item(0), item(0), item(0)]);
    expect(gap(places[0] ?? { x: 0, y: 0 }, places[1] ?? { x: 0, y: 0 })).toBeGreaterThanOrEqual(
      24,
    );
    expect(gap(places[1] ?? { x: 0, y: 0 }, places[2] ?? { x: 0, y: 0 })).toBeGreaterThanOrEqual(
      24,
    );
    expect(gap(places[0] ?? { x: 0, y: 0 }, places[2] ?? { x: 0, y: 0 })).toBeGreaterThanOrEqual(
      24,
    );
  });

  it('returns the places in the order of the items', () => {
    const places = spreadApart([item(0), item(100), item(0)]);
    expect(places[1]).toEqual({ x: 100, y: 0 });
    expect(places[2]?.y).toBeGreaterThan(0);
  });
});
