/**
 * Geometry and timing of the order arrows (ui-style 9.7, U6, U7).
 *
 * Pure functions, no PixiJS and no DOM. Paths come from the server (`order.path`, `ack.path`) or
 * are one arc `origin -> target`: nothing here finds a route (AGENTS.md 7.1).
 */
import type { Point } from './camera.ts';
import type { GhostStatus } from './interaction.ts';
import { barracksAt, ringRadius, vpBadgeAt } from './cityLayout.ts';
import { clipToConvex } from './regionLayout.ts';
import {
  GHOST_REJECT_MS,
  GHOST_SHAKE_AMPLITUDE,
  GHOST_SHAKE_MS,
  RIBBON,
  RING_SEGMENT,
} from './style.ts';

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
 * The axis of a ribbon through `nodes`: every leg is a quadratic curve bent to the side of the
 * normal `(-dy, dx)` of the travel direction by `bend` of its chord (a negative `bend` bends to
 * the left of the way on the screen, y down). The first leg starts `startGap` from its first point
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
 * How much one smooth curve from `from` to `to` must bend (share of the chord, positive: to the
 * side of the normal `(-dy, dx)`, as `ribbonAxis` bends) to roughly follow the waypoints `via` of the
 * server's path: the one farthest from the chord decides. Clamped to `limit`; 0 without waypoints.
 * The arrow is one curve, it never kinks at a waypoint.
 */
export function pathBend(from: Point, to: Point, via: readonly Point[], limit: number): number {
  const chord = dist(from, to);
  if (chord === 0) return 0;
  const nx = -(to.y - from.y) / chord;
  const ny = (to.x - from.x) / chord;
  let far = 0;
  for (const p of via) {
    const side = (p.x - from.x) * nx + (p.y - from.y) * ny;
    if (Math.abs(side) > Math.abs(far)) far = side;
  }
  // The middle of a quadratic curve sits half way between the chord and its control point.
  return Math.max(-limit, Math.min(limit, (2 * far) / chord));
}

/**
 * The part of a ribbon over `axis` (a gently curved line) that `fraction` (0..1) of the delay has
 * filled: its outline cut across the axis at that share of the axis length (the delay fills the
 * whole arrow from the start to the tip). Empty for 0.
 */
export function ribbonFilled(
  outline: readonly Point[],
  axis: readonly Point[],
  fraction: number,
): Point[] {
  if (fraction <= 0 || axis.length < 2) return [];
  if (fraction >= 1) return [...outline];
  const upTo = polylinePrefix(axis, fraction);
  const front = upTo[upTo.length - 1];
  const before = upTo[upTo.length - 2];
  if (front === undefined || before === undefined) return [];
  const len = dist(before, front);
  if (len === 0) return [];
  const ux = (front.x - before.x) / len;
  const uy = (front.y - before.y) / len;
  // A box behind the front, across the axis and wider than any ribbon: the front is its far side.
  const wide = 400;
  const deep = 4000;
  const box = [
    { x: front.x - ux * deep - uy * wide, y: front.y - uy * deep + ux * wide },
    { x: front.x - uy * wide, y: front.y + ux * wide },
    { x: front.x + uy * wide, y: front.y - ux * wide },
    { x: front.x - ux * deep + uy * wide, y: front.y - uy * deep - ux * wide },
  ];
  return clipToConvex(outline, box);
}

/**
 * The bend of the ribbon of an order: always toward the top of the screen, so the arc never runs
 * over the caption that hangs under its start or its target (ODb, #519). `dx` is the horizontal
 * run of the order. The bend that follows the server's path (`pathBend`) is taken when it is
 * pronounced (at least `min` of the chord) and already bulges up; otherwise the fixed arc, with
 * the sign that bulges up for this direction (`arc` is negative: up for an arrow going right).
 * For a vertical order the sign of `arc` stays.
 */
export function orderBend(dx: number, followed: number, min: number, arc: number): number {
  const side = Math.sign(dx);
  // `ribbonAxis` pushes the middle by `(-uy, ux) * bend`: the y of that push is `ux * bend`, up when negative.
  if (Math.abs(followed) >= min && (side === 0 || followed * side < 0)) return followed;
  return side === 0 ? arc : -side * Math.abs(arc);
}

/**
 * How far from the centre of the start city its ribbon begins: `RIBBON.startGap` outside the
 * circle, pushed on in steps of 3 (up to `RIBBON.startMax`) until the tail is `RIBBON.slotClear`
 * from the barracks mark of the city (the B1 column on its left) and `RIBBON.badgeClear` from its
 * VP badge (upper right), so it never starts over a badge. The tail starts on the chord, so a
 * plain walk along the chord finds it.
 */
export function tailStart(origin: Point, target: Point, radius: number): number {
  const full = dist(origin, target);
  if (full === 0) return radius + RIBBON.startGap;
  const ux = (target.x - origin.x) / full;
  const uy = (target.y - origin.y) / full;
  const marks = [
    { at: barracksAt(radius), clear: RIBBON.slotClear },
    { at: vpBadgeAt(radius), clear: RIBBON.badgeClear },
  ];
  let gap = radius + RIBBON.startGap;
  for (; gap < radius + RIBBON.startMax; gap += 3) {
    if (marks.every((m) => Math.hypot(ux * gap - m.at.x, uy * gap - m.at.y) >= m.clear)) break;
  }
  return gap;
}

/** The outer rim of a city sign: the outer edge of its capacity ring, from the centre. */
export function signRim(radius: number): number {
  return ringRadius(radius) + RING_SEGMENT.base / 2;
}

/** A point of a polyline at the distance `s` from its start, with the unit direction there. */
export function axisPoint(axis: readonly Point[], s: number): { at: Point; dir: Point } | null {
  const first = axis[0];
  if (first === undefined || axis.length < 2) return null;
  let walked = 0;
  for (let i = 1; i < axis.length; i++) {
    const a = axis[i - 1];
    const b = axis[i];
    if (a === undefined || b === undefined) continue;
    const len = dist(a, b);
    if (len === 0) continue;
    if (walked + len >= s || i === axis.length - 1) {
      const t = Math.min(1, Math.max(0, (s - walked) / len));
      return {
        at: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
        dir: { x: (b.x - a.x) / len, y: (b.y - a.y) / len },
      };
    }
    walked += len;
  }
  return null;
}

/**
 * Half of the width of the ribbon at the distance `s` along its axis of length `total`, as
 * `ribbonOutline` draws it: the body widens from the tail to the full width, the head tapers from
 * the base to the tip.
 */
export function ribbonHalfWidth(total: number, s: number, body: number): number {
  const scale = body / RIBBON.body;
  const headL = Math.min(RIBBON.headLength * scale, total * 0.7);
  const headW = RIBBON.headWidth * scale * (headL / (RIBBON.headLength * scale));
  if (s >= total - headL) return (headW * Math.max(0, total - s)) / headL / 2;
  const t = total - headL <= 0 ? 1 : s / (total - headL);
  return (body / 2) * (RIBBON.tailRatio + (1 - RIBBON.tailRatio) * t);
}

/**
 * The paper line across the ribbon at the front of the fill: from one edge to the other at the
 * share `fraction` of the axis, `RIBBON.front.inset` short of both. `null` at the ends.
 */
export function frontLine(
  axis: readonly Point[],
  fraction: number,
  body: number,
): [Point, Point] | null {
  if (fraction <= 0 || fraction >= 1) return null;
  const total = polylineLength(axis);
  const s = total * fraction;
  const p = axisPoint(axis, s);
  if (p === null) return null;
  const half = Math.max(0, ribbonHalfWidth(total, s, body) - RIBBON.front.inset);
  return [
    { x: p.at.x - p.dir.y * half, y: p.at.y + p.dir.x * half },
    { x: p.at.x + p.dir.y * half, y: p.at.y - p.dir.x * half },
  ];
}

/**
 * The band of light that runs along the ribbon after the departure: the stretch of the axis
 * `RIBBON.sheen.length` long whose head is at `phase` (0..1, repeated every pass) of the way from
 * before the tail to the tip, as shares of the axis length (clipped to 0..1). `null` when it is
 * off the ribbon.
 */
export function sheenSpan(total: number, phase: number): { from: number; to: number } | null {
  if (total <= 0) return null;
  const start = phase * (total + 30) - 30;
  const from = Math.max(0, start);
  const to = Math.min(total, start + RIBBON.sheen.length);
  return to > from ? { from: from / total, to: to / total } : null;
}

/** The phase (0..1) of the running band at `seconds`: one pass every `RIBBON.sheen.periodS`. */
export function sheenPhase(seconds: number): number {
  const period = RIBBON.sheen.periodS;
  return (((seconds % period) + period) % period) / period;
}

/**
 * The part of a ribbon between the shares `from` and `to` (0..1) of its axis: its outline cut
 * across the axis at both shares. Empty if the band is empty.
 */
export function ribbonSlice(
  outline: readonly Point[],
  axis: readonly Point[],
  from: number,
  to: number,
): Point[] {
  if (to <= from || axis.length < 2) return [];
  const total = polylineLength(axis);
  const a = axisPoint(axis, total * from);
  const b = axisPoint(axis, total * to);
  if (a === null || b === null) return [];
  // A quad across the axis from the front `a` to the front `b`, wider than any ribbon.
  const wide = 400;
  const quad = [
    { x: a.at.x - a.dir.y * wide, y: a.at.y + a.dir.x * wide },
    { x: b.at.x - b.dir.y * wide, y: b.at.y + b.dir.x * wide },
    { x: b.at.x + b.dir.y * wide, y: b.at.y - b.dir.x * wide },
    { x: a.at.x + a.dir.y * wide, y: a.at.y - a.dir.x * wide },
  ];
  return clipToConvex(outline, quad);
}

/**
 * Where the pill "◇ +N" sits: `RIBBON.bonusBack` before the end of the arc (not before
 * `RIBBON.bonusMin` from its start), moved off the arc to its outer side (the side it bulges to,
 * `sign(bend)` as `ribbonAxis` uses it) by half the body, `RIBBON.bonusMargin` and `halfPill`
 * (the half height of the pill, world units).
 */
export function bonusSpot(
  axis: readonly Point[],
  bend: number,
  body: number,
  halfPill: number,
): Point | null {
  const total = polylineLength(axis);
  const p = axisPoint(axis, Math.max(RIBBON.bonusMin, total - RIBBON.bonusBack));
  if (p === null) return null;
  // The normal `(-dir.y, dir.x)` is the side `bend > 0` pushes the middle to.
  const out = (bend < 0 ? -1 : 1) * (body / 2 + RIBBON.bonusMargin + halfPill);
  return { x: p.at.x - p.dir.y * out, y: p.at.y + p.dir.x * out };
}

/**
 * The dashed ring round the target of the opponent's order, as dashes of points: the circle of
 * `radius` open at the bottom (`RIBBON.ring.open` each side of straight down), dashed 5 / 4.
 */
export function ringDashes(centre: Point, radius: number): Point[][] {
  const { open, dash, space } = RIBBON.ring;
  const from = Math.PI / 2 + open;
  const span = 2 * Math.PI - 2 * open;
  const steps = Math.max(12, Math.ceil((span * radius) / 6));
  const arc: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = from + (span * i) / steps;
    arc.push({ x: centre.x + radius * Math.cos(a), y: centre.y + radius * Math.sin(a) });
  }
  return dashAlong(arc, dash, space, 0);
}

/** The opacity of the ring over an own city: it swells and fades every `RIBBON.ring.pulseS`; 1 with "less motion". */
export function ringOpacity(seconds: number, reduced: boolean): number {
  if (reduced) return 1;
  const { pulseS, pulseLow } = RIBBON.ring;
  const phase = (((seconds % pulseS) + pulseS) % pulseS) / pulseS;
  return pulseLow + (1 - pulseLow) * (0.5 - 0.5 * Math.cos(2 * Math.PI * phase));
}

/** The pulse of a ribbon whose delay has just run out. */
export interface DepartPulse {
  /** 0..1..0 over the pulse: a smooth swell, 0 before it and after it. */
  readonly swell: number;
  /** 0 before the pulse, up to 1 at its end and 1 from then on: how locked the order is. */
  readonly lock: number;
}

/**
 * One smooth pulse when the delay of a ribbon ends, instead of a blink: `swell` rises and falls
 * once over `ticks`, `lock` climbs to 1 meanwhile and stays (the contour stays stronger).
 * `since`: ticks after the end of the delay (negative before it). With `reduced` motion no swell,
 * only the locked state.
 */
export function departPulse(since: number, ticks: number, reduced: boolean): DepartPulse {
  if (since < 0) return { swell: 0, lock: 0 };
  const phase = ticks <= 0 ? 1 : Math.min(1, since / ticks);
  const lock = phase * phase * (3 - 2 * phase);
  if (reduced || phase >= 1) return { swell: 0, lock: reduced ? 1 : lock };
  return { swell: Math.sin(Math.PI * phase) ** 2, lock };
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

/**
 * The outline of a rounded rectangle centred on the origin as a closed polyline (corners cut into
 * `steps` pieces): for a contour that is dashed with `dashAlong`.
 */
export function roundRectPoints(width: number, height: number, radius: number, steps = 4): Point[] {
  const r = Math.min(radius, width / 2, height / 2);
  const hw = width / 2;
  const hh = height / 2;
  const points: Point[] = [];
  // Clockwise from the top left corner: the centres of the four corner arcs and where each starts.
  const corners = [
    { cx: -hw + r, cy: -hh + r, from: Math.PI },
    { cx: hw - r, cy: -hh + r, from: -Math.PI / 2 },
    { cx: hw - r, cy: hh - r, from: 0 },
    { cx: -hw + r, cy: hh - r, from: Math.PI / 2 },
  ];
  for (const { cx, cy, from } of corners) {
    for (let i = 0; i <= steps; i++) {
      const angle = from + ((Math.PI / 2) * i) / steps;
      points.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
    }
  }
  return points;
}
