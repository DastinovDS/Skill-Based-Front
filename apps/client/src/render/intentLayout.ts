/**
 * Geometry and timing of the order arrows (ui-style 9.7, U6, U7).
 *
 * Pure functions, no PixiJS and no DOM. Paths come from the server (`order.path`, `ack.path`) or
 * are one arc `origin -> target`: nothing here finds a route (AGENTS.md 7.1).
 */
import type { Point } from './camera.ts';
import type { GhostStatus } from './interaction.ts';
import { clipToConvex } from './regionLayout.ts';
import { GHOST_REJECT_MS, GHOST_SHAKE_AMPLITUDE, GHOST_SHAKE_MS, RIBBON } from './style.ts';

function dist(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Length of a polyline. */
export function polylineLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a !== undefined && b !== undefined) total += dist(a, b);
  }
  return total;
}

/**
 * The axis of a ribbon through `nodes`: every leg is a quadratic curve bent to the left of the
 * travel direction by `bend` of its chord. The first leg starts `startGap` from its first point
 * and the last ends `endGap` before its last (the rim of a city); `[]` if the legs are too short.
 */
export function ribbonAxis(
  nodes: readonly Point[],
  startGap: number,
  endGap: number,
  bend: number,
): Point[] {
  const axis: Point[] = [];
  const legs = nodes.length - 1;
  for (let i = 0; i < legs; i++) {
    const p = nodes[i];
    const q = nodes[i + 1];
    if (p === undefined || q === undefined) continue;
    const full = dist(p, q);
    if (full === 0) continue;
    const ux = (q.x - p.x) / full;
    const uy = (q.y - p.y) / full;
    const a = i === 0 ? { x: p.x + ux * startGap, y: p.y + uy * startGap } : p;
    const b = i === legs - 1 ? { x: q.x - ux * endGap, y: q.y - uy * endGap } : q;
    const len = dist(a, b);
    // The gaps swallowed the leg (or turned it around).
    if (len <= 0 || (b.x - a.x) * ux + (b.y - a.y) * uy <= 0) {
      if (i === legs - 1) return [];
      continue;
    }
    const mid = {
      x: (a.x + b.x) / 2 - uy * len * bend,
      y: (a.y + b.y) / 2 + ux * len * bend,
    };
    const steps = Math.min(40, Math.max(8, Math.ceil(len / 10)));
    for (let k = i === 0 || axis.length === 0 ? 0 : 1; k <= steps; k++) {
      const t = k / steps;
      const w = 1 - t;
      axis.push({
        x: w * w * a.x + 2 * w * t * mid.x + t * t * b.x,
        y: w * w * a.y + 2 * w * t * mid.y + t * t * b.y,
      });
    }
  }
  return axis.length >= 2 ? axis : [];
}

export interface Ribbon {
  /** Closed outline: left edge, the head, right edge. */
  outline: Point[];
  /** The axis of the body (up to the base of the head), for the delay stripe. */
  body: Point[];
  tip: Point;
}

/** Body width in world units such that the narrow tail is at least `RIBBON.minTailPx` on screen. */
export function ribbonBody(cameraScale: number): number {
  if (cameraScale <= 0) return RIBBON.body;
  return Math.max(RIBBON.body, RIBBON.minTailPx / RIBBON.tailRatio / cameraScale);
}

/**
 * The outline of a ribbon over `axis` (at least two points): the body narrows from the full width
 * to `tailRatio` of it at the tail, and ends in a head `headWidth` x `headLength` (both scale with
 * `body / RIBBON.body`). A short axis gets a proportionally smaller head. `null` if degenerate.
 */
export function ribbonOutline(axis: readonly Point[], body: number): Ribbon | null {
  const total = polylineLength(axis);
  if (axis.length < 2 || total <= 0) return null;
  const scale = body / RIBBON.body;
  let headL = RIBBON.headLength * scale;
  let headW = RIBBON.headWidth * scale;
  if (headL > total * 0.7) {
    headW *= (total * 0.7) / headL;
    headL = total * 0.7;
  }
  // The head starts exactly `headL` before the end of the axis.
  const bodyAxis = polylinePrefix(axis, (total - headL) / total);
  const cut = bodyAxis.length - 1;
  const left: Point[] = [];
  const right: Point[] = [];
  for (let i = 0; i <= cut; i++) {
    const a = bodyAxis[Math.max(0, i - 1)];
    const b = bodyAxis[Math.min(cut, i + 1)];
    const c = bodyAxis[i];
    if (a === undefined || b === undefined || c === undefined) continue;
    const l = dist(a, b) || 1;
    const nx = -(b.y - a.y) / l;
    const ny = (b.x - a.x) / l;
    const w = (body / 2) * (RIBBON.tailRatio + (1 - RIBBON.tailRatio) * (cut === 0 ? 1 : i / cut));
    left.push({ x: c.x + nx * w, y: c.y + ny * w });
    right.push({ x: c.x - nx * w, y: c.y - ny * w });
  }
  const base = bodyAxis[cut];
  const tip = axis[axis.length - 1];
  if (base === undefined || tip === undefined) return null;
  const hl = dist(base, tip) || 1;
  const nx = -(tip.y - base.y) / hl;
  const ny = (tip.x - base.x) / hl;
  return {
    outline: [
      ...left,
      { x: base.x + (nx * headW) / 2, y: base.y + (ny * headW) / 2 },
      tip,
      { x: base.x - (nx * headW) / 2, y: base.y - (ny * headW) / 2 },
      ...right.reverse(),
    ],
    body: bodyAxis,
    tip,
  };
}

/** The part of a polyline that covers `fraction` (0..1) of its length, from the first point. */
export function polylinePrefix(points: readonly Point[], fraction: number): Point[] {
  const first = points[0];
  if (first === undefined || fraction <= 0) return [];
  const target = polylineLength(points) * Math.min(1, fraction);
  const out: Point[] = [first];
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a === undefined || b === undefined) continue;
    const len = dist(a, b);
    if (acc + len >= target) {
      const t = len === 0 ? 0 : (target - acc) / len;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      return out;
    }
    acc += len;
    out.push(b);
  }
  return out;
}

/**
 * A polyline (closed if `closed`) cut into dashes of `dash` with `gap` between; `offset` moves
 * the pattern along the line (a running contour). Dashes may bend around corners.
 */
export function dashAlong(
  points: readonly Point[],
  dash: number,
  gap: number,
  offset: number,
  closed = false,
): Point[][] {
  const cycle = dash + gap;
  if (cycle <= 0 || dash <= 0 || points.length < 2) return [];
  const ring = closed && points[0] !== undefined ? [...points, points[0]] : points;
  let phase = ((offset % cycle) + cycle) % cycle;
  const out: Point[][] = [];
  let current: Point[] | null = null;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1];
    const b = ring[i];
    if (a === undefined || b === undefined) continue;
    const len = dist(a, b);
    let at = 0;
    while (at < len) {
      const drawing = phase < dash;
      const piece = Math.min(len - at, (drawing ? dash : cycle) - phase);
      const x = (d: number): Point => ({
        x: a.x + ((b.x - a.x) * d) / len,
        y: a.y + ((b.y - a.y) * d) / len,
      });
      if (drawing) {
        if (current === null) {
          current = [x(at)];
          out.push(current);
        }
        current.push(x(at + piece));
      } else {
        current = null;
      }
      at += piece;
      phase += piece;
      if (drawing && phase >= dash) current = null;
      if (phase >= cycle - 1e-9) phase = 0;
    }
  }
  return out;
}

export interface Chevron {
  at: Point;
  /** Unit vector of the direction of the line. */
  dir: Point;
}

/**
 * White chevrons along a thin order line, one flow over the WHOLE polyline (not restarted on every
 * leg): one every `spacing`, the first not before `first` from the start, none within `endMargin`
 * of the end. `offset` moves the whole pattern along the line (the running order); each chevron
 * points along the leg it stands on.
 */
export function chevrons(
  points: readonly Point[],
  spacing: number,
  first: number,
  endMargin: number,
  offset = 0,
): Chevron[] {
  const out: Chevron[] = [];
  if (spacing <= 0) return out;
  const total = polylineLength(points);
  // The first mark `first` from the start, then every `spacing`; the pattern slides by `offset`.
  let d = first + (((offset % spacing) + spacing) % spacing);
  let start = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a === undefined || b === undefined) continue;
    const len = dist(a, b);
    if (len === 0) continue;
    const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    for (; d < start + len && d < total - endMargin; d += spacing) {
      const into = d - start;
      out.push({ at: { x: a.x + dir.x * into, y: a.y + dir.y * into }, dir });
    }
    start += len;
  }
  return out;
}

/**
 * The part of a ribbon over a straight axis that `fraction` (0..1) of the delay has filled: its
 * outline cut across the axis at that share of the axis length (the delay fills the whole arrow
 * from the start to the tip). Empty for 0.
 */
export function ribbonFilled(
  outline: readonly Point[],
  axis: readonly Point[],
  fraction: number,
): Point[] {
  const from = axis[0];
  const to = axis[axis.length - 1];
  if (from === undefined || to === undefined || fraction <= 0) return [];
  if (fraction >= 1) return [...outline];
  const len = dist(from, to);
  if (len === 0) return [];
  const ux = (to.x - from.x) / len;
  const uy = (to.y - from.y) / len;
  // A box along the axis, wider than any ribbon: its far side is the filling front.
  const reach = len * fraction;
  const wide = 400;
  const box = [
    { x: from.x - ux * 4 - uy * wide, y: from.y - uy * 4 + ux * wide },
    { x: from.x + ux * reach - uy * wide, y: from.y + uy * reach + ux * wide },
    { x: from.x + ux * reach + uy * wide, y: from.y + uy * reach - ux * wide },
    { x: from.x - ux * 4 + uy * wide, y: from.y - uy * 4 - ux * wide },
  ];
  return clipToConvex(outline, box);
}

/**
 * The blink of a ribbon when its delay has just run out: bright for the first and third part of
 * `ticks`, normal in between. `since`: ticks after the end of the delay (negative before it).
 */
export function departBlink(since: number, ticks: number): boolean {
  if (since < 0 || since >= ticks) return false;
  return Math.floor((since / ticks) * 4) % 2 === 0;
}

/** How much of the delay of a planned order has run: 0 at its creation, 1 once the group left. */
export function delayProgress(createdTick: number, tick: number, delayTicks: number): number {
  if (delayTicks <= 0) return 1;
  return Math.min(1, Math.max(0, (tick - createdTick) / delayTicks));
}

/** Whole ticks until a planned order departs; 0 once it has (the countdown shown to the player). */
export function delayLeft(createdTick: number, tick: number, delayTicks: number): number {
  return Math.max(0, createdTick + delayTicks - Math.floor(tick));
}

export interface GhostLook {
  /** Sideways shake, world units. */
  dx: number;
  alpha: number;
  /** Solid line (the server accepted the order), else dashed. */
  solid: boolean;
}

/**
 * The look of the ghost of a sent order (U6): dashed while the server has not answered, solid once
 * it accepted; a rejected one shakes for `GHOST_SHAKE_MS` and fades until `GHOST_REJECT_MS` after
 * the answer. "Less motion" fades without the shake. `ageMs`: time since the rejection.
 */
export function ghostLook(
  status: GhostStatus,
  ageMs: number,
  base: number,
  reduced: boolean,
): GhostLook {
  if (status !== 'rejected') return { dx: 0, alpha: base, solid: status === 'accepted' };
  const shaking = ageMs < GHOST_SHAKE_MS && !reduced;
  const dx = shaking
    ? GHOST_SHAKE_AMPLITUDE *
      Math.sin((ageMs / GHOST_SHAKE_MS) * Math.PI * 8) *
      (1 - ageMs / GHOST_SHAKE_MS)
    : 0;
  const fade = Math.min(
    1,
    Math.max(0, (ageMs - GHOST_SHAKE_MS) / (GHOST_REJECT_MS - GHOST_SHAKE_MS)),
  );
  return { dx, alpha: base * (1 - fade), solid: false };
}
