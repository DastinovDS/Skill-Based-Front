/**
 * The geometry of the road fortifications in the look "Set back, two masonries" (#858; #829 rounds 3
 * and 4, ui-style 54c and 55c; the owner's pick): each wall keeps to its owner's half of the road. It
 * runs `WALL.offset` inside the land border, along the border with the cell the road leads to, and the
 * road passes through its gate short of the border point on the owner's side. The own wall is a
 * battlement (square merlons towards the border, square gate towers), the enemy's a palisade (pointed
 * stakes, round posts), so they differ in grey too. Zoomed out the offset and the masonry keep their
 * screen size (`wallScale`).
 *
 * Pure functions, no PixiJS: the runs come from `fortLayout.ts`, the view draws what these return.
 * Nothing here knows a rule: the server says which road of which node is fortified (`EdgeView.forts`).
 */
import type { Point } from './camera.ts';
import { runLine, runPoint, type Run } from './fortLayout.ts';

export type Masonry = 'battlement' | 'palisade';

/** The look, in world units at 100 % (mockup `wallGeo` F2, `wall4Stroke`, `gatePost4`). */
export const WALL = {
  /** The wall lies this far inside the land border (and its gate this far short of the border point). */
  offset: 6,
  /** Half the opening of a gate along a wall square to the road (wider for a slanting road). */
  gate: 4.4,
  /** The band of the wall in the owner's colour, and the dark casing round it (each side). */
  band: 2.2,
  casing: 1.3,
  /** The teeth: battlement merlons (square) and palisade stakes (pointed), towards the border. */
  battlement: { pitch: 4.6, half: 1.25, rise: 2.3 },
  palisade: { pitch: 3.7, half: 1.3, rise: 3.1 },
  /** The casing of a tooth reaches this much beyond it. */
  toothCasing: 1.1,
  /** The ivory hairline on the city side, this far behind the band. */
  ink: 0.8,
  inkGap: 1.2,
  /** A gate post or an end tower: half its side (a square) or its radius (a round post), and its casing. */
  post: 2.5,
  postCasing: 1.2,
  /** A run of joined walls stops this far short of its ends (its towers stand there). */
  endTrim: 2.6,
  /** Two built walls of one node closer than this along the ring are one stroke. */
  joinGap: 26,
  /** A second wall on the same stretch of one node lies this much further in. */
  stack: 9,
  /** The part not built yet: points this far apart, this big. */
  dots: { pitch: 5, radius: 0.6, min: 0.7, alpha: 0.6 },
  /** The head of a build: a lozenge of this half size on a casing. */
  head: { ink: 2, casing: 3.4 },
  /** The ghosts of the pick: their opacity, the hovered one's. */
  ghost: { alpha: 0.6, hover: 1, casingAlpha: 0.8 },
  /** A capture: the walls break into lengths that sink outwards and fade (mockup `frontierWall4`). */
  fall: { piece: 5, step: 6, ms: 1200, spread: 0.4, span: 0.7, drift: 6, drop: 3 },
  /** The largest scale of the masonry zoomed out. */
  maxScale: 2.5,
} as const;

/**
 * The scale of the masonry for a camera scale (CSS px per world unit): 1 at 95 % and closer, growing
 * as the map is zoomed out so the walls keep their screen size, in steps of an eighth (a gliding
 * camera redraws a few times, not every frame).
 */
export function wallScale(cameraScale: number): number {
  if (!(cameraScale > 0)) return 1;
  return Math.min(WALL.maxScale, Math.max(1, Math.round((0.95 / cameraScale) * 8) / 8));
}

/** A gate: where along the run (arc length from its first point) and half its opening. */
export interface WallGate {
  readonly at: number;
  readonly half: number;
  /** Unit vector along the road, out of the cell: the gate towers are turned to it. */
  readonly road: Point;
}

/**
 * The gate of a road on a run: where the wall line (`offset` inside the border) meets the road that
 * crosses the border at arc `crossing`. `road` points along the road out of the cell. A road that
 * slants across the border moves the gate along the wall and widens it.
 */
export function gateOnRun(
  run: Run,
  crossing: number,
  road: Point,
  offset: number,
  half: number,
): WallGate {
  const q = runPoint(run, crossing);
  const across = road.x * q.nx + road.y * q.ny;
  const along = road.x * q.tx + road.y * q.ty;
  const sine = Math.max(0.5, Math.abs(across));
  const shift = (-offset * along) / sine;
  const at = Math.max(0, Math.min(run.len, crossing + shift));
  return { at, half: half / sine, road };
}

/** The pieces of a wall from `from` to `to` between its gates, and the posts at both sides of each gate. */
export function wallParts(
  from: number,
  to: number,
  gates: readonly WallGate[],
): { parts: [number, number][]; posts: { at: number; gate: WallGate }[] } {
  const parts: [number, number][] = [];
  const posts: { at: number; gate: WallGate }[] = [];
  let at = from;
  for (const gate of [...gates].sort((a, b) => a.at - b.at)) {
    const a = gate.at - gate.half;
    const b = gate.at + gate.half;
    if (b < from || a > to) continue;
    if (a > at + 0.5) parts.push([at, a]);
    for (const e of [a, b]) if (e > from + 0.5 && e < to - 0.5) posts.push({ at: e, gate });
    at = Math.max(at, b);
  }
  if (at < to - 0.5) parts.push([at, to]);
  return { parts, posts };
}

/** The wall line from arc `a0` to `a1` (arc lengths from the first point of the run), `off` out of the border. */
export function wallLine(run: Run, a0: number, a1: number, off: number): Point[] {
  return runLine(run, a0 - run.s0, a1 - run.s0, off);
}

/** A point of the run at arc `a`, `off` out of the border, with its unit tangent and outward normal. */
export function wallPoint(
  run: Run,
  a: number,
  off: number,
): { x: number; y: number; tx: number; ty: number; nx: number; ny: number } {
  const q = runPoint(run, a);
  return {
    x: q.x + q.nx * off * q.m,
    y: q.y + q.ny * off * q.m,
    tx: q.tx,
    ty: q.ty,
    nx: q.nx,
    ny: q.ny,
  };
}

/**
 * The teeth of a wall from `a0` to `a1` whose band is centred `depth` inside the border: battlement
 * merlons (rectangles) or palisade stakes (triangles), standing on the band and pointing at the
 * border. `grow` widens each (the casing under them). `s` is the masonry scale.
 */
export function wallTeeth(
  run: Run,
  a0: number,
  a1: number,
  depth: number,
  kind: Masonry,
  s: number,
  grow = 0,
): Point[][] {
  const look = WALL[kind];
  const pitch = look.pitch * s;
  const band = WALL.band * s;
  const teeth: Point[][] = [];
  for (let a = a0 + pitch / 2; a < a1 - pitch * 0.25; a += pitch) {
    const q = runPoint(run, a);
    const at = (along: number, out: number): Point => {
      const h = -depth + out;
      return { x: q.x + q.tx * along + q.nx * h * q.m, y: q.y + q.ty * along + q.ny * h * q.m };
    };
    const h0 = band / 2 - 0.3;
    if (kind === 'battlement') {
      const hw = look.half * s + grow;
      const h1 = band / 2 + look.rise * s + grow;
      teeth.push([at(-hw, h0), at(hw, h0), at(hw, h1), at(-hw, h1)]);
    } else {
      const hw = look.half * s + grow * 0.7;
      const h1 = band / 2 + look.rise * s + grow * 1.6;
      teeth.push([at(-hw, h0), at(hw, h0), at(0, h1)]);
    }
  }
  return teeth;
}

/** The corners of a square of half side `half` centred on `at`, turned to the unit vector `dir`. */
export function squareAt(at: Point, dir: Point, half: number): Point[] {
  const ux = dir.x * half;
  const uy = dir.y * half;
  return [
    { x: at.x - ux + uy, y: at.y - uy - ux },
    { x: at.x + ux + uy, y: at.y + uy - ux },
    { x: at.x + ux - uy, y: at.y + uy + ux },
    { x: at.x - ux - uy, y: at.y - uy + ux },
  ];
}

/** How far a build has grown from its gate, both ways (mockup: eased in and out). */
export function buildSpan(
  len: number,
  gate: WallGate | null,
  share: number,
): { a: number; a0: number; b0: number; b: number } {
  const p = Math.max(0, Math.min(1, share));
  const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
  const mid = gate?.at ?? len / 2;
  const half = gate?.half ?? 0;
  const a0 = Math.max(0, mid - half);
  const b0 = Math.min(len, mid + half);
  return { a: a0 - a0 * e, a0, b0, b: b0 + (len - b0) * e };
}

/** The points of the part not built yet: every `pitch` along `[from, to]` outside the built `[a, b]`. */
export function dotArcs(len: number, built: readonly [number, number][], pitch: number): number[] {
  const out: number[] = [];
  for (let d = 2; d < len; d += pitch) {
    if (built.some(([a, b]) => d >= a && d <= b)) continue;
    out.push(d);
  }
  return out;
}

/**
 * A capture: the pieces of a fallen wall and how far each has gone (0 standing, 1 gone), `age` ms
 * after the fall started. The wall breaks into lengths of `piece` every `step`; those nearest the
 * middle go first.
 */
export function fallPieces(
  len: number,
  age: number,
  s: number,
): { from: number; to: number; q: number }[] {
  const { piece, step, ms, spread, span } = WALL.fall;
  // The mockup counts the fall in seconds; `ms` is when every piece has gone.
  const t = Math.min(age, ms) / 1000;
  const out: { from: number; to: number; q: number }[] = [];
  for (let d = 0; d < len; d += step * s) {
    const q = Math.max(
      0,
      Math.min(1, (t - (Math.abs(d - len / 2) / Math.max(1, len)) * spread) / span),
    );
    if (q >= 1) continue;
    out.push({ from: d, to: Math.min(len, d + piece * s), q });
  }
  return out;
}
