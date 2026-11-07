/**
 * The helmet of a unit (#784, variant Full of #775): a side view of a combat helmet, the own one with
 * a brim line ("Rim"), the opponent's with a cut-out at the ear ("Cut"), both with a chin strap. Pure
 * geometry, no PixiJS: the map (`render/bakedShapes.ts`), the arena, the particles and the icons of the
 * screens (`app/UnitMark.svelte`) draw from the same outlines.
 *
 * The outlines are drawn facing right in a box of 100 units. The own helmet faces right, the
 * opponent's left: a view flips the drawing (`scale.x = -1`), so a facing costs no texture. The
 * owner is told by the silhouette and the facing, not by the hue alone (AGENTS.md 7.4).
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Whose helmet: the viewer's (Rim, faces right) or the opponent's (Cut, faces left). */
export type HelmetKind = 'own' | 'enemy';

/** The outlines of a helmet as SVG path data, facing right, in a 100-unit box. */
export interface HelmetPaths {
  /** The dome: a closed outline, the part the charge fills. */
  readonly dome: string;
  /** The brim line under the dome (own only): a stroke. */
  readonly band: string | null;
  /** The chin strap: a stroke. */
  readonly strap: string;
}

export const HELMET_PATHS: Readonly<Record<HelmetKind, HelmetPaths>> = {
  own: {
    dome: 'M9 70 C5 36 22 12 49 12 C70 12 85 26 88 42 C89 47 91 50 95 53 C82 54 72 56 66 60 C60 64 56 70 46 70 Z',
    band: 'M7 77 C20 79 34 80 46 79 C56 78 62 71 67 67 C72 63 82 61 96 60',
    strap: 'M46 80 L54 96',
  },
  enemy: {
    dome: 'M8 54 C8 30 28 13 52 13 C74 13 90 30 92 46 L98 54 Q99 58 95 58 L74 58 C65 58 60 64 57 73 C56 77 52 78 46 77 C32 74 18 69 12 64 Q8 61 8 54 Z',
    band: null,
    strap: 'M38 75 L58 91 L64 68',
  },
};

/** The width of a helmet against the side of the triangle it replaces (the mockup's 1.34). */
export const HELMET_SCALE = 1.34;

/**
 * Line widths of a helmet `width` wide (world units): the strap and the brim follow the size down to
 * a floor that still reads at 20 px; the dark casing and the light edge are fixed, like the
 * triangle's outline.
 */
export function helmetLines(width: number): {
  strap: number;
  band: number;
  casing: number;
  edge: number;
} {
  const s = width / 100;
  return { strap: Math.max(6.4 * s, 2.1), band: Math.max(5.6 * s, 2.2), casing: 6.4, edge: 2.1 };
}

// --- Path sampling -------------------------------------------------------------------------------

/** Points along SVG path data with absolute M, L, C, Q and Z commands (all the helmets use). */
export function samplePath(d: string, steps = 10): { points: Point[]; closed: boolean } {
  const tokens = d.match(/[MLCQZ]|-?\d*\.?\d+/g) ?? [];
  const points: Point[] = [];
  let i = 0;
  let command = '';
  let closed = false;
  const num = (): number => Number(tokens[i++]);
  let at: Point = { x: 0, y: 0 };
  while (i < tokens.length) {
    const token = tokens[i] ?? '';
    if (/[MLCQZ]/.test(token)) {
      command = token;
      i++;
      if (command === 'Z') {
        closed = true;
        continue;
      }
    }
    if (command === 'M' || command === 'L') {
      at = { x: num(), y: num() };
      points.push(at);
    } else if (command === 'C') {
      const c1 = { x: num(), y: num() };
      const c2 = { x: num(), y: num() };
      const end = { x: num(), y: num() };
      for (let k = 1; k <= steps; k++) {
        const t = k / steps;
        const u = 1 - t;
        points.push({
          x: u * u * u * at.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * end.x,
          y: u * u * u * at.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * end.y,
        });
      }
      at = end;
    } else if (command === 'Q') {
      const c = { x: num(), y: num() };
      const end = { x: num(), y: num() };
      for (let k = 1; k <= steps; k++) {
        const t = k / steps;
        const u = 1 - t;
        points.push({
          x: u * u * at.x + 2 * u * t * c.x + t * t * end.x,
          y: u * u * at.y + 2 * u * t * c.y + t * t * end.y,
        });
      }
      at = end;
    } else {
      i++;
    }
  }
  return { points, closed };
}

// --- A helmet at a size ----------------------------------------------------------------------------

/** A helmet `width` wide, facing right, around the centre of its outline (world units). */
export interface Helmet {
  readonly width: number;
  /** The closed outline of the dome. */
  readonly dome: readonly Point[];
  readonly band: readonly Point[] | null;
  readonly strap: readonly Point[];
  /** The bounds of the outline lines (without their widths). */
  readonly bounds: { x: number; y: number; width: number; height: number };
  /** The top and the bottom of the dome: the charge fills between them, from the bottom. */
  readonly domeTop: number;
  readonly domeBottom: number;
  /** Where the number (and the "?") sits: the middle of the dome. */
  readonly middle: Point;
}

const RAW: Readonly<Record<HelmetKind, { dome: Point[]; band: Point[] | null; strap: Point[] }>> = {
  own: raw('own'),
  enemy: raw('enemy'),
};

function raw(kind: HelmetKind): { dome: Point[]; band: Point[] | null; strap: Point[] } {
  const paths = HELMET_PATHS[kind];
  return {
    dome: samplePath(paths.dome).points,
    band: paths.band === null ? null : samplePath(paths.band).points,
    strap: samplePath(paths.strap).points,
  };
}

function boundsOf(points: readonly Point[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The centre of the whole drawing in the 100-unit box: the origin of a helmet. */
function centreOf(kind: HelmetKind): Point {
  const { dome, band, strap } = RAW[kind];
  const b = boundsOf([...dome, ...(band ?? []), ...strap]);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** The area centre of a closed outline (where a number reads in the middle of the dome). */
function centroid(points: readonly Point[]): Point {
  let area = 0;
  let cx = 0;
  let cy = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length] ?? p;
    const cross = p.x * q.y - q.x * p.y;
    area += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  });
  return area === 0 ? (points[0] ?? { x: 0, y: 0 }) : { x: cx / (3 * area), y: cy / (3 * area) };
}

const HELMETS = new Map<string, Helmet>();

/** The helmet of `kind` `width` wide (memoised: the sizes are a few steps). */
export function helmet(kind: HelmetKind, width: number): Helmet {
  const key = `${kind}:${String(width)}`;
  const known = HELMETS.get(key);
  if (known !== undefined) return known;
  const s = width / 100;
  const c = centreOf(kind);
  const place = (p: Point): Point => ({ x: (p.x - c.x) * s, y: (p.y - c.y) * s });
  const { dome: d, band: b, strap: st } = RAW[kind];
  const dome = d.map(place);
  const band = b === null ? null : b.map(place);
  const strap = st.map(place);
  const domeBounds = boundsOf(dome);
  const mid = centroid(dome);
  const made: Helmet = {
    width,
    dome,
    band,
    strap,
    bounds: boundsOf([...dome, ...(band ?? []), ...strap]),
    domeTop: domeBounds.y,
    domeBottom: domeBounds.y + domeBounds.height,
    // A little under the area centre: the dome is flatter at the bottom.
    middle: { x: mid.x, y: mid.y + width * 0.02 },
  };
  HELMETS.set(key, made);
  return made;
}

/**
 * The helmet in the 100-unit box of `HELMET_PATHS` (the icons of the screens draw the paths as they
 * are): the dome as points and the bounds of the whole drawing.
 */
export function helmetIcon(kind: HelmetKind): {
  dome: readonly Point[];
  bounds: { x: number; y: number; width: number; height: number };
  domeTop: number;
  domeBottom: number;
} {
  const { dome, band, strap } = RAW[kind];
  const d = boundsOf(dome);
  return {
    dome,
    bounds: boundsOf([...dome, ...(band ?? []), ...strap]),
    domeTop: d.y,
    domeBottom: d.y + d.height,
  };
}

/** How far the drawing reaches from the origin, casing and strap included (world units). */
export function helmetExtent(h: Helmet): {
  top: number;
  bottom: number;
  left: number;
  right: number;
} {
  const { casing, strap } = helmetLines(h.width);
  const pad = Math.max(casing, strap + casing) / 2;
  return {
    top: h.bounds.y - pad,
    bottom: h.bounds.y + h.bounds.height + pad,
    left: h.bounds.x - pad,
    right: h.bounds.x + h.bounds.width + pad,
  };
}

/** `points` mirrored about the vertical axis through the origin (a helmet that faces left). */
export function mirrored(points: readonly Point[], facing: 1 | -1): Point[] {
  return facing === 1 ? [...points] : points.map((p) => ({ x: -p.x, y: p.y }));
}

// --- Geometry helpers -------------------------------------------------------------------------------

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t =
    length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function polylineDistance(p: Point, line: readonly Point[], closed: boolean): number {
  let best = Infinity;
  const n = line.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = line[i];
    const b = line[(i + 1) % n];
    if (a !== undefined && b !== undefined) best = Math.min(best, segmentDistance(p, a, b));
  }
  return best;
}

/** Even-odd test: is `p` inside the closed outline? */
export function inside(p: Point, polygon: readonly Point[]): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a === undefined || b === undefined) continue;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      hit = !hit;
  }
  return hit;
}

/** The part of a closed outline below the line `y` (y grows down): a polygon, maybe empty. */
export function clipBelow(polygon: readonly Point[], y: number): Point[] {
  const out: Point[] = [];
  polygon.forEach((p, i) => {
    const q = polygon[(i + 1) % polygon.length] ?? p;
    const pIn = p.y >= y;
    const qIn = q.y >= y;
    if (pIn) out.push(p);
    if (pIn !== qIn) {
      const t = (y - p.y) / (q.y - p.y);
      out.push({ x: p.x + t * (q.x - p.x), y });
    }
  });
  return out;
}

/** Horizontal lines `pitch` apart across a closed outline (the hatching of a discharged chip). */
export function scanLines(polygon: readonly Point[], pitch: number): [Point, Point][] {
  const b = boundsOf(polygon);
  const lines: [Point, Point][] = [];
  for (let y = b.y + pitch; y < b.y + b.height - 0.5; y += pitch) {
    const xs: number[] = [];
    polygon.forEach((p, i) => {
      const q = polygon[(i + 1) % polygon.length] ?? p;
      if (p.y > y !== q.y > y) xs.push(p.x + ((y - p.y) * (q.x - p.x)) / (q.y - p.y));
    });
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = xs[k];
      const to = xs[k + 1];
      if (from !== undefined && to !== undefined)
        lines.push([
          { x: from, y },
          { x: to, y },
        ]);
    }
  }
  return lines;
}

/** Dashes along a closed outline, the pattern running on across its corners: pieces of polyline. */
export function dashLoop(polygon: readonly Point[], dash: number, gap: number): Point[][] {
  const pieces: Point[][] = [];
  let on = true;
  let left = dash;
  let piece: Point[] = [];
  const first = polygon[0];
  if (first === undefined) return pieces;
  piece.push(first);
  for (let i = 0; i < polygon.length; i++) {
    let a = polygon[i] ?? first;
    const b = polygon[(i + 1) % polygon.length] ?? first;
    let length = Math.hypot(b.x - a.x, b.y - a.y);
    while (length > 0) {
      const step = Math.min(left, length);
      const t = step / length;
      const at = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (on) piece.push(at);
      left -= step;
      length -= step;
      a = at;
      if (left <= 1e-9) {
        if (on && piece.length > 1) pieces.push(piece);
        on = !on;
        left = on ? dash : gap;
        piece = on ? [at] : [];
      }
    }
  }
  if (on && piece.length > 1) pieces.push(piece);
  return pieces;
}

// --- The outline of the selection and the hover ------------------------------------------------------

const OUTLINES = new Map<string, number[]>();

/**
 * A closed line `offset` outside the whole silhouette of the helmet, strap and brim included (the
 * selection and the hover follow it, #784): the level `offset` of the distance to the dome, the brim
 * and the strap (each with half its line width), traced by marching squares. Facing right, world
 * units, flat `[x, y, ...]`; memoised per kind, width and offset.
 */
export function helmetOutline(kind: HelmetKind, width: number, offset: number): number[] {
  const key = `${kind}:${String(width)}:${String(offset)}`;
  const known = OUTLINES.get(key);
  if (known !== undefined) return known;
  const h = helmet(kind, width);
  const lines = helmetLines(width);
  const field = (p: Point): number => {
    const dome = inside(p, h.dome) ? 0 : polylineDistance(p, h.dome, true);
    const strap = polylineDistance(p, h.strap, false) - lines.strap / 2;
    const band = h.band === null ? Infinity : polylineDistance(p, h.band, false) - lines.band / 2;
    return Math.min(dome, strap, band) - offset;
  };
  const loop = marchingLoop(field, h.bounds, offset + 4, width / 60);
  OUTLINES.set(key, loop);
  return loop;
}

/** The longest closed level-0 line of `field` around `bounds` (grown by `margin`), `step` apart. */
function marchingLoop(
  field: (p: Point) => number,
  bounds: { x: number; y: number; width: number; height: number },
  margin: number,
  step: number,
): number[] {
  const x0 = bounds.x - margin;
  const y0 = bounds.y - margin;
  const nx = Math.ceil((bounds.width + 2 * margin) / step) + 1;
  const ny = Math.ceil((bounds.height + 2 * margin) / step) + 1;
  const v: number[] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) v.push(field({ x: x0 + i * step, y: y0 + j * step }));
  }
  const at = (i: number, j: number): number => v[j * nx + i] ?? 1;
  // An edge crossing is keyed by the grid edge it lies on, so neighbouring cells share it.
  const point = new Map<string, Point>();
  const cross = (i0: number, j0: number, i1: number, j1: number): string => {
    const key = `${String(i0)},${String(j0)},${String(i1)},${String(j1)}`;
    if (!point.has(key)) {
      const a = at(i0, j0);
      const b = at(i1, j1);
      const t = a === b ? 0.5 : a / (a - b);
      point.set(key, {
        x: x0 + (i0 + (i1 - i0) * t) * step,
        y: y0 + (j0 + (j1 - j0) * t) * step,
      });
    }
    return key;
  };
  const next = new Map<string, string>();
  for (let j = 0; j + 1 < ny; j++) {
    for (let i = 0; i + 1 < nx; i++) {
      const top = cross(i, j, i + 1, j);
      const right = cross(i + 1, j, i + 1, j + 1);
      const bottom = cross(i, j + 1, i + 1, j + 1);
      const left = cross(i, j, i, j + 1);
      const code =
        (at(i, j) < 0 ? 8 : 0) |
        (at(i + 1, j) < 0 ? 4 : 0) |
        (at(i + 1, j + 1) < 0 ? 2 : 0) |
        (at(i, j + 1) < 0 ? 1 : 0);
      // Segments oriented with the inside on one hand, so the pieces chain into loops.
      const segments: [string, string][] =
        SEGMENTS[code]?.map(([a, b]) => [
          [top, right, bottom, left][a] ?? top,
          [top, right, bottom, left][b] ?? top,
        ]) ?? [];
      for (const [a, b] of segments) next.set(a, b);
    }
  }
  let best: string[] = [];
  const seen = new Set<string>();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop: string[] = [];
    let key: string | undefined = start;
    while (key !== undefined && !seen.has(key)) {
      seen.add(key);
      loop.push(key);
      key = next.get(key);
    }
    if (loop.length > best.length) best = loop;
  }
  return best.flatMap((key) => {
    const p = point.get(key);
    return p === undefined ? [] : [p.x, p.y];
  });
}

/**
 * The marching squares table: per corner code (8 top left, 4 top right, 2 bottom right, 1 bottom
 * left inside) the segments as pairs of cell edges (0 top, 1 right, 2 bottom, 3 left), oriented so
 * the inside is always on the same hand. The two saddles take the separated reading.
 */
const SEGMENTS: readonly (readonly (readonly [number, number])[])[] = [
  [],
  [[3, 2]],
  [[2, 1]],
  [[3, 1]],
  [[1, 0]],
  [
    [1, 0],
    [3, 2],
  ],
  [[2, 0]],
  [[3, 0]],
  [[0, 3]],
  [[0, 2]],
  [
    [0, 3],
    [2, 1],
  ],
  [[0, 1]],
  [[1, 3]],
  [[1, 2]],
  [[2, 3]],
  [],
];
