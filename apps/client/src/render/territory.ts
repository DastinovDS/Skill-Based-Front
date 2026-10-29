/**
 * The areas of the nodes (the "territory", DEC-36, #544): one polygon per node and the edges of
 * those polygons with what lies across each. Two sources:
 *
 * - `voronoiTerritory`: the straight Voronoi cells (`voronoi.ts`), for every map without a vector
 *   file (the fixtures, the test maps);
 * - `geoTerritory`: the areas of the baker's shared border chains (`map/geography.ts`), so the tint
 *   lies exactly on the ground of the same area. These are not convex.
 *
 * Pure functions, no PixiJS and no DOM.
 */
import type { GeoChain, GeoFile, GeoLabel } from '../map/geography.ts';
import type { MapFile } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import { cellEdges, type CellEdge } from './regionLayout.ts';
import { voronoiCells } from './voronoi.ts';

export interface Territory {
  /** `cells[i]`: the polygon of node `i`. With a geography an enclosed lake is cut out by a slit. */
  readonly cells: Point[][];
  /** The edges of the polygons, with the area or the water across each (`regionLayout.ts`). */
  readonly edges: readonly CellEdge[];
  /** Voronoi cells are convex; the areas of a geography are not (water, rivers, noise). */
  readonly convex: boolean;
}

export function voronoiTerritory(map: MapFile): Territory {
  const cells = voronoiCells(map.nodes, { width: map.meta.width, height: map.meta.height });
  return { cells, edges: cellEdges(cells), convex: true };
}

/** Whether `p` lies inside the polygon (even-odd rule: a slit cancels itself out). */
export function insidePolygon(polygon: readonly Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a === undefined || b === undefined) continue;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** The node whose area holds `p`, or `null` (water, outside the map). */
export function areaAt(cells: readonly (readonly Point[])[], p: Point): number | null {
  const found = cells.findIndex((cell) => insidePolygon(cell, p));
  return found < 0 ? null : found;
}

// --- Rings from chains -----------------------------------------------------------------------

type Kind =
  { kind: 'area'; id: number } | { kind: 'outside' } | { kind: 'water' } | { kind: 'river' };

function kindOf(label: GeoLabel): Kind {
  if (typeof label === 'number')
    return label < 0 ? { kind: 'outside' } : { kind: 'area', id: label };
  return label === 'river' ? { kind: 'river' } : { kind: 'water' };
}

/** A stretch of the border walked with the area on its left, and what lies on its right. */
interface Piece {
  readonly area: number;
  readonly pts: readonly Point[];
  readonly other: Kind;
}

function points(chain: GeoChain): Point[] {
  const out: Point[] = [];
  for (let i = 0; i + 1 < chain.pts.length; i += 2) {
    out.push({ x: chain.pts[i] ?? 0, y: chain.pts[i + 1] ?? 0 });
  }
  return out;
}

const keyOf = (p: Point): string => `${String(p.x)},${String(p.y)}`;

function signedArea(ring: readonly Point[]): number {
  let twice = 0;
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length] ?? p;
    twice += p.x * q.y - q.x * p.y;
  });
  return twice / 2;
}

/** The closed rings of the pieces of one area; `null` if a ring does not close. */
function rings(pieces: readonly Piece[]): Point[][] | null {
  const byStart = new Map<string, number[]>();
  pieces.forEach((piece, i) => {
    const first = piece.pts[0];
    if (first !== undefined) byStart.set(keyOf(first), [...(byStart.get(keyOf(first)) ?? []), i]);
  });
  const used = new Set<number>();
  const out: Point[][] = [];
  for (let start = 0; start < pieces.length; start++) {
    if (used.has(start)) continue;
    used.add(start);
    const ring: Point[] = [...(pieces[start]?.pts ?? [])];
    const origin = keyOf(ring[0] ?? { x: NaN, y: NaN });
    while (keyOf(ring[ring.length - 1] ?? { x: NaN, y: NaN }) !== origin) {
      const end = ring[ring.length - 1];
      const next = (end === undefined ? [] : (byStart.get(keyOf(end)) ?? [])).find(
        (i) => !used.has(i),
      );
      if (next === undefined) return null;
      used.add(next);
      ring.push(...(pieces[next]?.pts.slice(1) ?? []));
    }
    ring.pop(); // the closing point repeats the first
    out.push(ring);
  }
  return out;
}

/**
 * One polygon from the rings of an area: the largest ring is the outline, a ring turning the other
 * way is a lake inside the area and is joined to the outline by a slit (two coincident edges to
 * its nearest vertex), so one `poly().fill()` leaves the lake out. Further rings of the outline's
 * direction would be a second piece of the area, which the validator (`geography`) forbids: they
 * are dropped.
 */
function polygonOf(all: readonly Point[][]): Point[] {
  const [outline] = [...all].sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
  if (outline === undefined) return [];
  const turn = Math.sign(signedArea(outline));
  let polygon = [...outline];
  for (const hole of all) {
    if (hole === outline || Math.sign(signedArea(hole)) === turn) continue;
    let best = { d: Infinity, o: 0, h: 0 };
    polygon.forEach((p, o) => {
      hole.forEach((q, h) => {
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d < best.d) best = { d, o, h };
      });
    });
    const around = [...hole.slice(best.h), ...hole.slice(0, best.h + 1)];
    const at = polygon[best.o];
    polygon = [
      ...polygon.slice(0, best.o + 1),
      ...around,
      ...(at === undefined ? [] : [at]),
      ...polygon.slice(best.o + 1),
    ];
  }
  return polygon;
}

// --- Edges -----------------------------------------------------------------------------------

/** A river bank is cut into pieces this long, each looking across the river on its own. */
const BANK_STEP = 16;
/** How far across a river the area behind it is looked for (world units; the widest river is ~22). */
const ACROSS_REACH = 48;
const ACROSS_STEP = 3;

/**
 * The edges of the polygons. `neighbour` is the node across; a bank of a river or a stream has the
 * node across the water (`water: true`), found by looking across it: the bank chain alone does not
 * say who is on the far bank, and the owner border must not run along a river between two areas of
 * one owner (DEC-36, item 6). A sea or a lake has no node across (`neighbour: null`, `water`).
 */
function edgesOf(pieces: readonly Piece[], cells: readonly (readonly Point[])[]): CellEdge[] {
  const boxes = cells.map((cell) => {
    const xs = cell.map((p) => p.x);
    const ys = cell.map((p) => p.y);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  });
  const nodeAt = (p: Point): number | null => {
    const found = cells.findIndex(
      (cell, i) =>
        boxes[i] !== undefined &&
        p.x >= boxes[i].x0 &&
        p.x <= boxes[i].x1 &&
        p.y >= boxes[i].y0 &&
        p.y <= boxes[i].y1 &&
        insidePolygon(cell, p),
    );
    return found < 0 ? null : found;
  };
  const edges: CellEdge[] = [];
  for (const { area, pts, other } of pieces) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (a === undefined || b === undefined) continue;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length === 0) continue;
      // Area on the left of the walk (y down): the inward normal is (dy, -dx).
      const inward = { x: (b.y - a.y) / length, y: -(b.x - a.x) / length };
      if (other.kind === 'area') {
        edges.push({ cell: area, a, b, neighbour: other.id, inward });
      } else if (other.kind === 'outside') {
        edges.push({ cell: area, a, b, neighbour: null, inward });
      } else if (other.kind === 'water') {
        edges.push({ cell: area, a, b, neighbour: null, water: true, inward });
      } else {
        const parts = Math.max(1, Math.ceil(length / BANK_STEP));
        for (let k = 0; k < parts; k++) {
          const from = { x: a.x + ((b.x - a.x) * k) / parts, y: a.y + ((b.y - a.y) * k) / parts };
          const to = {
            x: a.x + ((b.x - a.x) * (k + 1)) / parts,
            y: a.y + ((b.y - a.y) * (k + 1)) / parts,
          };
          const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
          let across: number | null = null;
          for (let d = ACROSS_STEP; d <= ACROSS_REACH && across === null; d += ACROSS_STEP) {
            const found = nodeAt({ x: mid.x - inward.x * d, y: mid.y - inward.y * d });
            if (found !== null && found !== area) across = found;
          }
          edges.push({ cell: area, a: from, b: to, neighbour: across, water: true, inward });
        }
      }
    }
  }
  return edges;
}

/**
 * The areas of a map from its vector file, or `null` if the chains do not make a closed polygon
 * for every node (the caller falls back to the Voronoi cells).
 */
export function geoTerritory(map: MapFile, geo: GeoFile): Territory | null {
  const count = map.nodes.length;
  const pieces: Piece[][] = map.nodes.map(() => []);
  const all: Piece[] = [];
  for (const chain of geo.chains) {
    const walk = points(chain);
    const l = kindOf(chain.l);
    const r = kindOf(chain.r);
    for (const [here, there, pts] of [
      [l, r, walk],
      [r, l, [...walk].reverse()],
    ] as const) {
      if (here.kind !== 'area') continue;
      if (here.id >= count) return null;
      const piece = { area: here.id, pts, other: there };
      pieces[here.id]?.push(piece);
      all.push(piece);
    }
  }
  const cells: Point[][] = [];
  for (const own of pieces) {
    const closed = rings(own);
    const polygon = closed === null ? [] : polygonOf(closed);
    if (polygon.length < 3) return null;
    cells.push(polygon);
  }
  return { cells, edges: edgesOf(all, cells), convex: false };
}

/** The territory of `map`: from its vector file if it has a usable one, else the Voronoi cells. */
export function territoryOf(map: MapFile, geo: GeoFile | null): Territory {
  return (geo === null ? null : geoTerritory(map, geo)) ?? voronoiTerritory(map);
}
