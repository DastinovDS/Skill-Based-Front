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

/** The width of a helmet against the size step of its token (`UNIT_SIDES`, the mockup's 1.34). */
export const HELMET_SCALE = 1.34;

/**
 * Line widths of a helmet `width` wide (world units): the strap and the brim follow the size down to
 * a floor that still reads at 20 px; the dark casing and the light edge are fixed.
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
/** The memo holds this many helmets at most: the menu picture asks for a new width almost every frame. */
const MAX_HELMETS = 64;

/** How many helmets the memo holds now (a test reads it). */
export function helmetCacheSize(): number {
  return HELMETS.size;
}

/** The helmet of `kind` `width` wide (memoised, and the memo is bounded: it starts over when full). */
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
  if (HELMETS.size >= MAX_HELMETS) HELMETS.clear();
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

// --- Geometry helpers -------------------------------------------------------------------------------

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
