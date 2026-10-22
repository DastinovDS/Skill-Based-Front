/**
 * Timing and geometry of the fight, bounce and capture effects (ui-style 9.9, U8).
 *
 * Pure functions, no PixiJS and no DOM. Nothing here decides what happened: the effects come from
 * the `fight`, `fight_group` and `node_captured` events the server sent.
 */
import type { EventMsg, MapFile, PlayerId } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import { arrowGeometry, nodePoint } from './layout.ts';
import { NUMBERS_RISE } from './style.ts';

/** Progress 0..1 of an effect of `ms` milliseconds `age` ticks after its event; `null`: not now. */
export function effectProgress(age: number, ms: number, tickHz: number): number | null {
  if (age < 0 || tickHz <= 0) return null;
  const t = (age * 1000) / (tickHz * ms);
  return t >= 1 ? null : t;
}

/** The loss numbers: still, then fading in the last third; they rise unless motion is reduced. */
export function numbersLook(t: number, reduced: boolean): { alpha: number; rise: number } {
  const fade = 0.7;
  return {
    alpha: t <= fade ? 1 : Math.max(0, 1 - (t - fade) / (1 - fade)),
    rise: reduced ? 0 : NUMBERS_RISE * t,
  };
}

/** The capture wave grows quickly and slows down (ease out), and fades out. */
export function waveLook(t: number): { scale: number; alpha: number } {
  return { scale: t * (2 - t), alpha: 1 - t };
}

/** How long the flag over a captured city stays (ui-style 29.1: the wave, then the flag). */
export const FLAG_MS = 1600;

/** The flag of a capture stays whole, then fades over its last 1.0 s of 1.6 s. */
export function flagLook(t: number): { alpha: number } {
  const hold = 0.375;
  return { alpha: t <= hold ? 1 : Math.max(0, 1 - (t - hold) / (1 - hold)) };
}

/** Corners of a star with `points` tips, alternating `outer` and `inner` radius, as x, y, x, y... */
export function starPolygon(outer: number, inner: number, points: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (i * Math.PI) / points - Math.PI / 2;
    out.push(radius * Math.cos(angle), radius * Math.sin(angle));
  }
  return out;
}

/** The polygon `cell` scaled by `scale` about `centre`, as x, y, x, y... */
export function scaledPolygon(cell: readonly Point[], centre: Point, scale: number): number[] {
  return cell.flatMap((p) => [
    centre.x + (p.x - centre.x) * scale,
    centre.y + (p.y - centre.y) * scale,
  ]);
}

export interface CaptureInfo {
  node: number;
  player: PlayerId;
  tick: number;
  at: Point;
}

/** A `node_captured` event as an effect, or `null` if it is not one or names an unknown city. */
export function captureInfo(event: EventMsg, map: MapFile): CaptureInfo | null {
  if (event.kind !== 'node_captured') return null;
  const { node, player } = event.data;
  if (typeof node !== 'number' || (player !== 0 && player !== 1)) return null;
  const at = nodePoint(map, node);
  return at === undefined ? null : { node, player, tick: event.tick, at };
}

export interface BounceInfo {
  group: string;
  tick: number;
}

/** A `fight_group` event of an own group that bounced (the server sends it to the owner only). */
export function bounceInfo(event: EventMsg): BounceInfo | null {
  if (event.kind !== 'fight_group' || event.data.bounce !== true) return null;
  const { group } = event.data;
  return typeof group === 'string' ? { group, tick: event.tick } : null;
}

/** The short arrow of a bounce: from where the group is back towards the node it came from. */
export function bounceArrow(
  at: Point,
  home: Point,
  length: number,
  head: number,
): { from: Point; to: Point; head: readonly [Point, Point, Point]; end: Point } | null {
  const distance = Math.hypot(home.x - at.x, home.y - at.y);
  if (distance === 0) return null;
  const to = {
    x: at.x + ((home.x - at.x) / distance) * length,
    y: at.y + ((home.y - at.y) / distance) * length,
  };
  const arrow = arrowGeometry(at, to, 0, 0, head, head);
  return arrow === null ? null : { from: at, to, head: arrow.head, end: arrow.end };
}
