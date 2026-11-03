import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { levelRim, levelShare } from './levelLayout.ts';
import { voronoiTerritory } from './territory.ts';

const territory = voronoiTerritory(DEFAULT_MAP);
const { cells, edges } = territory;

/** A cell with at least two neighbours, and two of those neighbours. */
const centre = cells.findIndex(
  (_, i) => edges.filter((e) => e.cell === i && e.neighbour !== null).length >= 2,
);
const around = edges
  .filter((e) => e.cell === centre && e.neighbour !== null)
  .map((e) => e.neighbour as number);
const [first, second] = around;
if (first === undefined || second === undefined)
  throw new Error('the default map has no cell with two neighbours');

const everyone = (owner: number | null) => cells.map(() => owner);

describe('the rim of the supply level (T1)', () => {
  it('runs along the edges that face an own cell outside the level, and nowhere else', () => {
    const owners = everyone(0);
    const rim = levelRim(cells, edges, owners, 0, new Set([centre]), 2);
    const facing = edges.filter(
      (e) => e.cell === centre && e.neighbour !== null && e.neighbour !== centre,
    );
    expect(rim).toHaveLength(facing.length);
  });

  it('leaves the border with the enemy to the owner line', () => {
    const owners = everyone(0).map((o, i) => (i === first ? 1 : o));
    const withEnemy = levelRim(cells, edges, owners, 0, new Set([centre]), 2);
    const allOwn = levelRim(cells, edges, everyone(0), 0, new Set([centre]), 2);
    expect(withEnemy.length).toBe(allOwn.length - 1);
  });

  it('has no rim between two level cells, nor for an empty level', () => {
    const level = new Set([centre, first]);
    const rim = levelRim(cells, edges, everyone(0), 0, level, 2);
    const between = edges.filter((e) => e.cell === centre && e.neighbour === first).length;
    const outward = (cell: number) =>
      edges.filter((e) => e.cell === cell && e.neighbour !== null && !level.has(e.neighbour))
        .length;
    expect(between).toBeGreaterThan(0);
    expect(rim).toHaveLength(outward(centre) + outward(first));
    expect(levelRim(cells, edges, everyone(0), 0, new Set(), 2)).toEqual([]);
  });

  it('lies inside the level cell, `inset` away from its edge', () => {
    const rim = levelRim(cells, edges, everyone(0), 0, new Set([centre]), 2);
    const polygon = cells[centre];
    if (polygon === undefined) throw new Error('no cell');
    const cx = polygon.reduce((s, p) => s + p.x, 0) / polygon.length;
    const cy = polygon.reduce((s, p) => s + p.y, 0) / polygon.length;
    for (const { a, b } of rim) {
      // The middle of a segment is nearer the cell centre than the edge it runs along.
      const edge = edges.find(
        (e) =>
          e.cell === centre &&
          Math.abs((e.a.x + e.b.x) / 2 - (a.x + b.x) / 2) < 3 &&
          Math.abs((e.a.y + e.b.y) / 2 - (a.y + b.y) / 2) < 3,
      );
      expect(edge).toBeDefined();
      if (edge === undefined) continue;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const edgeMid = { x: (edge.a.x + edge.b.x) / 2, y: (edge.a.y + edge.b.y) / 2 };
      expect(Math.hypot(mid.x - cx, mid.y - cy)).toBeLessThan(
        Math.hypot(edgeMid.x - cx, edgeMid.y - cy),
      );
    }
  });
});

describe('the fade of the level cells (a shift)', () => {
  const from = new Set([1, 2]);
  const to = new Set([2, 3]);

  it('a cell in both sets stays lit, one that enters grows, one that leaves shrinks', () => {
    expect(levelShare(2, from, to, 0.25)).toBe(1);
    expect(levelShare(3, from, to, 0.25)).toBe(0.25);
    expect(levelShare(1, from, to, 0.25)).toBe(0.75);
    expect(levelShare(9, from, to, 0.25)).toBe(0);
  });

  it('at the end of the fade only the new level is lit', () => {
    expect(levelShare(1, from, to, 1)).toBe(0);
    expect(levelShare(3, from, to, 1)).toBe(1);
  });
});
