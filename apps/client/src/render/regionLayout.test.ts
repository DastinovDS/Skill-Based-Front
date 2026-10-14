import { describe, expect, it } from 'vitest';
import {
  cellEdges,
  clipToConvex,
  distanceToSegment,
  fogHatching,
  hatchInside,
  insideConvex,
  stampPoints,
  territoryBorders,
} from './regionLayout.ts';
import { BUNDLED_MAPS } from '../map/bundledMaps.ts';
import { voronoiCells } from './voronoi.ts';

const square = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

describe('insideConvex and distanceToSegment', () => {
  it('tells inside from outside for both orientations', () => {
    expect(insideConvex(square, { x: 50, y: 50 })).toBe(true);
    expect(insideConvex(square, { x: 150, y: 50 })).toBe(false);
    expect(insideConvex([...square].reverse(), { x: 50, y: 50 })).toBe(true);
  });

  it('measures the distance to a segment, also past its ends', () => {
    const s = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } };
    expect(distanceToSegment({ x: 5, y: 3 }, s)).toBe(3);
    expect(distanceToSegment({ x: 14, y: 3 }, s)).toBe(5);
  });
});

describe('stampPoints', () => {
  const grid = { width: 20, height: 20 };
  const centre = { x: 50, y: 50 };

  it('is the same on every call (no randomness)', () => {
    const a = stampPoints(square, grid, 3, centre, [], 30, 12);
    const b = stampPoints(square, grid, 3, centre, [], 30, 12);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(5);
  });

  it('stays inside the cell and away from the city and the roads', () => {
    const road = { a: { x: 0, y: 20 }, b: { x: 100, y: 20 } };
    for (const p of stampPoints(square, grid, 7, centre, [road], 30, 12)) {
      expect(insideConvex(square, p)).toBe(true);
      expect(Math.hypot(p.x - centre.x, p.y - centre.y)).toBeGreaterThanOrEqual(30);
      expect(distanceToSegment(p, road)).toBeGreaterThanOrEqual(12);
    }
  });

  it('shifts the grid with the id of the city', () => {
    const a = stampPoints(square, grid, 1, centre, [], 0, 0);
    const b = stampPoints(square, grid, 2, centre, [], 0, 0);
    expect(a).not.toEqual(b);
  });
});

describe('territoryBorders', () => {
  const cells = voronoiCells(
    [
      { x: 25, y: 50 },
      { x: 75, y: 50 },
    ],
    { width: 100, height: 100 },
  );

  it('draws the border only where owners differ, and not on the border of the map', () => {
    const borders = territoryBorders(cells, [0, 1], 1);
    expect(borders.filter((b) => b.owner === 0)).toHaveLength(1);
    expect(borders.filter((b) => b.owner === 1)).toHaveLength(1);
    const own = borders.find((b) => b.owner === 0);
    // Moved into the own cell (x < 50), not onto the shared edge.
    expect(own?.a.x).toBeCloseTo(49);
  });

  it('draws nothing inside one area and nothing for a neutral cell', () => {
    expect(territoryBorders(cells, [0, 0], 1)).toEqual([]);
    expect(territoryBorders(cells, [null, 1], 1).every((b) => b.owner === 1)).toBe(true);
  });

  it('finds the neighbour of an edge', () => {
    const edges = cellEdges(cells);
    expect(edges.filter((e) => e.neighbour !== null)).toHaveLength(2);
  });
});

describe('cellEdges: the neighbour across an edge', () => {
  it('matches corners that differ in the last bits, also on a rounding boundary of a hundredth', () => {
    // 408.125 * 100 is exactly x.5: rounding to a grid sent two results of one corner to
    // different keys, the edge lost its neighbour and the border of the territory a piece.
    const cells = [
      [
        { x: 0, y: 0 },
        { x: 415, y: 408.125 },
        { x: 300, y: 500 },
      ],
      [
        { x: 414.99999999999994, y: 408.1249999999999 },
        { x: 300.00000000000006, y: 500 },
        { x: 500, y: 0 },
      ],
    ];
    const shared = cellEdges(cells).filter((e) => e.neighbour !== null);
    expect(shared.map((e) => [e.cell, e.neighbour])).toEqual([
      [0, 1],
      [1, 0],
    ]);
  });

  it('drops an edge that collapsed to a point, and gives the same answer for the same cells', () => {
    const cells = [
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ],
    ];
    expect(cellEdges(cells)).toHaveLength(3);
    expect(cellEdges(cells)).toBe(cellEdges(cells));
  });

  it.each(BUNDLED_MAPS.map((map) => [map.meta.name, map] as const))(
    'finds a neighbour for every inner edge of the map %s, and the pairs are mutual',
    (_name, map) => {
      const { width, height } = map.meta;
      const edges = cellEdges(voronoiCells(map.nodes, { width, height }));
      const near = (value: number, line: number): boolean => Math.abs(value - line) < 1e-6;
      const onFrame = (e: (typeof edges)[number]): boolean =>
        (near(e.a.x, 0) && near(e.b.x, 0)) ||
        (near(e.a.x, width) && near(e.b.x, width)) ||
        (near(e.a.y, 0) && near(e.b.y, 0)) ||
        (near(e.a.y, height) && near(e.b.y, height));
      expect(edges.filter((e) => e.neighbour === null && !onFrame(e))).toEqual([]);
      for (const e of edges) {
        if (e.neighbour === null) continue;
        expect(edges.some((f) => f.cell === e.neighbour && f.neighbour === e.cell)).toBe(true);
      }
    },
  );
});

describe('fog hatching', () => {
  it('clips a polygon to a convex one', () => {
    const half = clipToConvex(square, [
      { x: 50, y: -10 },
      { x: 150, y: -10 },
      { x: 150, y: 110 },
      { x: 50, y: 110 },
    ]);
    expect(half.every((p) => p.x >= 49.999)).toBe(true);
  });

  it('hatches at 45 degrees inside the polygon', () => {
    const lines = hatchInside(square, 20);
    expect(lines.length).toBeGreaterThan(4);
    for (const { a, b } of lines) {
      expect(a.x + a.y).toBeCloseTo(b.x + b.y);
      expect(insideConvex(square, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })).toBe(true);
    }
  });

  it('hatches only a band along the border of the seen area', () => {
    const cells = voronoiCells(
      [
        { x: 25, y: 50 },
        { x: 75, y: 50 },
      ],
      { width: 100, height: 100 },
    );
    const lines = fogHatching(cells, [false, true], 20, 5);
    expect(lines.length).toBeGreaterThan(3);
    for (const { a, b } of lines) {
      expect(Math.min(a.x, b.x)).toBeGreaterThanOrEqual(49.99);
      expect(Math.max(a.x, b.x)).toBeLessThanOrEqual(70.01);
    }
    expect(fogHatching(cells, [true, true], 20, 5)).toEqual([]);
    expect(fogHatching(cells, [false, false], 20, 5)).toEqual([]);
  });
});
