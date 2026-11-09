/**
 * The «Supply» view "Canal" (#858; #829 rounds 3 to 5, ui-style 54f, the owner's pick): every
 * downhill road of the own supply flow (`flow_down`) is a channel of one width from ring to ring. Two
 * ink rails, the own hachures across it, drifting downhill while an own packet is on the road (faint
 * and still when it is idle), and a cut V at the receiving ring. The amount is the packets themselves.
 *
 * Pure functions, no PixiJS: where the canal lies, its hachures for a phase, its head. Which roads are
 * downhill and which carry a packet is the server's (`flowLayout.ts`); nothing here computes supply.
 */
import type { Point } from './camera.ts';
import { ringRadius } from './cityLayout.ts';

/** The look, in world units at 100 % (mockup `streamRoad` S1). */
export const CANAL = {
  /** Half the width of the channel between its rails, and the casing round it (each side). */
  half: 2.8,
  casing: 1.6,
  /** The rails: ivory hairlines. */
  rail: 0.8,
  /** The hachures: one every `pitch`, this wide, set back `lag` against the way of the flow. */
  pitch: 3.4,
  hachure: 1.1,
  lag: 1.2,
  /** An idle road shows its hachures this faint, and still. */
  idleAlpha: 0.38,
  /** The hachures of a road with a packet on it run downhill this fast (units a second). */
  speed: 11,
  /** A running canal is redrawn when its phase moves by this much (units): a few times a second, not every frame. */
  step: 0.5,
  /** The canal starts and ends this far outside the capacity ring of the city. */
  inset: 1,
  /** The head at the receiving ring: a V this long, this much wider than the channel each side. */
  head: { back: 5, spread: 2, casing: 3.4, ink: 1.2 },
  /** A level node: a ring of the own colour on a casing, `gap` outside the capacity ring, and an ink ring outside it. */
  level: { gap: 5, width: 1.8, casing: 4, ink: 0.8, inkGap: 7.6 },
  /** A packet: a square of the own colour on a dark casing with an ink outline, turned along its road. */
  packet: { casing: 4.6, fill: 3, outline: 4, ink: 0.8 },
} as const;

/** Where the canal of a road lies: from the rim of `from` to the rim of `to`, and its unit vectors. */
export interface CanalSpan {
  readonly a: Point;
  readonly b: Point;
  readonly length: number;
  /** Along the flow, and across it (to the left). */
  readonly u: Point;
  readonly n: Point;
}

export function canalSpan(from: Point, to: Point, rFrom: number, rTo: number): CanalSpan | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const d = Math.hypot(dx, dy);
  const ra = ringRadius(rFrom) + CANAL.inset;
  const rb = ringRadius(rTo) + CANAL.inset;
  if (d <= ra + rb + 1) return null;
  const u = { x: dx / d, y: dy / d };
  return {
    a: { x: from.x + u.x * ra, y: from.y + u.y * ra },
    b: { x: to.x - u.x * rb, y: to.y - u.y * rb },
    length: d - ra - rb,
    u,
    n: { x: -u.y, y: u.x },
  };
}

/** The phase of the running hachures at `seconds`: in steps of `CANAL.step`, 0 when still. */
export function canalPhase(seconds: number, still: boolean): number {
  if (still || !(seconds > 0)) return 0;
  return Math.floor((seconds * CANAL.speed) / CANAL.step) * CANAL.step;
}

/** The hachures of a canal at `phase` (units run downhill): each a pair of points across the channel. */
export function canalHachures(span: CanalSpan, phase: number): [Point, Point][] {
  const { a, u, n, length } = span;
  const out: [Point, Point][] = [];
  const h = CANAL.half;
  const first = (((phase % CANAL.pitch) + CANAL.pitch) % CANAL.pitch) + 1;
  for (let d = first; d < length - 1; d += CANAL.pitch) {
    const x = a.x + u.x * (d - CANAL.lag);
    const y = a.y + u.y * (d - CANAL.lag);
    out.push([
      { x: x + n.x * h, y: y + n.y * h },
      { x: x - n.x * h, y: y - n.y * h },
    ]);
  }
  return out;
}

/** The two rails of a canal: its edges, from rim to rim. */
export function canalRails(span: CanalSpan): [Point, Point][] {
  const { a, b, n } = span;
  const h = CANAL.half;
  return [h, -h].map((k): [Point, Point] => [
    { x: a.x + n.x * k, y: a.y + n.y * k },
    { x: b.x + n.x * k, y: b.y + n.y * k },
  ]);
}

/** The head at the receiving ring: a V pointing downhill, its tip just short of the end. */
export function canalHead(span: CanalSpan): Point[] {
  const { b, u, n } = span;
  const { back, spread } = CANAL.head;
  const tip = { x: b.x - u.x, y: b.y - u.y };
  const w = CANAL.half + spread;
  return [
    { x: tip.x - u.x * back + n.x * w, y: tip.y - u.y * back + n.y * w },
    tip,
    { x: tip.x - u.x * back - n.x * w, y: tip.y - u.y * back - n.y * w },
  ];
}

/** The corners of a square of half side `half` centred on `at`, turned to the unit vector `dir`. */
export function turnedSquare(at: Point, dir: Point, half: number): number[] {
  const ux = dir.x * half;
  const uy = dir.y * half;
  return [
    at.x - ux + uy,
    at.y - uy - ux,
    at.x + ux + uy,
    at.y + uy - ux,
    at.x + ux - uy,
    at.y + uy + ux,
    at.x - ux - uy,
    at.y - uy + ux,
  ];
}
