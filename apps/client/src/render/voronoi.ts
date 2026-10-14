import type { Point, Size } from './camera.ts';

/**
 * Voronoi cells of `sites` inside the rectangle `[0, width] × [0, height]`: cell `i` is the part
 * of the rectangle closer to `sites[i]` than to any other site. Used only to paint the terrain and
 * territory backgrounds: every city colours the area around it.
 *
 * Each cell is the rectangle clipped by the bisector half-plane of every other site: O(n²) clips,
 * fine for maps of up to a few dozen cities, computed once per map. Sites must be distinct (the
 * map validator guarantees it).
 */
export function voronoiCells(sites: readonly Point[], bounds: Size): Point[][] {
  const rectangle: Point[] = [
    { x: 0, y: 0 },
    { x: bounds.width, y: 0 },
    { x: bounds.width, y: bounds.height },
    { x: 0, y: bounds.height },
  ];
  return sites.map((site, i) => {
    let cell = rectangle;
    sites.forEach((other, j) => {
      if (j !== i && cell.length > 0) {
        cell = clipCloserTo(cell, site, other);
      }
    });
    return withoutRepeats(cell);
  });
}

/**
 * The corners of a cell without repeats: where the bisectors of three or four sites meet in one
 * point (sites on a circle, common on symmetric maps) a clip leaves the same corner twice.
 */
function withoutRepeats(cell: readonly Point[]): Point[] {
  return cell.filter((p, k) => {
    const next = cell[(k + 1) % cell.length];
    return next === undefined || cell.length < 2 || Math.hypot(next.x - p.x, next.y - p.y) > 1e-6;
  });
}

/** Sutherland–Hodgman step: the part of a convex polygon not farther from `a` than from `b`. */
function clipCloserTo(polygon: readonly Point[], a: Point, b: Point): Point[] {
  // p is closer to a (or equidistant) when dot(p - mid, b - a) <= 0.
  const nx = b.x - a.x;
  const ny = b.y - a.y;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const side = (p: Point): number => (p.x - mx) * nx + (p.y - my) * ny;

  const result: Point[] = [];
  polygon.forEach((current, k) => {
    const previous = polygon[(k + polygon.length - 1) % polygon.length] ?? current;
    const sc = side(current);
    const sp = side(previous);
    if (sc <= 0) {
      if (sp > 0) {
        result.push(intersect(previous, current, sp, sc));
      }
      result.push(current);
    } else if (sp <= 0) {
      result.push(intersect(previous, current, sp, sc));
    }
  });
  return result;
}

function intersect(p: Point, q: Point, sp: number, sq: number): Point {
  const t = sp / (sp - sq);
  return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
}

/** Area of a simple polygon (shoelace formula), positive for either orientation. */
export function polygonArea(polygon: readonly Point[]): number {
  let twice = 0;
  polygon.forEach((p, k) => {
    const q = polygon[(k + 1) % polygon.length] ?? p;
    twice += p.x * q.y - q.x * p.y;
  });
  return Math.abs(twice) / 2;
}
