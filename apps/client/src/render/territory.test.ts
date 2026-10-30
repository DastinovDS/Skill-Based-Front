import { describe, expect, it } from 'vitest';
import { GEO_FILE, GEO_MAP } from './geoFixture.ts';
import { territoryBorders } from './regionLayout.ts';
import { usableGeo } from '../map/geography.ts';
import type { MapFile } from '../protocol.gen.ts';
import {
  areaAt,
  geoTerritory,
  insidePolygon,
  smoothChain,
  steadyBank,
  territoryOf,
  voronoiTerritory,
} from './territory.ts';
import { polygonArea } from './voronoi.ts';

const territory = geoTerritory(GEO_MAP, GEO_FILE);

describe('geoTerritory', () => {
  it('makes one closed polygon per node from the shared chains', () => {
    expect(territory?.convex).toBe(false);
    // Area 0 is x 0..90 for y 0..60 and x 0..100 for y 60..100: 5400 + 4000; area 1 the mirror.
    // The end of the river is rounded off (#585), the same on both sides: a little more land.
    const west = polygonArea(territory?.cells[0] ?? []);
    expect(west).toBeGreaterThan(9400);
    expect(west).toBeLessThan(9400 * 1.01);
    expect(polygonArea(territory?.cells[1] ?? [])).toBeCloseTo(west, 6);
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
    // Across the river from area 0 lies area 1 and the other way round, all along the bank: the
    // rounded end of the river too (a short run of another answer would be a loose stub, #585).
    const across = (cell: number) =>
      new Set(banks.filter((e) => e.cell === cell).map((e) => e.neighbour));
    expect(across(0)).toEqual(new Set([1]));
    expect(across(1)).toEqual(new Set([0]));
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
    // Neither the banks, nor the end of the river, nor the contact is a border.
    expect(run([0, 0])).toEqual([]);
  });

  it('runs along both banks and the contact between two owners, each on its own side', () => {
    const borders = run([0, 1]);
    // West: bank x = 90 (60) + the end of the river (10) + contact (40), its corner rounded off
    // (#585); east the same.
    const west = length(borders.filter((b) => b.owner === 0));
    expect(west).toBeGreaterThan(95);
    expect(west).toBeLessThan(110);
    expect(length(borders.filter((b) => b.owner === 1))).toBeCloseTo(west, 6);
    // The owner's line is inside its own land.
    for (const b of borders) {
      const mid = { x: (b.a.x + b.b.x) / 2, y: (b.a.y + b.b.y) / 2 };
      expect(areaAt(territory?.cells ?? [], mid)).toBe(b.owner);
    }
  });

  it('is one unbroken line: the moved segments meet at their corners (#585)', () => {
    for (const owner of [0, 1]) {
      const own = run([0, 1]).filter((b) => b.owner === owner);
      const ends = new Map<string, number>();
      for (const { a, b } of own) {
        for (const p of [a, b]) {
          const key = `${p.x.toFixed(9)},${p.y.toFixed(9)}`;
          ends.set(key, (ends.get(key) ?? 0) + 1);
        }
      }
      // Every corner is shared by two segments; only the two ends of the line are loose.
      expect([...ends.values()].filter((n) => n === 1).length).toBe(2);
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
    const top = borders.filter((b) => Math.abs(b.a.y) < 0.5 && Math.abs(b.b.y) < 0.5);
    expect(length(top)).toBeGreaterThan(60);
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
    // The shore of the lake is smoothed: more than its four sides, every one looking at water.
    const shore = t?.edges.filter((e) => e.water === true && e.neighbour === null) ?? [];
    expect(shore.length).toBeGreaterThanOrEqual(4);
    expect(shore.every((e) => e.a.x >= 40 && e.a.x <= 60 && e.a.y >= 40 && e.a.y <= 60)).toBe(true);
  });
});

describe('smoothChain (#585)', () => {
  const pts = (flat: number[]) => {
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i] ?? 0, y: flat[i + 1] ?? 0 });
    return out;
  };
  // A diagonal staircase of the 4-unit label grid, the way the baker traces it.
  const stairs = pts(
    Array.from({ length: 21 }, (_, k) => [4 * Math.ceil(k / 2), 4 * Math.floor(k / 2)]).flat(),
  );

  it('keeps the ends of an open chain exactly', () => {
    const line = smoothChain(stairs, false);
    expect(line[0]).toEqual(stairs[0]);
    expect(line[line.length - 1]).toEqual(stairs[stairs.length - 1]);
  });

  it('keeps a straight chain straight', () => {
    expect(smoothChain(pts([0, 60, 50, 60, 100, 60]), false)).toEqual(pts([0, 60, 100, 60]));
  });

  it('turns the stairs into a line with no corner and moves it only a little', () => {
    const line = smoothChain(stairs, false);
    for (let i = 1; i + 1 < line.length; i++) {
      const a = line[i - 1] ?? { x: 0, y: 0 };
      const b = line[i] ?? { x: 0, y: 0 };
      const c = line[i + 1] ?? { x: 0, y: 0 };
      const turn = Math.abs(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x));
      expect(turn).toBeLessThan(Math.PI / 12);
    }
    // Every point stays within the stairs' own amplitude of the diagonal y = x - 2.
    for (const p of line) expect(Math.abs(p.x - p.y - 2) / Math.SQRT2).toBeLessThan(2.9);
  });

  it('smooths a closed loop round and closes it again', () => {
    const square = pts([40, 40, 40, 60, 60, 60, 60, 40, 40, 40]);
    const loop = smoothChain(square, true);
    expect(loop[0]).toEqual(loop[loop.length - 1]);
    expect(loop.length).toBeGreaterThan(8);
  });
});

describe('steadyBank (#585)', () => {
  const edge = (x: number, neighbour: number | null) => ({
    edge: {
      cell: 0,
      a: { x, y: 0 },
      b: { x: x + 4, y: 0 },
      neighbour,
      water: true,
      inward: { x: 0, y: 1 },
    },
    length: 4,
  });

  it('gives a short run the area across of its longer neighbour', () => {
    const bank = [
      ...Array.from({ length: 20 }, (_, k) => edge(4 * k, 1)),
      edge(80, null), // one look across missed the far bank: a loose stub
      ...Array.from({ length: 5 }, (_, k) => edge(84 + 4 * k, 2)),
      ...Array.from({ length: 15 }, (_, k) => edge(104 + 4 * k, 3)),
    ];
    const across = steadyBank(bank).map((e) => e.neighbour);
    // Then the run of 2 (20 units) joins the longer of its neighbours, the run of 1.
    expect(across).toEqual([...Array<number>(26).fill(1), ...Array<number>(15).fill(3)]);
  });

  it('keeps a bank of one answer as it is', () => {
    const bank = [edge(0, null), edge(4, null)];
    expect(steadyBank(bank).map((e) => e.neighbour)).toEqual([null, null]);
  });
});

describe('the pool maps with a geography (#585)', () => {
  const maps = import.meta.glob<MapFile>('../../../../maps/*.json', {
    eager: true,
    import: 'default',
  });
  const geos = import.meta.glob<unknown>('../../../../maps/geo/*.json', {
    eager: true,
    import: 'default',
  });
  const pool = Object.entries(geos).map(([path, raw]) => {
    const name = path.split('/').pop() ?? '';
    const map = Object.entries(maps).find(([p]) => p.endsWith(`/${name}`))?.[1];
    return { name, map, geo: map === undefined ? null : usableGeo(map, raw) };
  });

  it('are all found', () => {
    expect(pool.length).toBeGreaterThanOrEqual(3);
    for (const { map, geo } of pool) expect(map !== undefined && geo !== null).toBe(true);
  });

  for (const { name, map, geo } of pool) {
    if (map === undefined || geo === null) continue;
    const t = geoTerritory(map, geo);

    it(`${name}: every node lies in its own area`, () => {
      expect(t).not.toBeNull();
      for (const node of map.nodes) expect(areaAt(t?.cells ?? [], node)).toBe(node.id);
    });

    it(`${name}: two land areas share exactly the same border`, () => {
      const edges = t?.edges ?? [];
      const key = (cell: number, a: { x: number; y: number }, b: { x: number; y: number }) =>
        `${String(cell)}:${String(a.x)},${String(a.y)}>${String(b.x)},${String(b.y)}`;
      const all = new Set(edges.map((e) => key(e.cell, e.a, e.b)));
      const land = edges.filter((e) => e.neighbour !== null && e.water !== true);
      expect(land.length).toBeGreaterThan(0);
      for (const e of land) expect(all.has(key(e.neighbour ?? -1, e.b, e.a))).toBe(true);
    });

    it(`${name}: no point lies in two areas`, () => {
      const cells = t?.cells ?? [];
      for (let y = 2; y < map.meta.height; y += 12) {
        for (let x = 2; x < map.meta.width; x += 12) {
          const p = { x, y };
          expect(cells.filter((cell) => insidePolygon(cell, p)).length).toBeLessThanOrEqual(1);
        }
      }
    });
  }
});

describe('a stream cut into one area (#585)', () => {
  // Area 0 is the whole 100 x 100 map; a stream comes in from the top edge (x 40..60) and ends at
  // y = 50, with area 0 on both of its banks.
  const map = {
    meta: { name: 'inlet', version: 1, symmetry: 'rot180', width: 100, height: 100 },
    nodes: [{ id: 0, name: 'Only', x: 50, y: 80, terrain: 'plains' }],
    edges: [],
  } as unknown as typeof GEO_MAP;
  const geo = {
    map: 'inlet',
    version: 1,
    chains: [
      { l: -1, r: 0, pts: [0, 0, 40, 0] },
      { l: -1, r: 'river', pts: [40, 0, 60, 0] },
      { l: -1, r: 0, pts: [60, 0, 100, 0, 100, 100, 0, 100, 0, 0] },
      { l: 0, r: 'river', pts: [60, 0, 60, 50, 40, 50, 40, 0] },
    ],
  };

  it('is no coast: the banks look across at their own area, and no owner border runs there', () => {
    const t = geoTerritory(map, geo);
    const banks = t?.edges.filter((e) => e.water === true) ?? [];
    expect(banks.length).toBeGreaterThan(0);
    expect(new Set(banks.map((e) => e.neighbour))).toEqual(new Set([0]));
    expect(territoryBorders(t?.cells ?? [], [0], 1.5, t?.edges)).toEqual([]);
  });
});
