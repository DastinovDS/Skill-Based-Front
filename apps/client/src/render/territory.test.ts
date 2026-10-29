import { describe, expect, it } from 'vitest';
import { GEO_FILE, GEO_MAP } from './geoFixture.ts';
import { territoryBorders } from './regionLayout.ts';
import { areaAt, geoTerritory, insidePolygon, territoryOf, voronoiTerritory } from './territory.ts';
import { polygonArea } from './voronoi.ts';

const territory = geoTerritory(GEO_MAP, GEO_FILE);

describe('geoTerritory', () => {
  it('makes one closed polygon per node from the shared chains', () => {
    expect(territory?.convex).toBe(false);
    // Area 0: 90 x 60 + 100 x 40 minus nothing = 5400 + 4000 - the notch (10 x 40 is in the 100 wide part).
    // Area 0 is x 0..90 for y 0..60 and x 0..100 for y 60..100: 5400 + 4000.
    expect(polygonArea(territory?.cells[0] ?? [])).toBe(9400);
    // Area 1 is x 110..200 for y 0..60 and x 100..200 for y 60..100: 5400 + 4000.
    expect(polygonArea(territory?.cells[1] ?? [])).toBe(9400);
  });

  it('holds exactly the land: the river and the strip are in no area', () => {
    const cells = territory?.cells ?? [];
    expect(areaAt(cells, { x: 45, y: 50 })).toBe(0);
    expect(areaAt(cells, { x: 155, y: 50 })).toBe(1);
    expect(areaAt(cells, { x: 100, y: 30 })).toBeNull(); // in the river
    expect(areaAt(cells, { x: 95, y: 80 })).toBe(0); // beside the road, west of the contact
    expect(areaAt(cells, { x: 105, y: 80 })).toBe(1);
    expect(areaAt(cells, { x: 300, y: 50 })).toBeNull();
  });

  it('has the land border once per side, a river bank looks across the river', () => {
    const edges = territory?.edges ?? [];
    const land = edges.filter((e) => e.neighbour !== null && e.water !== true);
    expect(land.map((e) => [e.cell, e.neighbour]).sort()).toEqual([
      [0, 1],
      [1, 0],
    ]);
    const banks = edges.filter((e) => e.water === true);
    expect(banks.length).toBeGreaterThan(0);
    // Across the river from area 0 lies area 1 and the other way round; the end of the river
    // (the stretch at y = 60) has no area across it: a shore.
    const across = (cell: number, vertical: boolean) =>
      new Set(
        banks
          .filter((e) => e.cell === cell && (e.a.y === e.b.y) !== vertical)
          .map((e) => e.neighbour),
      );
    expect(across(0, true)).toEqual(new Set([1]));
    expect(across(1, true)).toEqual(new Set([0]));
    expect(across(0, false)).toEqual(new Set([null]));
  });

  it('has the inward normal on the side of the area', () => {
    for (const e of territory?.edges ?? []) {
      const mid = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
      const inside = { x: mid.x + (e.inward?.x ?? 0) * 0.5, y: mid.y + (e.inward?.y ?? 0) * 0.5 };
      expect(insidePolygon(territory?.cells[e.cell] ?? [], inside)).toBe(true);
    }
  });
});

describe('territoryBorders on a geography', () => {
  const run = (owners: (0 | 1 | null)[]) =>
    territoryBorders(territory?.cells ?? [], owners, 1.5, territory?.edges);
  const length = (list: { a: { x: number; y: number }; b: { x: number; y: number } }[]) =>
    list.reduce((sum, { a, b }) => sum + Math.hypot(b.x - a.x, b.y - a.y), 0);

  it('does not run along a river between two areas of one owner', () => {
    const borders = run([0, 0]);
    // The long banks (x = 90 and 110) and the contact are not a border; what is left is the shore
    // at the end of the river (y = 60), 10 units on each side.
    expect(borders.every((b) => b.a.y === b.b.y && Math.abs(b.a.y - 61.5) < 1e-9)).toBe(true);
    expect(length(borders)).toBeCloseTo(20);
  });

  it('runs along both banks and the contact between two owners, each on its own side', () => {
    const borders = run([0, 1]);
    // West: bank x = 90 (60) + the notch (10) + contact (40); east: x = 110 (60) + 10 + 40.
    expect(length(borders.filter((b) => b.owner === 0))).toBeCloseTo(110);
    expect(length(borders.filter((b) => b.owner === 1))).toBeCloseTo(110);
    // The owner's line is inside its own land.
    for (const b of borders) {
      const mid = { x: (b.a.x + b.b.x) / 2, y: (b.a.y + b.b.y) / 2 };
      expect(areaAt(territory?.cells ?? [], mid)).toBe(b.owner);
    }
  });

  it('runs along a coast where the territory ends at water', () => {
    const sea = territoryOf(GEO_MAP, {
      ...GEO_FILE,
      chains: GEO_FILE.chains.map((c) =>
        c.l === -1 && c.r === 0 && c.pts[1] === 0 ? { ...c, l: 'w0' } : c,
      ),
    });
    const borders = territoryBorders(sea.cells, [0, null], 0, sea.edges);
    // The top of area 0 (90 units) is now a coast.
    expect(borders.filter((b) => b.a.y === 0 && b.b.y === 0).length).toBeGreaterThan(0);
    // The map border stays no border.
    expect(borders.some((b) => b.a.x === 0 && b.b.x === 0)).toBe(false);
  });
});

describe('territoryOf', () => {
  it('falls back to the Voronoi cells without a file', () => {
    const t = territoryOf(GEO_MAP, null);
    expect(t.convex).toBe(true);
    expect(t.cells).toEqual(voronoiTerritory(GEO_MAP).cells);
  });

  it('falls back when the chains do not close', () => {
    const open = { ...GEO_FILE, chains: GEO_FILE.chains.slice(1) };
    expect(territoryOf(GEO_MAP, open).convex).toBe(true);
  });

  it('falls back when a chain names a node the map does not have', () => {
    const foreign = {
      ...GEO_FILE,
      chains: [...GEO_FILE.chains, { l: 7, r: -1, pts: [0, 0, 1, 1] }],
    };
    expect(territoryOf(GEO_MAP, foreign).convex).toBe(true);
  });
});

describe('a lake inside an area', () => {
  // Area 0 is the whole 100 x 100 map with a lake (a square from 40 to 60) inside it.
  const map = {
    meta: { name: 'lake', version: 1, symmetry: 'rot180', width: 100, height: 100 },
    nodes: [{ id: 0, name: 'Only', x: 10, y: 10, terrain: 'plains' }],
    edges: [],
  } as unknown as typeof GEO_MAP;
  const geo = {
    map: 'lake',
    version: 1,
    chains: [
      { l: -1, r: 0, pts: [0, 0, 100, 0, 100, 100, 0, 100, 0, 0] },
      { l: 'w0', r: 0, pts: [40, 40, 40, 60, 60, 60, 60, 40, 40, 40] },
    ],
  };

  it('is cut out of the polygon, and a point in it belongs to no area', () => {
    const t = geoTerritory(map, geo);
    const cell = t?.cells[0] ?? [];
    expect(areaAt([cell], { x: 10, y: 10 })).toBe(0);
    expect(areaAt([cell], { x: 50, y: 50 })).toBeNull();
    expect(areaAt([cell], { x: 70, y: 50 })).toBe(0);
    expect(t?.edges.filter((e) => e.water === true && e.neighbour === null)).toHaveLength(4);
  });
});
