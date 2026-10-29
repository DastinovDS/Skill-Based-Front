import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { CityIcon } from './cityStacks.ts';
import type { TokenSpot } from './layout.ts';
import { NODE_HIT_SLACK, cellAt, pickAt, segmentDistance } from './pick.ts';
import { GEO_FILE, GEO_MAP } from './geoFixture.ts';
import { geoTerritory, voronoiTerritory } from './territory.ts';
import { voronoiCells } from './voronoi.ts';
import { NODE_RADIUS } from './style.ts';

const map = DEFAULT_MAP;
const node = map.nodes[1] ?? map.nodes[0];
if (node === undefined) throw new Error('the default map has no nodes');
const at = { x: node.x, y: node.y };
const NONE = new Map<string, TokenSpot>();
const spot = (x: number, y: number, side = 24, scale = 1): TokenSpot => ({ x, y, side, scale });

describe('pickAt, size of the click area of a group', () => {
  // Away from the city circle, so only the token can be hit.
  const off = (dx: number): { x: number; y: number } => ({ x: at.x + dx, y: at.y - 200 });
  const lonely = new Map([['g', spot(at.x, at.y - 200, 24)]]);

  it('is at least 28 px on screen when zoomed out', () => {
    // Scale 0.5: the triangle is drawn 40 world units wide (20 px), the click area 56 (28 px).
    expect(pickAt(map, off(27), { groups: lonely }, 0.5)).toEqual({ kind: 'group', id: 'g' });
    expect(pickAt(map, off(29), { groups: lonely }, 0.5)?.kind).not.toBe('group');
  });

  it('is the drawn size when zoomed in', () => {
    expect(pickAt(map, off(11), { groups: lonely }, 4)).toEqual({ kind: 'group', id: 'g' });
    expect(pickAt(map, off(13), { groups: lonely }, 4)?.kind).not.toBe('group');
  });
});

describe('pickAt', () => {
  it('hits a node inside its circle and within the slack', () => {
    expect(pickAt(map, at, { groups: NONE })).toEqual({ kind: 'node', id: node.id });
    const near = { x: at.x + NODE_RADIUS + NODE_HIT_SLACK - 1, y: at.y };
    expect(pickAt(map, near, { groups: NONE })).toEqual({ kind: 'node', id: node.id });
  });

  it('hits nothing on the empty map', () => {
    const far = { x: at.x + 1000, y: at.y + 1000 };
    expect(pickAt(map, far, { groups: NONE })).toBeNull();
  });

  it('prefers a group token over the node under it, and the last drawn of two', () => {
    const tokens = new Map([
      ['a', spot(at.x, at.y)],
      ['b', spot(at.x + 5, at.y)],
    ]);
    expect(pickAt(map, at, { groups: tokens })).toEqual({ kind: 'group', id: 'b' });
    const edge = { x: at.x - 14 - 1, y: at.y };
    expect(pickAt(map, edge, { groups: tokens })?.kind).not.toBe('group');
  });

  it('hits a road away from any city, and prefers the city near its end', () => {
    const edge = map.edges[0];
    const a = edge === undefined ? undefined : map.nodes[edge.a];
    const b = edge === undefined ? undefined : map.nodes[edge.b];
    if (edge === undefined || a === undefined || b === undefined) throw new Error('no roads');
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    expect(pickAt(map, middle, { groups: NONE })).toEqual({ kind: 'edge', id: edge.id });
    expect(pickAt(map, { x: a.x, y: a.y }, { groups: NONE })).toEqual({ kind: 'node', id: a.id });
    expect(segmentDistance(middle, a, b)).toBeCloseTo(0);
  });
});

describe('pickAt, units in a city and the area of a city', () => {
  const icon = (ids: string[]): CityIcon => ({
    node: node.id,
    owner: 0,
    ids,
    units: ids.length,
    charged: 0,
    modes: ['attack'],
    defense: null,
    spot: spot(at.x, at.y, 24),
  });

  it('a click on the icon of one group is that group, tagged with its city', () => {
    expect(pickAt(map, at, { groups: NONE, icons: [icon(['g'])] })).toEqual({
      kind: 'group',
      id: 'g',
      node: node.id,
    });
  });

  it('a click on the icon of several groups is the stack of the city', () => {
    expect(pickAt(map, at, { groups: NONE, icons: [icon(['a', 'b'])] })).toEqual({
      kind: 'stack',
      node: node.id,
      ids: ['a', 'b'],
    });
  });

  it('a click anywhere in the cell of a city (not on a road) picks the city', () => {
    const cells = voronoiCells(map.nodes, { width: map.meta.width, height: map.meta.height });
    const cell = cells[node.id];
    if (cell === undefined) throw new Error('no cell');
    // The corner of the cell nearest to the city, pulled a little towards the city: inside the
    // cell, away from the city circle and from every road.
    let found: { x: number; y: number } | null = null;
    for (const corner of cell) {
      const spot = { x: at.x + (corner.x - at.x) * 0.9, y: at.y + (corner.y - at.y) * 0.9 };
      const far = Math.hypot(spot.x - at.x, spot.y - at.y) > NODE_RADIUS + NODE_HIT_SLACK + 5;
      const hit = pickAt(map, spot, { groups: NONE, cells });
      if (far && hit?.kind === 'node') found = spot;
    }
    expect(found).not.toBeNull();
    if (found === null) return;
    expect(pickAt(map, found, { groups: NONE, cells })).toEqual({ kind: 'node', id: node.id });
    // Without the cells there is nothing there.
    expect(pickAt(map, found, { groups: NONE })).toBeNull();
    expect(cellAt(cells, found)).toBe(node.id);
  });

  it('a road carries the city whose area it is in', () => {
    const cells = voronoiCells(map.nodes, { width: map.meta.width, height: map.meta.height });
    const edge = map.edges[0];
    const a = edge === undefined ? undefined : map.nodes[edge.a];
    const b = edge === undefined ? undefined : map.nodes[edge.b];
    if (edge === undefined || a === undefined || b === undefined) throw new Error('no roads');
    // A quarter along the road, away from the city circle.
    const quarter = { x: a.x + (b.x - a.x) * 0.3, y: a.y + (b.y - a.y) * 0.3 };
    const hit = pickAt(map, quarter, { groups: NONE, cells });
    expect(hit).toMatchObject({ kind: 'edge', id: edge.id });
    expect(hit?.kind === 'edge' ? hit.cell : null).toBe(cellAt(cells, quarter));
  });
});

describe('pickAt on the areas of a geography (DEC-36, #544)', () => {
  const territory = geoTerritory(GEO_MAP, GEO_FILE);
  const scene = { groups: NONE, cells: territory?.cells, geo: true };

  it('hits the area that holds the point, not a convex cell', () => {
    // Left of the road beside the contact: area 0 (the Voronoi border would be x = 100 as well,
    // but the notch of the river makes the area narrower above y = 60).
    expect(pickAt(GEO_MAP, { x: 80, y: 20 }, scene)).toEqual({ kind: 'node', id: 0 });
    expect(pickAt(GEO_MAP, { x: 125, y: 20 }, scene)).toEqual({ kind: 'node', id: 1 });
  });

  it('hits nothing on the water', () => {
    expect(pickAt(GEO_MAP, { x: 100, y: 20 }, scene)).toBeNull();
    // The Voronoi cells would give the point to area 0 or 1.
    const voronoi = voronoiTerritory(GEO_MAP);
    expect(
      pickAt(GEO_MAP, { x: 100, y: 20 }, { groups: NONE, cells: voronoi.cells }),
    ).not.toBeNull();
  });
});
