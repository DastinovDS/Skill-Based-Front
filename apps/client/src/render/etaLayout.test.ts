import { describe, expect, it } from 'vitest';
import { etaSpot, pathLength } from './etaLayout.ts';

const box = { width: 40, height: 20 };
const none = { start: 0, end: 0 };

describe('etaSpot: the label of a move order sits on the path, above the road (#432)', () => {
  it('on a path of one road: the middle of the road, lifted off it to the top of the screen', () => {
    // A level road from (0,100) to (200,100): the middle is x = 100; above is smaller y.
    const spot = etaSpot(
      [
        { x: 0, y: 100 },
        { x: 200, y: 100 },
      ],
      none,
      box,
      6,
    );
    expect(spot?.x).toBeCloseTo(100);
    // The gap plus the half of the box height: the plate stands clear of the road.
    expect(spot?.y).toBeCloseTo(100 - (6 + 10));
  });

  it('is above the road whichever way the order goes', () => {
    const path = [
      { x: 0, y: 100 },
      { x: 200, y: 100 },
    ];
    const there = etaSpot(path, none, box, 6);
    const back = etaSpot([...path].reverse(), none, box, 6);
    expect(back?.x).toBeCloseTo(there?.x ?? NaN);
    expect(back?.y).toBeCloseTo(there?.y ?? NaN);
  });

  it('on a vertical road the label goes to its right, clear of it by the half of the box width', () => {
    const spot = etaSpot(
      [
        { x: 50, y: 0 },
        { x: 50, y: 300 },
      ],
      none,
      box,
      6,
    );
    expect(spot?.x).toBeCloseTo(50 + 6 + 20);
    expect(spot?.y).toBeCloseTo(150);
  });

  it('on a slanted road it clears the road by the box along the normal, on its upper side', () => {
    const spot = etaSpot(
      [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ],
      none,
      box,
      0,
    );
    // The middle (50, 50), the normal (+1, -1) / sqrt 2: up and to the right of a road going down.
    const lift = (20 + 10) / Math.SQRT2;
    expect(spot?.x).toBeCloseTo(50 + lift / Math.SQRT2);
    expect(spot?.y).toBeCloseTo(50 - lift / Math.SQRT2);
  });

  it('on a path of several roads: the middle of the whole path by length, on the road it falls on', () => {
    // Two levels of 100 and 300: the length is 400, the middle is 200 from the start, on the
    // second road (which goes down the screen), 100 along it.
    const path = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 300 },
    ];
    expect(pathLength(path)).toBe(400);
    const spot = etaSpot(path, none, box, 4);
    expect(spot?.x).toBeCloseTo(100 + 4 + 20);
    expect(spot?.y).toBeCloseTo(100);
  });

  it('slides off a city on the way, to the longer side of it', () => {
    // Two roads of 200 and 300 with a city of rim 30 between them: the middle (250) is on the
    // second road, 50 from the city, and the box of 40 needs 30 + 20 = 50: it stays.
    const path = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 300 },
    ];
    expect(etaSpot(path, none, box, 0, [0, 30, 0])?.y).toBeCloseTo(50);
    // Two roads of 200 and 220: the middle (210) is 10 past the city: it goes to 50 past it, on the longer road.
    const near = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 220 },
    ];
    expect(etaSpot(near, none, box, 0, [0, 30, 0])?.y).toBeCloseTo(50);
    // Mirrored, the longer road comes first: the label goes back along it.
    const back = [
      { x: 200, y: 220 },
      { x: 200, y: 0 },
      { x: 0, y: 0 },
    ];
    expect(etaSpot(back, none, box, 0, [0, 30, 0])?.y).toBeCloseTo(50);
    // Without the rims the middle is where it was.
    expect(etaSpot(near, none, box, 0)?.y).toBeCloseTo(10);
  });

  it('is the middle between the city rims, not between their centres', () => {
    const path = [
      { x: 0, y: 100 },
      { x: 200, y: 100 },
    ];
    // A rim of 10 at the start and 50 at the end: the stretch is 10..150, the middle is 80.
    const spot = etaSpot(path, { start: 10, end: 50 }, box, 0);
    expect(spot?.x).toBeCloseTo(80);
  });

  it('falls back to the whole path when the rims leave nothing between them', () => {
    const spot = etaSpot(
      [
        { x: 0, y: 100 },
        { x: 40, y: 100 },
      ],
      { start: 30, end: 30 },
      box,
      0,
    );
    expect(spot?.x).toBeCloseTo(20);
  });

  it('has no spot for a path with no length', () => {
    expect(etaSpot([], none, box, 5)).toBeNull();
    expect(etaSpot([{ x: 1, y: 1 }], none, box, 5)).toBeNull();
    expect(
      etaSpot(
        [
          { x: 1, y: 1 },
          { x: 1, y: 1 },
        ],
        none,
        box,
        5,
      ),
    ).toBeNull();
  });
});
