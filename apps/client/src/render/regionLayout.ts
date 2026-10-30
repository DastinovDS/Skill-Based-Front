/**
 * Geometry of the regions of the map (ui-style.md 9.1, 9.2, 9.8): where terrain stamps go, the
 * border between areas of different owners (the veil of the fog is in `fogView.ts`).
 *
 * Pure functions, no PixiJS and no DOM. The cells are the Voronoi cells of `voronoi.ts` (convex).
 */
import type { Point } from './camera.ts';

export interface Segment {
  readonly a: Point;
  readonly b: Point;
}

/** Twice the signed area: positive for a polygon counter-clockwise in a y-up system. */
function signedArea(polygon: readonly Point[]): number {
  let sum = 0;
  polygon.forEach((p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    if (q !== undefined) sum += p.x * q.y - q.x * p.y;
  });
  return sum;
}

export function centroid(polygon: readonly Point[]): Point {
  const n = Math.max(1, polygon.length);
  return {
    x: polygon.reduce((sum, p) => sum + p.x, 0) / n,
    y: polygon.reduce((sum, p) => sum + p.y, 0) / n,
  };
}

/** Whether `p` lies inside (or on) a convex polygon, either orientation. */
export function insideConvex(polygon: readonly Point[], p: Point): boolean {
  if (polygon.length < 3) return false;
  const sign = Math.sign(signedArea(polygon)) || 1;
  return polygon.every((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    if (b === undefined) return true;
    return sign * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) >= 0;
  });
}

/** Distance from `p` to the segment `s`. */
export function distanceToSegment(p: Point, s: Segment): number {
  const dx = s.b.x - s.a.x;
  const dy = s.b.y - s.a.y;
  const length2 = dx * dx + dy * dy;
  const t =
    length2 === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / length2));
  return Math.hypot(p.x - (s.a.x + t * dx), p.y - (s.a.y + t * dy));
}

export interface StampGrid {
  readonly width: number;
  readonly height: number;
}

/**
 * Where stamps of a terrain go inside `cell`: a grid of `grid` steps, every second row shifted by
 * half a step, the whole grid shifted by integers derived from the id of the city (so the picture
 * is the same at every start). A point must be inside the cell, at least `cityClearance` from the
 * city centre `centre` and `roadClearance` from every road axis in `roads`.
 */
export function stampPoints(
  cell: readonly Point[],
  grid: StampGrid,
  nodeId: number,
  centre: Point,
  roads: readonly Segment[],
  cityClearance: number,
  roadClearance: number,
  /** Whether a point is inside the cell; the cells of a geography (DEC-36) are not convex. */
  inside: (cell: readonly Point[], p: Point) => boolean = insideConvex,
): Point[] {
  if (cell.length < 3) return [];
  const xs = cell.map((p) => p.x);
  const ys = cell.map((p) => p.y);
  const shiftX = (nodeId * 37) % grid.width;
  const shiftY = (nodeId * 53) % grid.height;
  const points: Point[] = [];
  const firstRow = Math.floor((Math.min(...ys) - shiftY) / grid.height) - 1;
  const lastRow = Math.ceil((Math.max(...ys) - shiftY) / grid.height) + 1;
  for (let row = firstRow; row <= lastRow; row++) {
    const y = row * grid.height + shiftY;
    const offset = row % 2 === 0 ? 0 : grid.width / 2;
    const firstCol = Math.floor((Math.min(...xs) - shiftX - offset) / grid.width) - 1;
    const lastCol = Math.ceil((Math.max(...xs) - shiftX - offset) / grid.width) + 1;
    for (let col = firstCol; col <= lastCol; col++) {
      const p = { x: col * grid.width + shiftX + offset, y };
      if (!inside(cell, p)) continue;
      if (Math.hypot(p.x - centre.x, p.y - centre.y) < cityClearance) continue;
      if (roads.some((road) => distanceToSegment(p, road) < roadClearance)) continue;
      points.push(p);
    }
  }
  return points;
}

// --- Borders between areas -------------------------------------------------------------------

/** Two corners of cells closer than this (world units) are the same point. */
const SNAP = 0.01;

export interface CellEdge {
  readonly cell: number;
  readonly a: Point;
  readonly b: Point;
  /** The cell on the other side of the edge; `null` on the border of the map. */
  readonly neighbour: number | null;
  /**
   * Water lies across the edge (DEC-36, #544): a sea or a lake (`neighbour: null`) or a river or a
   * stream, then `neighbour` is the area across it, if any. The thin area line is not drawn here,
   * the owner border is (it runs along a coast).
   */
  readonly water?: boolean;
  /** Unit normal into the cell; set for non-convex areas, whose centroid cannot tell the side. */
  readonly inward?: Point;
}

const edgeCache = new WeakMap<readonly (readonly Point[])[], readonly CellEdge[]>();

/**
 * Every edge of every cell, with the cell across it. The corners of neighbouring cells are
 * computed by different clips and differ in the last bits, so they are matched by distance
 * (`SNAP`), not by rounding to a grid: a coordinate like `408.125` sits exactly on the rounding
 * boundary of a hundredth and used to fall to either side, which lost the neighbour of the edge
 * and with it a piece of the territory border. Edges that collapse to a point are dropped.
 * The result is cached per `cells` array (the cells of a map never change).
 */
export function cellEdges(cells: readonly (readonly Point[])[]): readonly CellEdge[] {
  const cached = edgeCache.get(cells);
  if (cached !== undefined) return cached;
  const corners: Point[] = [];
  const cornerId = (p: Point): number => {
    const known = corners.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) <= SNAP);
    if (known >= 0) return known;
    corners.push(p);
    return corners.length - 1;
  };
  const keyOf = (a: Point, b: Point): string | null => {
    const first = cornerId(a);
    const second = cornerId(b);
    return first === second
      ? null
      : `${String(Math.min(first, second))}|${String(Math.max(first, second))}`;
  };
  const owners = new Map<string, number[]>();
  cells.forEach((cell, i) => {
    cell.forEach((a, k) => {
      const b = cell[(k + 1) % cell.length];
      const key = b === undefined ? null : keyOf(a, b);
      if (key !== null) owners.set(key, [...(owners.get(key) ?? []), i]);
    });
  });
  const edges: CellEdge[] = [];
  cells.forEach((cell, i) => {
    cell.forEach((a, k) => {
      const b = cell[(k + 1) % cell.length];
      if (b === undefined) return;
      const key = keyOf(a, b);
      if (key === null) return;
      const neighbour = (owners.get(key) ?? []).find((j) => j !== i) ?? null;
      edges.push({ cell: i, a, b, neighbour });
    });
  });
  edgeCache.set(cells, edges);
  return edges;
}

/** `p` moved `distance` from the edge `a`-`b` toward `towards` (perpendicular to the edge). */
function inward(a: Point, b: Point, towards: Point, distance: number): Point {
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  let nx = -(b.y - a.y) / length;
  let ny = (b.x - a.x) / length;
  const mx = (a.x + b.x) / 2;
  if ((towards.x - mx) * nx + (towards.y - (a.y + b.y) / 2) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  return { x: nx * distance, y: ny * distance };
}

export interface Border extends Segment {
  readonly owner: number;
}

/** How far (a multiple of the inset) a vertex of a sharp corner may move off its two edges. */
const MITER_LIMIT = 2;

/**
 * Where every corner of the areas of a geography moves for an inset of 1, by area: along the
 * bisector of the inward normals of the two edges that meet there (a miter, capped at
 * `MITER_LIMIT`). Two border segments that meet at a corner then meet at the moved corner too;
 * moving each segment on its own normal opens a notch at a bend and crosses into a hook at a sharp
 * tip, such as the land between a river mouth and the coast (#585).
 */
function cornerShifts(edges: readonly CellEdge[]): Map<string, Point> {
  const sums = new Map<string, Point>();
  for (const { cell, a, b, inward } of edges) {
    if (inward === undefined) continue;
    for (const p of [a, b]) {
      const key = `${String(cell)}|${String(p.x)},${String(p.y)}`;
      const sum = sums.get(key) ?? { x: 0, y: 0 };
      sums.set(key, { x: sum.x + inward.x, y: sum.y + inward.y });
    }
  }
  const shifts = new Map<string, Point>();
  for (const [key, sum] of sums) {
    const length = Math.hypot(sum.x, sum.y);
    if (length < 1e-9) continue;
    const n = { x: sum.x / length, y: sum.y / length };
    shifts.set(key, n);
  }
  return shifts;
}

/**
 * Border of the areas of owners: for every edge of an owned cell whose neighbour belongs to
 * somebody else (or nobody), a segment of the owner, moved `inset` into its own cell so that two
 * owners' lines do not cover each other. The border of the map is not a border.
 */
export function territoryBorders(
  cells: readonly (readonly Point[])[],
  owners: readonly (number | null)[],
  inset: number,
  edges: readonly CellEdge[] = cellEdges(cells),
): Border[] {
  const borders: Border[] = [];
  const shifts = edges.some((e) => e.inward !== undefined) ? cornerShifts(edges) : null;
  for (const edge of edges) {
    const owner = owners[edge.cell] ?? null;
    if (owner === null) continue;
    // The border of the map is not a border; a coast is (DEC-36, item 6), and so is a river bank
    // unless the area across the river has the same owner.
    if (edge.neighbour === null && edge.water !== true) continue;
    if (edge.neighbour !== null && owners[edge.neighbour] === owner) continue;
    const cell = cells[edge.cell];
    if (cell === undefined) continue;
    if (edge.inward !== undefined && shifts !== null) {
      // A miter at each end: the bisector there, as far as keeps the edge `inset` away.
      const { inward: n } = edge;
      const at = (p: Point): Point => {
        const bisector = shifts.get(`${String(edge.cell)}|${String(p.x)},${String(p.y)}`) ?? n;
        const cos = bisector.x * n.x + bisector.y * n.y;
        const reach = inset / Math.max(cos, 1 / MITER_LIMIT);
        return { x: p.x + bisector.x * reach, y: p.y + bisector.y * reach };
      };
      borders.push({ owner, a: at(edge.a), b: at(edge.b) });
      continue;
    }
    const d = inward(edge.a, edge.b, centroid(cell), inset);
    borders.push({
      owner,
      a: { x: edge.a.x + d.x, y: edge.a.y + d.y },
      b: { x: edge.b.x + d.x, y: edge.b.y + d.y },
    });
  }
  return borders;
}

// --- Clipping --------------------------------------------------------------------------------

/** Sutherland-Hodgman: the part of `subject` inside the convex polygon `clip`. */
export function clipToConvex(subject: readonly Point[], clip: readonly Point[]): Point[] {
  const sign = Math.sign(signedArea(clip)) || 1;
  let result = [...subject];
  clip.forEach((a, i) => {
    const b = clip[(i + 1) % clip.length];
    if (b === undefined || result.length === 0) return;
    const side = (p: Point): number =>
      sign * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
    const next: Point[] = [];
    result.forEach((current, k) => {
      const previous = result[(k + result.length - 1) % result.length];
      if (previous === undefined) return;
      const sc = side(current);
      const sp = side(previous);
      if (sc >= 0 !== sp >= 0) {
        const t = sp / (sp - sc);
        next.push({
          x: previous.x + (current.x - previous.x) * t,
          y: previous.y + (current.y - previous.y) * t,
        });
      }
      if (sc >= 0) next.push(current);
    });
    result = next;
  });
  return result;
}
