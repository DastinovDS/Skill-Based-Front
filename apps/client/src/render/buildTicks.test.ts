import { describe, expect, it } from 'vitest';
import { buildTickCorners, buildTicksBox, buildTicksShow } from './buildTicks.ts';
import { BUILD_TICKS } from './style.ts';

describe('buildTicksShow', () => {
  it('grows in over the first moments, holds, fades and goes after 3.3 s', () => {
    expect(buildTicksShow(0, false)).toEqual({ alpha: 1, grow: 1 });
    const mid = buildTicksShow(BUILD_TICKS.growMs / 2, false);
    expect(mid?.grow).toBeGreaterThan(0);
    expect(mid?.grow).toBeLessThan(1);
    expect(buildTicksShow(BUILD_TICKS.growMs, false)?.grow).toBe(0);
    expect(buildTicksShow(2999, false)).toEqual({ alpha: 1, grow: 0 });
    expect(buildTicksShow(3150, false)?.alpha).toBeCloseTo(0.5, 5);
    expect(buildTicksShow(3300, false)).toBeNull();
    expect(buildTicksShow(10000, false)).toBeNull();
  });

  it('stands still under less motion: no growth, same hold and fade', () => {
    expect(buildTicksShow(0, true)).toEqual({ alpha: 1, grow: 0 });
    expect(buildTicksShow(2000, true)).toEqual({ alpha: 1, grow: 0 });
    expect(buildTicksShow(3300, true)).toBeNull();
  });
});

describe('buildTicksBox', () => {
  it('sits the box clear of the icon and keeps its proportions at the far zoom', () => {
    const near = buildTicksBox(16);
    expect(near.edge).toBeCloseTo(0.44 * 16 + 2, 5);
    expect(near.arm).toBeCloseTo(3.84, 5);
    const far = buildTicksBox(32);
    expect(far.edge).toBeCloseTo(0.44 * 32 + 4, 5);
    expect(far.arm).toBeCloseTo(7.68, 5);
    expect(far.unit).toBe(2);
  });

  it('has four corners, clockwise from the top left, arms pointing inward', () => {
    const corners = buildTickCorners(10);
    expect(corners.map((c) => [c.x, c.y, c.sx, c.sy])).toEqual([
      [-10, -10, 1, 1],
      [10, -10, -1, 1],
      [10, 10, -1, -1],
      [-10, 10, 1, -1],
    ]);
  });
});
