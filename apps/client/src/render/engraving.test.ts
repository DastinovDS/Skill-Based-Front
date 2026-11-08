import { describe, expect, it } from 'vitest';
import type { Point } from './camera.ts';
import {
  BORDER_BAND,
  TILE_HEIGHT,
  bandStrips,
  hairFloor,
  hairWidth,
  hatchBucket,
  hatchRows,
  pointsAlong,
  sightEdge,
  withInward,
} from './engraving.ts';
import { cellEdges } from './regionLayout.ts';

// The Engraved map treatment (#829, #842): the numbers come from the mockups
// (in-game-style-r2.html `hatch`, `hair`; -r3.html topics n and o).

describe('hatchBucket: the hatch keeps its screen pitch in zoom buckets of a power of two', () => {
  it('scales with the map inside a bucket and halves its world pitch in the next one', () => {
    expect(hatchBucket(3.2, 1)).toEqual({ bucket: 0, pitch: 3.2, fade: 0 });
    expect(hatchBucket(3.2, 2).pitch).toBeCloseTo(1.6);
    expect(hatchBucket(3.2, 0.5).pitch).toBeCloseTo(6.4);
    // The screen pitch of the main lines stays between `pitch` and twice that.
    for (const zoom of [0.3, 0.7, 1, 1.4, 1.9, 2.6, 3.9]) {
      const { pitch } = hatchBucket(3.2, zoom);
      expect(pitch * zoom).toBeGreaterThanOrEqual(3.2 - 1e-9);
      expect(pitch * zoom).toBeLessThan(6.4);
    }
  });

  it('fades the lines in between in towards the next bucket, so the pitch halves without a jump', () => {
    expect(hatchBucket(3.2, 2 ** 0.2).fade).toBe(0);
    expect(hatchBucket(3.2, 2 ** 0.6).fade).toBeGreaterThan(0);
    expect(hatchBucket(3.2, 2 ** 0.6).fade).toBeLessThan(1);
    expect(hatchBucket(3.2, 2 ** 0.95).fade).toBe(1);
    // Just under a power of two every line in between is in: the lines on screen are `pitch / 2`
    // apart, as just over it, where they are the main lines of the next bucket.
    const below = hatchBucket(3.2, 1.999);
    const above = hatchBucket(3.2, 2.001);
    expect((below.pitch / 2) * 1.999).toBeCloseTo(above.pitch * 2.001, 2);
  });
});

describe('hatchRows: one pitch of the hatch tile', () => {
  it('draws the main line in the middle and the line in between on the seam, at its fade', () => {
    const rows = hatchRows(16, 1, 0.5);
    expect(rows[7]).toBeCloseTo(0.5);
    expect(rows[8]).toBeCloseTo(0.5);
    expect(rows[0]).toBeCloseTo(0.25);
    expect(rows[15]).toBeCloseTo(0.25);
    expect(rows[4]).toBe(0);
    // The cover sums to the width of the main line plus the faded line in between.
    expect(rows.reduce((a, b) => a + b, 0)).toBeCloseTo(1 + 0.5);
  });

  it('leaves the lines in between out at fade 0', () => {
    const rows = hatchRows(TILE_HEIGHT, 2.5, 0);
    expect(rows[0]).toBe(0);
    expect(rows.reduce((a, b) => a + b, 0)).toBeCloseTo(2.5);
  });
});

describe('hairWidth and hairFloor: a stroke never thinner than one device pixel', () => {
  it('keeps the width when it is wide enough and floors it at one device pixel', () => {
    expect(hairWidth(1.1, 2, 1)).toBe(1.1);
    expect(hairWidth(1.1, 0.5, 1)).toBe(2);
    expect(hairWidth(1.1, 0.5, 2)).toBe(1.1);
  });

  it('rounds the floor up to a quarter octave, never below the exact pixel', () => {
    for (const zoom of [0.37, 0.5, 0.81, 1, 1.3, 2.2]) {
      const exact = 1 / zoom;
      expect(hairFloor(zoom, 1)).toBeGreaterThanOrEqual(exact - 1e-9);
      expect(hairFloor(zoom, 1)).toBeLessThan(exact * 2 ** 0.25 + 1e-9);
    }
    // A small change of the zoom keeps the same floor: the lines are not redrawn for it.
    expect(hairFloor(0.46, 1)).toBe(hairFloor(0.45, 1));
  });
});

/** Two areas side by side: 0 on the left of x = 100, 1 on the right, 200 x 100. */
const cells: Point[][] = [
  [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ],
  [
    { x: 100, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 100 },
    { x: 100, y: 100 },
  ],
];
const edges = withInward(cells, cellEdges(cells));

describe('bandStrips: the Border band inside each owner land border', () => {
  it('lays a strip `depth` deep on each side of a border between two owners', () => {
    const strips = bandStrips(cells, [0, 1], edges, BORDER_BAND.depth);
    expect(strips.map((s) => s.owner).sort()).toEqual([0, 1]);
    const own = strips.find((s) => s.owner === 0);
    const xs = (own?.points ?? []).map((p) => p.x).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(100 - BORDER_BAND.depth);
    expect(xs[3]).toBeCloseTo(100);
  });

  it('has no strip between areas of one owner, nor along a coast', () => {
    expect(bandStrips(cells, [0, 0], edges, BORDER_BAND.depth)).toEqual([]);
    const coast = edges.map((e) =>
      e.neighbour === null ? e : { ...e, neighbour: null, water: true },
    );
    expect(bandStrips(cells, [0, 1], coast, BORDER_BAND.depth)).toEqual([]);
  });
});

describe('pointsAlong', () => {
  it('carries the distance over joined segments and starts afresh after a gap', () => {
    const joined = [
      { a: { x: 0, y: 0 }, b: { x: 4, y: 0 } },
      { a: { x: 4, y: 0 }, b: { x: 10, y: 0 } },
    ];
    expect(pointsAlong(joined, 3, 1).map((p) => p.at.x)).toEqual([1, 4, 7, 10]);
    const apart = [joined[0], { a: { x: 20, y: 0 }, b: { x: 26, y: 0 } }] as typeof joined;
    expect(pointsAlong(apart, 3, 1).map((p) => p.at.x)).toEqual([1, 4, 21, 24]);
    expect(pointsAlong(apart, 3, 1).map((p) => p.index)).toEqual([0, 0, 1, 1]);
  });
});

describe('sightEdge: the edge of sight between a hidden area and a seen one', () => {
  it('runs along the land border, on the hidden side', () => {
    const edge = sightEdge(cells, new Set([1]), edges, 2);
    expect(edge).toHaveLength(1);
    expect(edge[0]?.cell).toBe(1);
    expect(edge[0]?.a.x).toBeCloseTo(102);
    expect(sightEdge(cells, new Set([0, 1]), edges, 2)).toEqual([]);
    expect(sightEdge(cells, new Set(), edges, 2)).toEqual([]);
  });
});
