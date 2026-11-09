/**
 * The order arrow of the Engraved style, Cased running (#851, ui-style 54h; mockup
 * `in-game-style-r5.html`, `burinArrow` B2): one drawing for an own order, the ghost of a sent one,
 * the path on hover (hollow, 54i), a refusal and the order an undo winds back (54b).
 *
 * The geometry is pure (offsets, slices, the head, the burin points, the hatch across a hollow
 * body); `drawCasedArrow` lays it into a `Graphics` as flat strokes and fills: no filter, a few
 * shapes per arrow. Paths come from the server (`order.path`, `ack.path`, `ReachNode.path`): nothing
 * here finds a route (AGENTS.md 7.1).
 */
import type { Graphics } from 'pixi.js';
import type { Point } from './camera.ts';
import { CASED, CASING, DARK_PLATE, INK } from './style.ts';

function dist(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Length of a polyline. */
export function pathLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a !== undefined && b !== undefined) total += dist(a, b);
  }
  return total;
}

/** The point `d` along a polyline and the unit direction there (clamped to its ends). */
export function pointAlong(points: readonly Point[], d: number): { at: Point; dir: Point } {
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a === undefined || b === undefined) continue;
    const l = dist(a, b);
    if (acc + l >= d || i === points.length - 1) {
      const s = l === 0 ? 0 : Math.min(1, Math.max(0, (d - acc) / l));
      return {
        at: { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s },
        dir: l === 0 ? { x: 1, y: 0 } : { x: (b.x - a.x) / l, y: (b.y - a.y) / l },
      };
    }
    acc += l;
  }
  const only = points[0] ?? { x: 0, y: 0 };
  return { at: only, dir: { x: 1, y: 0 } };
}

/** The stretch of a polyline from `from` to `to` along it; empty when `to <= from`. */
export function slicePath(points: readonly Point[], from: number, to: number): Point[] {
  if (to <= from || points.length < 2) return [];
  const out: Point[] = [pointAlong(points, from).at];
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a === undefined || b === undefined) continue;
    acc += dist(a, b);
    if (acc > from && acc < to) out.push(b);
  }
  out.push(pointAlong(points, to).at);
  return out;
}

/** `points` with `start` cut off its first point and `end` off its last, along the polyline. */
export function trimPath(points: readonly Point[], start: number, end: number): Point[] {
  return slicePath(points, start, pathLength(points) - end);
}

/**
 * The offset of a polyline by `d` to the side of `(dir.y, -dir.x)` (the mockup's `poff`), mitred;
 * a sharp turn takes the normal of the step into it unmitred, so it never spikes.
 */
export function offsetPath(points: readonly Point[], d: number): Point[] {
  const n = points.length;
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[i];
    const c = points[Math.min(n - 1, i + 1)];
    if (a === undefined || b === undefined || c === undefined) continue;
    let ux = b.x - a.x;
    let uy = b.y - a.y;
    let vx = c.x - b.x;
    let vy = c.y - b.y;
    const lu = Math.hypot(ux, uy) || 1;
    const lv = Math.hypot(vx, vy) || 1;
    ux /= lu;
    uy /= lu;
    vx /= lv;
    vy /= lv;
    // A step of no length has no direction: take the other one.
    if (i === 0 || lu < 0.25) {
      ux = vx;
      uy = vy;
    }
    if (i === n - 1 || lv < 0.25) {
      vx = ux;
      vy = uy;
    }
    let nx = uy + vy;
    let ny = -(ux + vx);
    const ln = Math.hypot(nx, ny) || 1;
    nx /= ln;
    ny /= ln;
    const cos = nx * uy - ny * ux;
    if (cos < 0.55) {
      out.push({ x: b.x + uy * d, y: b.y - ux * d });
      continue;
    }
    out.push({ x: b.x + (nx * d) / cos, y: b.y + (ny * d) / cos });
  }
  return out;
}

/**
 * A solid barbed head with its tip at `tip`, pointing along `dir`, `length` long and `width` of its
 * length to each side; the notch at 0.72 of the length (the mockup's `headAt`).
 */
export function barbHead(tip: Point, dir: Point, length: number, width: number): Point[] {
  const nx = -dir.y;
  const ny = dir.x;
  return [
    tip,
    {
      x: tip.x - dir.x * length + nx * length * width,
      y: tip.y - dir.y * length + ny * length * width,
    },
    { x: tip.x - dir.x * length * 0.72, y: tip.y - dir.y * length * 0.72 },
    {
      x: tip.x - dir.x * length - nx * length * width,
      y: tip.y - dir.y * length - ny * length * width,
    },
  ];
}

/** A burin point on a body: `d` along it, and how much of it shows near the ends (0..1). */
export interface BurinMark {
  readonly d: number;
  readonly fade: number;
}

/**
 * The running burin points of a body `length` long at `seconds` (one per `CASED.burin.step`, moving
 * at `CASED.burin.speed`); none within `margin` of the ends, fading in over `fade` near them.
 */
export function burinMarks(length: number, seconds: number): BurinMark[] {
  const { step, speed, fade, margin } = CASED.burin;
  const out: BurinMark[] = [];
  const phase = (((seconds * speed) % step) + step) % step;
  for (let d = phase; d < length - margin; d += step) {
    if (d < margin) continue;
    out.push({ d, fade: Math.min(1, d / fade, (length - d) / fade) });
  }
  return out;
}

/**
 * The pitch of a fine hatch in world units at `zoom` css px per unit: `pitch`, doubled by zoom
 * buckets of a power of two while it would be under `minPx` on screen (the mockup's `hp`).
 */
export function hatchPitch(pitch: number, zoom: number, minPx: number = CASED.hatch.minPx): number {
  const screen = pitch * Math.max(1e-3, zoom);
  if (screen >= minPx) return pitch;
  return pitch * 2 ** Math.ceil(Math.log2(minPx / screen));
}

/** The short strokes of a hatch across a body: one every `pitch` along it, `half` to each side. */
export function hatchAcross(
  points: readonly Point[],
  pitch: number,
  half: number,
): [Point, Point][] {
  const out: [Point, Point][] = [];
  const length = pathLength(points);
  if (pitch <= 0) return out;
  for (let d = pitch / 2; d < length; d += pitch) {
    const { at, dir } = pointAlong(points, d);
    out.push([
      { x: at.x - dir.y * half, y: at.y + dir.x * half },
      { x: at.x + dir.y * half, y: at.y - dir.x * half },
    ]);
  }
  return out;
}

export interface CasedLook {
  /** The owner's colour. */
  readonly color: number;
  /** Hollow: the owner's hatch across the body, the head dark and hatched (a ghost, the path). */
  readonly ghost?: boolean;
  readonly alpha?: number;
  /** Seconds for the running burin points; `null`: no burin points. */
  readonly seconds?: number | null;
  /** No head: the body runs to the end of `points` (an order winding back). */
  readonly noHead?: boolean;
  /** One device pixel in world units: no hairline is thinner. */
  readonly hair: number;
  /** The camera, css px per world unit: the hatch of a hollow body keeps its screen pitch. */
  readonly zoom: number;
}

function trace(g: Graphics, points: readonly Point[]): void {
  const [first, ...rest] = points;
  if (first === undefined) return;
  g.moveTo(first.x, first.y);
  for (const p of rest) g.lineTo(p.x, p.y);
}

/**
 * Lays one Cased running arrow along `points` (world units, the head at the last point) into `g`:
 * the paper casing, the dark casing, the core or the hatch, two ink hairlines, the burin points,
 * then the head. Nothing for a polyline shorter than 4 units.
 */
export function drawCasedArrow(g: Graphics, points: readonly Point[], look: CasedLook): void {
  const length = pathLength(points);
  if (points.length < 2 || length < 4) return;
  const alpha = look.alpha ?? 1;
  const ghost = look.ghost === true;
  const { half, head } = CASED;
  const hair = (w: number): number => Math.max(w, look.hair);
  const bodyEnd =
    look.noHead === true ? length : Math.max(0, length - (head.length - head.overlap));
  const body = slicePath(points, 0, bodyEnd);
  const wide = half * 2 + CASED.casing;
  const paperAlpha = (ghost ? CASED.paper.ghost : CASED.paper.alpha) * alpha;
  const style = { cap: 'round', join: 'round' } as const;
  if (body.length >= 2) {
    trace(g, body);
    g.stroke({ ...style, width: wide + CASED.paper.extra, color: INK, alpha: paperAlpha });
    trace(g, body);
    g.stroke({ ...style, width: wide, color: CASING, alpha });
    if (ghost) {
      const pitch = hatchPitch(CASED.hatch.pitch, look.zoom);
      const ticks = hatchAcross(body, pitch, half - 0.3);
      for (const [a, b] of ticks) g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      if (ticks.length > 0)
        g.stroke({
          width: hair(CASED.hatch.width),
          color: look.color,
          alpha: CASED.hatch.alpha * alpha,
          cap: 'butt',
        });
    } else {
      trace(g, body);
      g.stroke({ ...style, width: half * 2 - CASED.coreInset, color: look.color, alpha });
    }
    for (const side of [half, -half]) {
      trace(g, offsetPath(body, side));
      g.stroke({ ...style, width: hair(CASED.ink), color: INK, alpha });
    }
    if (look.seconds !== null && look.seconds !== undefined) {
      const B = CASED.burin;
      const bodyLength = pathLength(body);
      for (const mark of burinMarks(bodyLength, look.seconds)) {
        const { at, dir } = pointAlong(body, mark.d);
        const nx = -dir.y;
        const ny = dir.x;
        const lozenge = [
          at.x + dir.x * B.half,
          at.y + dir.y * B.half,
          at.x + nx * B.side,
          at.y + ny * B.side,
          at.x - dir.x * B.half,
          at.y - dir.y * B.half,
          at.x - nx * B.side,
          at.y - ny * B.side,
        ];
        g.poly(lozenge)
          .stroke({ width: B.casing, color: CASING, alpha: alpha * mark.fade, join: 'round' })
          .fill({ color: INK, alpha: alpha * mark.fade });
      }
    }
  }
  if (look.noHead === true) return;
  const end = pointAlong(points, length);
  const barbs = barbHead(end.at, end.dir, head.length, head.width);
  const flat = barbs.flatMap((p) => [p.x, p.y]);
  g.poly(flat).stroke({ width: head.paper, color: INK, alpha: paperAlpha, join: 'round' });
  g.poly(flat).stroke({ width: head.casing, color: CASING, alpha, join: 'round' });
  g.poly(flat).fill({ color: ghost ? DARK_PLATE : look.color, alpha });
  if (ghost) {
    // The hatch across the head, inside its solid part (up to the notch).
    const pitch = hatchPitch(CASED.hatch.pitch, look.zoom);
    let any = false;
    for (let a = pitch; a < head.length * 0.72; a += pitch) {
      const w = a * head.width * 0.9;
      const cx = end.at.x - end.dir.x * a;
      const cy = end.at.y - end.dir.y * a;
      g.moveTo(cx - end.dir.y * w, cy + end.dir.x * w).lineTo(
        cx + end.dir.y * w,
        cy - end.dir.x * w,
      );
      any = true;
    }
    if (any) g.stroke({ width: hair(CASED.hatch.width), color: look.color, alpha, cap: 'butt' });
  }
  g.poly(flat).stroke({ width: hair(head.ink), color: INK, alpha, join: 'round' });
}

/** The part of an order already walked: ink dots along it. */
export function drawWalkedDots(
  g: Graphics,
  points: readonly Point[],
  hair: number,
  alpha = 1,
): void {
  const { step, radius } = CASED.walked;
  const length = pathLength(points);
  let any = false;
  for (let d = 2; d < length - 2; d += step) {
    const { at } = pointAlong(points, d);
    g.circle(at.x, at.y, Math.max(radius, hair / 2));
    any = true;
  }
  if (any) g.fill({ color: INK, alpha: CASED.walked.alpha * alpha });
}
