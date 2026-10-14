import { describe, expect, it } from 'vitest';
import { arcPath, arcRadius, arrowPoints, centreOf, offscreenAngle } from './edgeLayout.ts';

const view = { left: 0, top: 48, right: 1000, bottom: 648 };

describe('offscreenAngle', () => {
  it('is null for a city in view, also near the edge', () => {
    expect(offscreenAngle(view, { x: 500, y: 300 })).toBeNull();
    expect(offscreenAngle(view, { x: 990, y: 640 })).toBeNull();
  });

  it('points from the middle of the view to a city outside it', () => {
    expect(offscreenAngle(view, { x: 1400, y: 348 })).toBeCloseTo(0); // right
    expect(offscreenAngle(view, { x: 500, y: -200 })).toBeCloseTo(-Math.PI / 2); // up
    expect(offscreenAngle(view, { x: 500, y: 900 })).toBeCloseTo(Math.PI / 2); // down
    expect(Math.abs(offscreenAngle(view, { x: -300, y: 348 }) ?? 0)).toBeCloseTo(Math.PI); // left
  });
});

describe('arcRadius', () => {
  it('follows the smaller side of the view, with a floor', () => {
    expect(arcRadius(view)).toBeCloseTo(600 * 0.46);
    expect(arcRadius({ left: 0, top: 0, right: 20, bottom: 20 })).toBe(40);
  });
});

describe('arcPath and arrowPoints', () => {
  it('draws an arc of the ring around the middle, centred on the angle', () => {
    const middle = centreOf(view);
    const d = arcPath(middle, 100, 0, 40);
    expect(d.startsWith('M')).toBe(true);
    expect(d).toContain('A100.0 100.0 0 0 1');
    // The arc of a rightward direction spans both sides of the horizontal through the middle.
    const m = /^M(\S+) (\S+) A.* (\S+) (\S+)$/.exec(d);
    expect(Number(m?.[2])).toBeLessThan(middle.y);
    expect(Number(m?.[4])).toBeGreaterThan(middle.y);
  });

  it('puts the tip of the arrow outside the ring', () => {
    const tip = arrowPoints({ x: 0, y: 0 }, 100, 0).split(' ')[0] ?? '';
    expect(Number(tip.split(',')[0])).toBeCloseTo(116);
  });
});
