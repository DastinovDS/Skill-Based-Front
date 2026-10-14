import { describe, expect, it } from 'vitest';
import { projectOnSegment, splitOrder, trackOrder } from './orderTrack.ts';

describe('trackOrder', () => {
  it('starts at the node the order began in, then the server path', () => {
    expect(trackOrder(null, [4, 7, 9], 2)).toEqual({ chain: [2, 4, 7, 9], segment: 0 });
  });

  it('drops a path that repeats the start node', () => {
    expect(trackOrder(null, [2, 4, 7], 2).chain).toEqual([2, 4, 7]);
  });

  it('keeps the chain while the path only shrinks from the front, and moves the segment on', () => {
    const { chain } = trackOrder(null, [4, 7, 9], 2);
    expect(trackOrder(chain, [4, 7, 9], 2)).toEqual({ chain, segment: 0 });
    expect(trackOrder(chain, [7, 9], 4)).toEqual({ chain, segment: 1 });
    expect(trackOrder(chain, [9], 7)).toEqual({ chain, segment: 2 });
  });

  it('starts again when the path changed (a new order, a reversal)', () => {
    const { chain } = trackOrder(null, [4, 7, 9], 2);
    expect(trackOrder(chain, [2], 2).chain).toEqual([2]);
    expect(trackOrder(chain, [5, 9], 4).chain).toEqual([4, 5, 9]);
  });
});

describe('projectOnSegment', () => {
  it('is the share of the segment before the foot of the point, clamped', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(projectOnSegment({ x: 5, y: 3 }, a, b)).toBe(0.5);
    expect(projectOnSegment({ x: -4, y: 1 }, a, b)).toBe(0);
    expect(projectOnSegment({ x: 40, y: 1 }, a, b)).toBe(1);
    expect(projectOnSegment({ x: 1, y: 1 }, a, a)).toBe(0);
  });
});

describe('splitOrder', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];

  it('walked is only the part of the current segment, the earlier ones are gone', () => {
    const { walked, ahead } = splitOrder(points, 1, { x: 10, y: 4 });
    expect(walked).toEqual([
      { x: 10, y: 0 },
      { x: 10, y: 4 },
    ]);
    expect(ahead).toEqual([
      { x: 10, y: 4 },
      { x: 10, y: 10 },
    ]);
  });

  it('has nothing walked at the start of a segment', () => {
    const { walked, ahead } = splitOrder(points, 0, { x: 0, y: 2 });
    expect(walked).toEqual([]);
    expect(ahead).toHaveLength(3);
  });

  it('clamps a segment index out of range', () => {
    expect(splitOrder(points, 9, { x: 10, y: 5 }).ahead.at(-1)).toEqual({ x: 10, y: 10 });
  });
});
