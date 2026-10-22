import { describe, expect, it } from 'vitest';
import type { MapFile } from '../protocol.gen.ts';
import {
  ageLabel,
  borderPermille,
  borderPoint,
  ghostAlpha,
  sameVeil,
  veilCities,
  veilFrontier,
  veilPolygon,
} from './fogLayout.ts';
import { voronoiCells } from './voronoi.ts';

/** Two nodes 1000 apart on the x axis and one road between them (#366). */
function line(border: number | undefined): MapFile {
  const node = (id: number, x: number): MapFile['nodes'][number] => ({
    id,
    name: `n${String(id)}`,
    x,
    y: 0,
    terrain: 'plains',
    vp: 1,
    kind: 'capital',
    capital_of: id === 0 ? 0 : 1,
    start_owner: id === 0 ? 0 : 1,
    start_units: 0,
    start_charged: 0,
    start_stock: 0,
  });
  const edge = { id: 0, a: 0, b: 1, max_level: 1, travel_ticks: 300, border_permille: border };
  return {
    meta: { name: 'line', version: 1, symmetry: 'rot180', width: 1000, height: 10 },
    nodes: [node(0, 0), node(1, 1000)],
    edges: [edge as MapFile['edges'][number]],
    mirror: { nodes: { '0': 1, '1': 0 }, edges: { '0': 0 } },
  };
}

describe('border point (DEC-23, item 5; #366)', () => {
  it('comes from border_permille of the map edge, thousandths from the end a', () => {
    expect(borderPermille(line(300), 0)).toBe(300);
    expect(borderPoint(line(300), 0)?.x).toBeCloseTo(300);
  });

  it('is the middle for a map without the field (an old replay frames file)', () => {
    expect(borderPermille(line(undefined), 0)).toBe(500);
    expect(borderPoint(line(undefined), 0)?.x).toBeCloseTo(500);
  });
});

describe('ageLabel', () => {
  it('shows minutes and seconds since the sighting', () => {
    expect(ageLabel(210, 10)).toBe('-0:21');
    expect(ageLabel(0, 10)).toBe('-0:00');
    expect(ageLabel(1250, 10)).toBe('-2:05');
  });

  it('treats a sighting from the future as just now', () => {
    expect(ageLabel(-30, 10)).toBe('-0:00');
  });

  it('does not divide by a zero tick rate', () => {
    expect(ageLabel(100, 0)).toBe('-0:00');
  });
});

describe('ghostAlpha (9.8)', () => {
  it('stays at 0.6 for the first minute, fades linearly, and is gone after two minutes', () => {
    expect(ghostAlpha(0)).toBe(0.6);
    expect(ghostAlpha(60)).toBe(0.6);
    expect(ghostAlpha(90)).toBeCloseTo(0.3);
    expect(ghostAlpha(119)).toBeGreaterThan(0);
    expect(ghostAlpha(119)).toBeLessThan(0.02);
    expect(ghostAlpha(120)).toBe(0);
    expect(ghostAlpha(500)).toBe(0);
  });
});

describe('veilCities (the haze F1)', () => {
  const node = (id: number, detail: 'fog' | 'presence' | 'range' | 'exact') => ({ id, detail });

  it('takes the cities whose detail is fog, by id, and nothing else', () => {
    const nodes = [node(3, 'fog'), node(0, 'exact'), node(2, 'fog'), node(1, 'presence')];
    expect(veilCities(nodes)).toEqual([2, 3]);
  });

  it('is empty when every city is in sight', () => {
    expect(veilCities([node(0, 'exact'), node(1, 'range')])).toEqual([]);
  });

  it('does not look at the memory: a remembered city and one never seen are the same cell', () => {
    const remembered = { ...node(1, 'fog'), seen: { tick: 5 } };
    const unknown = { ...node(1, 'fog'), seen: null };
    expect(veilCities([remembered])).toEqual(veilCities([unknown]));
  });
});

describe('sameVeil', () => {
  it('is true for the same cities in the same order, false for any other set', () => {
    expect(sameVeil([1, 2], [1, 2])).toBe(true);
    expect(sameVeil([], [])).toBe(true);
    expect(sameVeil([1, 2], [1, 3])).toBe(false);
    expect(sameVeil([1, 2], [1, 2, 3])).toBe(false);
  });
});

describe('veilPolygon', () => {
  const bounds = { width: 100, height: 60 };

  it('pushes the vertices on the edge of the map outward and leaves the inner ones', () => {
    const cell = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 60, y: 30 },
      { x: 0, y: 60 },
    ];
    expect(veilPolygon(cell, bounds, 10)).toEqual([
      { x: -10, y: -10 },
      { x: 50, y: -10 },
      { x: 60, y: 30 },
      { x: -10, y: 70 },
    ]);
  });

  it('moves the far edges outward too and keeps the vertex count', () => {
    const cell = [
      { x: 100, y: 10 },
      { x: 100, y: 60 },
      { x: 40, y: 60 },
    ];
    const out = veilPolygon(cell, bounds, 5);
    expect(out).toEqual([
      { x: 105, y: 10 },
      { x: 105, y: 65 },
      { x: 40, y: 65 },
    ]);
  });
});

describe('veilFrontier', () => {
  // Two cities side by side on a 100 x 100 map: the front is the one edge between their cells.
  const cells = voronoiCells(
    [
      { x: 25, y: 50 },
      { x: 75, y: 50 },
    ],
    { width: 100, height: 100 },
  );

  it('is the edge between a hidden city and one in sight, once', () => {
    const front = veilFrontier(cells, [1]);
    expect(front).toHaveLength(1);
    for (const end of [front[0]?.a, front[0]?.b]) expect(end?.x).toBeCloseTo(50);
  });

  it('is the same edge whichever side is hidden, and empty when both or none are', () => {
    expect(veilFrontier(cells, [0])).toHaveLength(1);
    expect(veilFrontier(cells, [0, 1])).toEqual([]);
    expect(veilFrontier(cells, [])).toEqual([]);
  });

  it('does not mark the border of the map as a front', () => {
    const front = veilFrontier(cells, [1]);
    expect(front.every((s) => s.a.x > 1 && s.a.x < 99)).toBe(true);
  });
});
