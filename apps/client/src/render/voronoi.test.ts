import { describe, expect, it } from 'vitest';
import { BUNDLED_MAPS } from '../map/bundledMaps.ts';
import type { Point } from './camera.ts';
import { polygonArea, voronoiCells } from './voronoi.ts';

function contains(polygon: readonly Point[], p: Point): boolean {
  // Convex polygon: p is on the same side of every edge (or on it).
  let sign = 0;
  for (let k = 0; k < polygon.length; k += 1) {
    const a = polygon[k];
    const b = polygon[(k + 1) % polygon.length];
    if (a === undefined || b === undefined) {
      return false;
    }
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(cross) > 1e-9) {
      if (sign !== 0 && Math.sign(cross) !== sign) {
        return false;
      }
      sign = Math.sign(cross);
    }
  }
  return true;
}

describe('voronoiCells', () => {
  it('gives the whole rectangle to a single site', () => {
    const [cell] = voronoiCells([{ x: 3, y: 4 }], { width: 10, height: 6 });
    expect(cell).toBeDefined();
    expect(polygonArea(cell ?? [])).toBe(60);
  });

  it('splits the rectangle along the bisector of two sites', () => {
    // Sites at x = 2 and x = 6: the bisector is x = 4, so the cells are 4 x 6 and 6 x 6.
    const [left, right] = voronoiCells(
      [
        { x: 2, y: 3 },
        { x: 6, y: 3 },
      ],
      { width: 10, height: 6 },
    );
    expect(polygonArea(left ?? [])).toBeCloseTo(24, 9);
    expect(polygonArea(right ?? [])).toBeCloseTo(36, 9);
    for (const p of left ?? []) {
      expect(p.x).toBeLessThanOrEqual(4 + 1e-9);
    }
  });

  it.each(BUNDLED_MAPS.map((map) => [map.meta.name, map] as const))(
    'tiles map %s: every city is inside its cell and the cells cover the map',
    (_name, map) => {
      const bounds = { width: map.meta.width, height: map.meta.height };
      const cells = voronoiCells(map.nodes, bounds);
      expect(cells).toHaveLength(map.nodes.length);
      map.nodes.forEach((node, i) => {
        expect(contains(cells[i] ?? [], node)).toBe(true);
      });
      const total = cells.reduce((sum, cell) => sum + polygonArea(cell), 0);
      expect(total).toBeCloseTo(bounds.width * bounds.height, 6);
    },
  );
});
