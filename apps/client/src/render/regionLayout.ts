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
   * stream, then `neighbour` is the area across it, if any (the cell itself where a stream is cut
   * into it, #585). The thin area line is not drawn here,
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
  /** The area the line lies in, and the area across its edge (`null`: the sea or the border of the map). */
  readonly cell: number;
  readonly neighbour: number | null;
  /** Water lies across the edge (a coast or a river bank, DEC-36): the land band stops there (#842). */
  readonly water?: boolean;
}

/** The corner shifts per `edges` array (the edges of a map never change; a capture redraws per frame). */
const shiftCache = new WeakMap<readonly CellEdge[], Map<string, Point>>();

/** How far (a multiple of the inset) a vertex of a sharp corner may move off its two edges. */
const MITER_LIMIT = 2;

/**
 * The direction every corner of the areas of a geography moves in, by area: the bisector of the
 * inward normals of the edges that meet there (the distance is a miter, capped at `MITER_LIMIT`). Two border segments that meet at a corner then meet at the moved corner too;
 * moving each segment on its own normal opens a notch at a bend and crosses into a hook at a sharp
 * tip, such as the land between a river mouth and the coast (#585).
 */
function cornerShifts(edges: readonly CellEdge[]): Map<string, Point> {
  const cached = shiftCache.get(edges);
  if (cached !== undefined) return cached;
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
  shiftCache.set(edges, shifts);
  return shifts;
}

/** The owner whose border line runs along `edge`, or `null` if no line does. */
function borderOwner(edge: CellEdge, owners: readonly (number | null)[]): number | null {
  const owner = owners[edge.cell] ?? null;
  if (owner === null) return null;
  // The border of the map is not a border; a coast is (DEC-36, item 6), and so is a river bank
  // unless the area across the river has the same owner.
  if (edge.neighbour === null && edge.water !== true) return null;
  if (edge.neighbour !== null && owners[edge.neighbour] === owner) return null;
  return owner;
}

/** The ends of the edges at each corner, per `edges` array (`2 * edge + 0` is `a`, `+ 1` is `b`). */
const mateCache = new WeakMap<readonly CellEdge[], readonly (readonly number[])[]>();

/**
 * For every end of every edge, the ends of all edges (its own included) within `SNAP` of it: the
 * corners of two areas are matched by distance, like `cellEdges`, since Voronoi corners differ in
 * the last bits. Cached per `edges` array; a 1-unit grid keeps it linear.
 */
function cornerMates(edges: readonly CellEdge[]): readonly (readonly number[])[] {
  const cached = mateCache.get(edges);
  if (cached !== undefined) return cached;
  const point = (end: number): Point => {
    const edge = edges[end >> 1] as CellEdge;
    return end % 2 === 0 ? edge.a : edge.b;
  };
  const grid = new Map<string, number[]>();
  const cellKey = (x: number, y: number): string => `${String(x)},${String(y)}`;
  for (let end = 0; end < edges.length * 2; end++) {
    const p = point(end);
    const key = cellKey(Math.floor(p.x), Math.floor(p.y));
    const list = grid.get(key);
    if (list === undefined) grid.set(key, [end]);
    else list.push(end);
  }
  const mates: number[][] = [];
  for (let end = 0; end < edges.length * 2; end++) {
    const p = point(end);
    const near: number[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const other of grid.get(cellKey(Math.floor(p.x) + dx, Math.floor(p.y) + dy)) ?? []) {
          const q = point(other);
          if (Math.hypot(q.x - p.x, q.y - p.y) <= SNAP) near.push(other);
        }
      }
    }
    mates.push(near);
  }
  mateCache.set(edges, mates);
  return mates;
}

/**
 * Where the line of one owner passes from one of its areas into the next (two areas of the owner
 * and the land or the water of another meet at a corner), the direction both ends move in: the
 * bisector of the two drawn edges' inward normals. An area's own corner shift (`cornerShifts`)
 * also counts the edge between the two areas, which is not drawn, so the two ends went apart to
 * either side of it and the line broke there with a gap and an offset (#919, item 10). Only a
 * corner with exactly two drawn ends of one owner, from two different areas; any other keeps the
 * shift of its area (a pinch of four ends, the loose end of a line).
 */
function ownerJoin(
  edges: readonly CellEdge[],
  drawn: readonly (number | null)[],
  mates: readonly (readonly number[])[],
  end: number,
): Point | null {
  const owner = drawn[end >> 1] ?? null;
  if (owner === null) return null;
  const here = (mates[end] ?? []).filter((m) => drawn[m >> 1] === owner);
  if (here.length !== 2) return null;
  const [first, second] = here.map((m) => edges[m >> 1]) as [CellEdge, CellEdge];
  if (first.cell === second.cell || first.inward === undefined || second.inward === undefined)
    return null;
  const sum = { x: first.inward.x + second.inward.x, y: first.inward.y + second.inward.y };
  const length = Math.hypot(sum.x, sum.y);
  return length < 1e-9 ? null : { x: sum.x / length, y: sum.y / length };
}

// --- Joining the line where it leaves the water (#928) -----------------------------------------

/** Two loose ends of one owner's line farther apart than this (world units) are not joined. */
const JOIN_REACH = 160;
/** The longest walk along banks a join takes (world units). */
const WALK_REACH = 200;
/**
 * A join walks along the owner's own banks while that is at most `WALK_RATIO` times the straight
 * join plus `WALK_SLACK` (world units); a longer walk would run along a river between two areas of
 * the owner, so the line crosses the water instead.
 */
const WALK_RATIO = 2;
const WALK_SLACK = 24;
/** Spacing (world units) of the points a straight join is checked at: none may be on land. */
const JOIN_PROBE = 2;
/** A probe on land this close (world units) to a bank of its area still counts as water. */
const JOIN_SKIM = 6;
/** A join along another owner's bank keeps this far (world units) off it, plus the inset. */
const JOIN_OFF = 1.5;
/** A piece of the line along water at most this long (world units) with two loose ends is dropped. */
const STUB = 80;
/** A straight join closer than this cosine (60 degrees) to the bank it leaves turns back on it. */
const SPIKE = 0.5;

interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

const boxCache = new WeakMap<readonly (readonly Point[])[], readonly Box[]>();

/** The bounding box of every cell, cached per `cells` array. */
function boxesOf(cells: readonly (readonly Point[])[]): readonly Box[] {
  const cached = boxCache.get(cells);
  if (cached !== undefined) return cached;
  const boxes = cells.map((cell) => ({
    x0: Math.min(...cell.map((p) => p.x)),
    y0: Math.min(...cell.map((p) => p.y)),
    x1: Math.max(...cell.map((p) => p.x)),
    y1: Math.max(...cell.map((p) => p.y)),
  }));
  boxCache.set(cells, boxes);
  return boxes;
}

/** Whether `p` lies inside the polygon (even-odd: the slit of a lake cancels itself out). */
function insideRing(polygon: readonly Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i] as Point;
    const b = polygon[j] as Point;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * A join of two loose ends (`2 * edge + 0 | 1`) of one owner's line over water: straight
 * (`along` empty) or along the banks of other owners' areas (`along`: those edges, in order from
 * `from`), kept off them on the water side.
 */
interface Join {
  readonly from: number;
  readonly to: number;
  readonly along: readonly number[];
  /** `to` is a corner on the frame of the map where water leaves it: the line ends there. */
  readonly frame?: true;
}

/** What is drawn of the owners' lines: the owner of every edge's line and the joins over water. */
interface OwnerLines {
  readonly drawn: readonly (number | null)[];
  readonly joins: readonly Join[];
}

/** The last result per `edges` array: `borderLines` asks for the same owners at four insets. */
const linesCache = new WeakMap<readonly CellEdge[], { key: string; lines: OwnerLines }>();

/**
 * The owner of the line along every edge, and where the line leaves the water, the joins that keep
 * it one line (#928). A river bank carries the line only while the area across is not the owner's
 * (DEC-36, item 6), so where the far bank changes hands, or a river ends between two areas of the
 * owner and a third, the line along the bank stopped at one corner and the land border went on from
 * another, the water between them: a gap with a stub on either side.
 *
 * A loose end is a drawn end of an owner alone at its corner (an odd count there: the one alone in
 * its area), by water and not on the frame of the map. Each is joined to a loose end of the same
 * owner, the candidates taken cheapest first (ties by end index):
 * - along the owner's own banks without a line, round the water, when that walk is short (the tip
 *   of a river, a pond at a junction): those banks take the line;
 * - else, if the two left the same water (an area of the owner, or across from it, on the banks of
 *   both) or another owner's bank leads from one to the other: straight across the water if the
 *   straight line runs over water only; else a short walk along the own banks and then straight
 *   across (the mouth of an inlet of the owner's area); else along the other owner's bank, on the
 *   water side (a corner of its land reaches into the way).
 * A straight join that turns back along the bank it starts from cuts that bank back first (no
 * spike). An end left over goes on to the frame where its water runs off the map. A short piece
 * along water still left with two loose ends is a stub and is dropped.
 */
function ownerLines(
  cells: readonly (readonly Point[])[],
  edges: readonly CellEdge[],
  owners: readonly (number | null)[],
): OwnerLines {
  const key = owners.join(',');
  const cached = linesCache.get(edges);
  if (cached?.key === key && cached.lines.drawn.length === edges.length) return cached.lines;
  const lines = joinedLines(cells, edges, owners);
  linesCache.set(edges, { key, lines });
  return lines;
}

function joinedLines(
  cells: readonly (readonly Point[])[],
  edges: readonly CellEdge[],
  owners: readonly (number | null)[],
): OwnerLines {
  const drawn = edges.map((edge) => borderOwner(edge, owners));
  if (!edges.some((edge) => edge.water === true)) return { drawn, joins: [] };
  const mates = cornerMates(edges);
  const edgeOf = (end: number): CellEdge => edges[end >> 1] as CellEdge;
  const pointOf = (end: number): Point => (end % 2 === 0 ? edgeOf(end).a : edgeOf(end).b);
  const cornerOf = (end: number): number => Math.min(end, ...(mates[end] ?? []));
  const lengthOf = (edge: CellEdge): number => Math.hypot(edge.b.x - edge.a.x, edge.b.y - edge.a.y);
  // A corner with an odd number of the owner's drawn ends leaves one of them loose: the one alone
  // in its area there (two ends of one area meet by the area's own corner shift, #919).
  const loose: number[] = [];
  for (let end = 0; end < edges.length * 2; end++) {
    const owner = drawn[end >> 1] ?? null;
    if (owner === null) continue;
    const here = mates[end] ?? [];
    const own = here.filter((m) => drawn[m >> 1] === owner);
    if (own.length % 2 === 0) continue;
    const alone = own.filter(
      (m) => own.filter((k) => edgeOf(k).cell === edgeOf(m).cell).length % 2 === 1,
    );
    if (Math.min(...alone) !== end) continue;
    const frame = here.some((m) => edgeOf(m).neighbour === null && edgeOf(m).water !== true);
    if (!frame && here.some((m) => edgeOf(m).water === true)) loose.push(end);
  }
  if (loose.length === 0) return { drawn, joins: [] };
  // Every bank (a water edge) by its corners.
  const banks = new Map<number, number[]>();
  edges.forEach((edge, index) => {
    if (edge.water !== true) return;
    for (const end of [2 * index, 2 * index + 1]) {
      const corner = cornerOf(end);
      banks.set(corner, [...(banks.get(corner) ?? []), index]);
    }
  });
  const across = (index: number, corner: number): number =>
    cornerOf(2 * index) === corner ? cornerOf(2 * index + 1) : cornerOf(2 * index);
  /** The shortest walks from `start` along the banks `allow` lets through, as far as `limit`. */
  const walk = (start: number, allow: (index: number) => boolean, limit: number) => {
    const dist = new Map<number, number>([[cornerOf(start), 0]]);
    const via = new Map<number, number>(); // corner -> the edge it was reached by
    const open = [cornerOf(start)];
    while (open.length > 0) {
      open.sort((x, y) => (dist.get(x) ?? 0) - (dist.get(y) ?? 0) || x - y);
      const corner = open.shift() as number;
      const d = dist.get(corner) ?? 0;
      for (const index of banks.get(corner) ?? []) {
        if (!allow(index)) continue;
        const next = across(index, corner);
        const nd = d + lengthOf(edges[index] as CellEdge);
        if (nd > limit || nd >= (dist.get(next) ?? Infinity)) continue;
        dist.set(next, nd);
        via.set(next, index);
        if (!open.includes(next)) open.push(next);
      }
    }
    /** The edges of the walk to `end`, in order from `start`; `null` if it is not reached. */
    const path = (end: number): { length: number; edges: number[] } | null => {
      const length = dist.get(cornerOf(end));
      if (length === undefined || length === 0) return null;
      const out: number[] = [];
      for (let corner = cornerOf(end); corner !== cornerOf(start);) {
        const index = via.get(corner) as number;
        out.unshift(index);
        corner = across(index, corner);
      }
      return { length, edges: out };
    };
    return { dist, path };
  };
  const shoreOf = new Map<number, Segment[]>();
  for (const edge of edges) {
    if (edge.water !== true) continue;
    const list = shoreOf.get(edge.cell);
    if (list === undefined) shoreOf.set(edge.cell, [edge]);
    else list.push(edge);
  }
  const boxes = boxesOf(cells);
  /** Whether the straight line `a b` runs over water only (it may skim a bank). */
  const wet = (a: Point, b: Point): boolean => {
    const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / JOIN_PROBE));
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      if (t < 0.15 || t > 0.85) continue;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const area = cells.findIndex((ring, i) => {
        const box = boxes[i];
        return (
          box !== undefined &&
          p.x >= box.x0 &&
          p.x <= box.x1 &&
          p.y >= box.y0 &&
          p.y <= box.y1 &&
          insideRing(ring, p)
        );
      });
      if (area < 0) continue;
      // Along a bank of the area (a join often runs on its edge) is still water.
      if (!(shoreOf.get(area) ?? []).some((s) => distanceToSegment(p, s) <= JOIN_SKIM))
        return false;
    }
    return true;
  };
  /** The areas of the owner's banks without a line at the corner of `end`, and the areas across. */
  const shores = (end: number): number[] =>
    (mates[end] ?? []).flatMap((m) => {
      const edge = edgeOf(m);
      return drawn[m >> 1] === null && edge.water === true && edge.neighbour !== null
        ? [edge.cell, edge.neighbour]
        : [];
    });
  /** The end of edge `index` at `corner`. */
  const endAt = (index: number, corner: number): number =>
    cornerOf(2 * index) === corner ? 2 * index : 2 * index + 1;
  const ownWalk = (start: number, owner: number) =>
    walk(
      start,
      (i) => drawn[i] === null && owners[(edges[i] as CellEdge).cell] === owner,
      WALK_REACH,
    );
  const ownWalks = new Map<number, ReturnType<typeof ownWalk>>();
  const ownFrom = (start: number, owner: number): ReturnType<typeof ownWalk> => {
    const known = ownWalks.get(start);
    if (known !== undefined) return known;
    const found = ownWalk(start, owner);
    ownWalks.set(start, found);
    return found;
  };
  /**
   * The cheapest join of `from` to `to` that walks the own banks from one of them and then crosses
   * the water straight to the other (a river mouth into an inlet of the owner's area).
   */
  const walkThenCross = (from: number, to: number, owner: number, limit: number) => {
    let best: { cost: number; own: number[]; join: Join } | null = null;
    for (const [start, target] of [
      [from, to],
      [to, from],
    ] as const) {
      const { dist, path } = ownFrom(start, owner);
      const q = pointOf(target);
      const order = [...dist.entries()]
        .filter(([corner, d]) => d > 0 && corner !== cornerOf(target))
        .map(([corner, d]) => {
          const c = pointOf(corner);
          return { corner, cost: d + Math.hypot(q.x - c.x, q.y - c.y) };
        })
        .filter(({ cost }) => cost <= limit && (best === null || cost < best.cost))
        .sort((x, y) => x.cost - y.cost || x.corner - y.corner);
      for (const { corner, cost } of order) {
        if (!wet(pointOf(corner), q)) continue;
        const walked = path(corner);
        const last = walked?.edges[walked.edges.length - 1];
        if (walked === null || last === undefined) continue;
        best = {
          cost,
          own: walked.edges,
          join: { from: endAt(last, corner), to: target, along: [] },
        };
        break;
      }
    }
    return best;
  };
  type Candidate = {
    readonly cost: number;
    readonly from: number;
    readonly to: number;
    readonly own: readonly number[];
    readonly join: Join | null;
  };
  const candidates: Candidate[] = [];
  for (const from of loose) {
    const owner = drawn[from >> 1] as number;
    const p = pointOf(from);
    const sides = [edgeOf(from).cell, ...shores(from)];
    const near = loose.filter(
      (to) =>
        to > from &&
        drawn[to >> 1] === owner &&
        to >> 1 !== from >> 1 &&
        Math.hypot(pointOf(to).x - p.x, pointOf(to).y - p.y) <= JOIN_REACH,
    );
    if (near.length === 0) continue;
    const own = ownFrom(from, owner).path;
    const other = walk(from, (i) => owners[(edges[i] as CellEdge).cell] !== owner, WALK_REACH).path;
    for (const to of near) {
      const q = pointOf(to);
      const straight = Math.hypot(q.x - p.x, q.y - p.y);
      const limit = straight * WALK_RATIO + WALK_SLACK;
      const banks = own(to);
      if (banks !== null && banks.length <= limit) {
        candidates.push({ cost: banks.length, from, to, own: banks.edges, join: null });
        continue;
      }
      const theirs = other(to);
      const along = theirs !== null && theirs.length <= limit ? theirs : null;
      const facing = [edgeOf(to).cell, ...shores(to)].some((area) => sides.includes(area));
      if (!facing && along === null) continue;
      if (wet(p, q)) {
        candidates.push({ cost: straight, from, to, own: [], join: { from, to, along: [] } });
        continue;
      }
      const bent = walkThenCross(from, to, owner, limit);
      const cost = Math.min(bent?.cost ?? Infinity, along?.length ?? Infinity);
      if (bent !== null && bent.cost === cost) candidates.push({ from, to, ...bent });
      else if (along !== null) {
        candidates.push({ cost, from, to, own: [], join: { from, to, along: along.edges } });
      }
    }
  }
  candidates.sort((x, y) => x.cost - y.cost || x.from - y.from || x.to - y.to);
  const used = new Set<number>();
  const joins: Join[] = [];
  for (const { from, to, own, join } of candidates) {
    if (used.has(from) || used.has(to)) continue;
    used.add(from);
    used.add(to);
    const owner = drawn[from >> 1] as number;
    for (const index of own) drawn[index] = owner;
    if (join === null) continue;
    if (join.along.length > 0) {
      joins.push(join);
      continue;
    }
    // A straight join that turns back along the bank it starts from would draw a spike: the bank
    // ran on past the place across from the other end (its look across still missed the far
    // bank). The bank is cut back edge by edge until the join leaves it at an open angle.
    let a = join.from;
    let b = join.to;
    for (let side = 0; side < 2; side++) {
      for (;;) {
        const edge = edgeOf(a);
        const back = a ^ 1;
        const t = pointOf(back);
        const p = pointOf(a);
        const q = pointOf(b);
        const run = { x: t.x - p.x, y: t.y - p.y };
        const toward = { x: q.x - p.x, y: q.y - p.y };
        const lengths = Math.hypot(run.x, run.y) * Math.hypot(toward.x, toward.y);
        if (edge.water !== true || lengths === 0) break;
        if (run.x * toward.x + run.y * toward.y < SPIKE * lengths) break;
        const next = (mates[back] ?? []).filter((m) => m !== back && drawn[m >> 1] === owner);
        if (next.length !== 1) break;
        drawn[a >> 1] = null;
        a = next[0] as number;
      }
      [a, b] = [b, a];
    }
    joins.push({ from: a, to: b, along: [] });
  }
  // A loose end left over where its water runs off the map: the line goes on to the frame, across
  // the water or along another owner's bank, and ends there like any border at the frame.
  const exits = [...banks.keys()].filter((corner) =>
    (mates[corner] ?? []).some((m) => edgeOf(m).neighbour === null && edgeOf(m).water !== true),
  );
  for (const from of loose) {
    if (used.has(from)) continue;
    const owner = drawn[from >> 1] as number;
    const p = pointOf(from);
    const other = walk(from, (i) => owners[(edges[i] as CellEdge).cell] !== owner, WALK_REACH).path;
    let best: { cost: number; join: Join } | null = null;
    for (const exit of exits) {
      const q = pointOf(exit);
      const straight = Math.hypot(q.x - p.x, q.y - p.y);
      if (straight === 0 || straight > JOIN_REACH) continue;
      if (best !== null && straight >= best.cost) continue;
      if (wet(p, q)) {
        best = { cost: straight, join: { from, to: exit, along: [], frame: true } };
        continue;
      }
      const theirs = other(exit);
      if (theirs === null || theirs.length > straight * WALK_RATIO + WALK_SLACK) continue;
      if (best === null || theirs.length < best.cost) {
        best = { cost: theirs.length, join: { from, to: exit, along: theirs.edges, frame: true } };
      }
    }
    if (best === null) continue;
    used.add(from);
    joins.push(best.join);
  }
  // A short piece along water whose both ends are left loose is a stub with nothing to join: the
  // end of a pond looking across it at another owner while the owner's own banks close it round.
  for (const start of loose) {
    if (used.has(start)) continue;
    const owner = drawn[start >> 1] ?? null;
    if (owner === null) continue;
    const run: number[] = [];
    let length = 0;
    let end = start;
    for (;;) {
      const index = end >> 1;
      const edge = edges[index] as CellEdge;
      if (edge.water !== true || run.includes(index)) break;
      run.push(index);
      length += lengthOf(edge);
      const far = end ^ 1;
      const next = (mates[far] ?? []).filter((m) => m !== far && drawn[m >> 1] === owner);
      if (next.length === 0) {
        if (length <= STUB && loose.includes(far) && !used.has(far)) {
          for (const i of run) drawn[i] = null;
        }
        break;
      }
      if (next.length !== 1 || length > STUB) break;
      end = next[0] as number;
    }
  }
  return { drawn, joins };
}

/**
 * Border of the areas of owners: for every edge of an owned cell whose neighbour belongs to
 * somebody else (or nobody), a segment of the owner, moved `inset` into its own cell so that two
 * owners' lines do not cover each other. The border of the map is not a border. Where the border
 * leaves the water, the line goes on unbroken (`ownerLines`, #928).
 */
export function territoryBorders(
  cells: readonly (readonly Point[])[],
  owners: readonly (number | null)[],
  inset: number,
  edges: readonly CellEdge[] = cellEdges(cells),
): Border[] {
  const borders: Border[] = [];
  const shifts = edges.some((e) => e.inward !== undefined) ? cornerShifts(edges) : null;
  const { drawn, joins } = ownerLines(cells, edges, owners);
  const mates = shifts !== null && inset !== 0 ? cornerMates(edges) : null;
  /** The end `end` (`2 * edge + 0 | 1`) of the line along an edge, moved `inset` into its area. */
  const endAt = (end: number): Point => {
    const edge = edges[end >> 1] as CellEdge;
    const p = end % 2 === 0 ? edge.a : edge.b;
    if (edge.inward !== undefined && shifts !== null) {
      // A miter: the bisector there, as far as keeps the edge `inset` away.
      const { inward: n } = edge;
      const bisector =
        (mates === null ? null : ownerJoin(edges, drawn, mates, end)) ??
        shifts.get(`${String(edge.cell)}|${String(p.x)},${String(p.y)}`) ??
        n;
      const cos = bisector.x * n.x + bisector.y * n.y;
      const reach = inset / Math.max(cos, 1 / MITER_LIMIT);
      return { x: p.x + bisector.x * reach, y: p.y + bisector.y * reach };
    }
    const d = inward(edge.a, edge.b, centroid(cells[edge.cell] ?? []), inset);
    return { x: p.x + d.x, y: p.y + d.y };
  };
  edges.forEach((edge, index) => {
    const owner = drawn[index] ?? null;
    if (owner === null || cells[edge.cell] === undefined) return;
    borders.push({
      owner,
      cell: edge.cell,
      neighbour: edge.neighbour,
      ...(edge.water === true ? { water: true } : {}),
      a: endAt(2 * index),
      b: endAt(2 * index + 1),
    });
  });
  for (const { from, to, along, frame } of joins) {
    const points = [endAt(from)];
    // Along another owner's bank: its corners moved off it into the water (a miter of its edges).
    const off = inset + JOIN_OFF;
    along.forEach((index, k) => {
      const here = edges[index] as CellEdge;
      if (here.inward !== undefined) {
        const mid = { x: (here.a.x + here.b.x) / 2, y: (here.a.y + here.b.y) / 2 };
        points.push({ x: mid.x - here.inward.x * off, y: mid.y - here.inward.y * off });
      }
      const next = along[k + 1];
      if (next === undefined) return;
      const there = edges[next] as CellEdge;
      const shared = [here.a, here.b].find((p) =>
        [there.a, there.b].some((q) => Math.hypot(q.x - p.x, q.y - p.y) <= SNAP),
      );
      const n = here.inward;
      const m = there.inward;
      if (shared === undefined || n === undefined || m === undefined) return;
      const sum = { x: n.x + m.x, y: n.y + m.y };
      const length = Math.hypot(sum.x, sum.y);
      if (length < 1e-9) return;
      const bisector = { x: sum.x / length, y: sum.y / length };
      const reach = off / Math.max(bisector.x * n.x + bisector.y * n.y, 1 / MITER_LIMIT);
      points.push({ x: shared.x - bisector.x * reach, y: shared.y - bisector.y * reach });
    });
    if (frame === true) {
      // The corner on the frame, kept off the last bank walked like the rest of the join.
      const exit = edges[to >> 1] as CellEdge;
      const p = to % 2 === 0 ? exit.a : exit.b;
      const last = edges[along[along.length - 1] ?? -1];
      const n = last?.inward ?? { x: 0, y: 0 };
      points.push({ x: p.x - n.x * off, y: p.y - n.y * off });
    } else points.push(endAt(to));
    const edge = edges[from >> 1] as CellEdge;
    for (let k = 0; k + 1 < points.length; k++) {
      borders.push({
        owner: drawn[from >> 1] as number,
        cell: edge.cell,
        neighbour: null,
        water: true,
        a: points[k] as Point,
        b: points[k + 1] as Point,
      });
    }
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
