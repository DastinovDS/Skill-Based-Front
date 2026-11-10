import { describe, expect, it } from 'vitest';
import { circleHatch } from './pipeLayout.ts';

describe('the hatching of a pocket', () => {
  it('hatches a circle with parallel chords whose ends lie on it', () => {
    const centre = { x: 10, y: 20 };
    const chords = circleHatch(centre, 20, 5);
    expect(chords.length).toBeGreaterThan(4);
    for (const [p, q] of chords) {
      expect(Math.hypot(p.x - centre.x, p.y - centre.y)).toBeCloseTo(20, 5);
      expect(Math.hypot(q.x - centre.x, q.y - centre.y)).toBeCloseTo(20, 5);
      // From the lower left to the upper right, at 45 degrees.
      expect(q.x).toBeGreaterThanOrEqual(p.x);
      expect(q.y).toBeLessThanOrEqual(p.y);
      expect(q.x - p.x).toBeCloseTo(p.y - q.y);
    }
    expect(circleHatch(centre, 0, 5)).toEqual([]);
  });
});
