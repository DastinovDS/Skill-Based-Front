import { describe, expect, it } from 'vitest';
import { outsideDiamond, tickCorners, tickPaths } from './cornerTicks.ts';

describe('corner ticks under a gilt diamond (the VP lozenge, #956)', () => {
  const diamond = { x: 0, y: 0, h: 10 };

  it('cuts the part of a segment inside the diamond, and nothing else', () => {
    // A segment through the middle: its start and end stay, the middle goes.
    const through = outsideDiamond([-20, 0], [20, 0], diamond, 0);
    expect(through).toHaveLength(2);
    expect(through[0]?.[1]).toBeCloseTo(0.25);
    expect(through[1]?.[0]).toBeCloseTo(0.75);
    // A segment that never touches it stays whole; one wholly inside goes entirely.
    expect(outsideDiamond([-20, 20], [20, 20], diamond, 0)).toEqual([[0, 1]]);
    expect(outsideDiamond([-3, 0], [3, 0], diamond, 0)).toEqual([]);
  });

  it('grows the diamond by a distance across, so a cap can stop short of its edge', () => {
    const [near] = outsideDiamond([-20, 0], [0, 0], diamond, 0);
    const [far] = outsideDiamond([-20, 0], [0, 0], diamond, 2);
    expect(far?.[1] ?? 0).toBeLessThan(near?.[1] ?? 0);
  });

  it('leaves a tick whole when nothing lies over it and hides it under a lozenge on its corner', () => {
    const corner = tickCorners({ width: 28.5, enemy: false })[1];
    if (corner === undefined) throw new Error('a box has a top right corner');
    expect(tickPaths(corner, 0, [], 2.2)).toHaveLength(1);
    const lozenge = { x: corner.x, y: corner.y, h: 13.1 };
    expect(tickPaths(corner, 0, [lozenge], 2.2)).toEqual([]);
    // A lozenge far away touches nothing.
    const away = { x: corner.x + 40, y: corner.y - 40, h: 8 };
    expect(tickPaths(corner, 0, [away], 2.2)).toHaveLength(1);
  });
});
