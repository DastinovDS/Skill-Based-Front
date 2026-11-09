/**
 * Timing and geometry of the fight, bounce and capture effects (ui-style 9.9, U8).
 *
 * Pure functions, no PixiJS and no DOM. Nothing here decides what happened: the effects come from
 * the `fight`, `fight_group` and `node_captured` events the server sent.
 */
import type { EventMsg, MapFile, PlayerId } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import { nodePoint } from './layout.ts';
import { BOUNCE_HOME, NUMBERS_RISE } from './style.ts';

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

/** How long the flag over a captured city stays (ui-style 29.1; the light of a capture comes first, #819). */
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

/** One chevron of a bounce going home: its centre, the way home there, its opacity. */
export interface HomeChevron {
  readonly at: Point;
  readonly dir: Point;
  readonly alpha: number;
}

/**
 * Bounce, Chevrons home (#851, ui-style 54m; mockup `bounceHome` M3): three amber chevrons running
 * ahead of a bounced group to the node it came from. `at`: the group's token now, `home`: where the
 * way ends (the home ring), `width`: the helmet's width, `seconds` the render clock (0 with less
 * motion: they stand), `ageMs` since the bounce (they fade in). None past the end of the way.
 */
export function homeChevrons(
  at: Point,
  home: Point,
  width: number,
  seconds: number,
  ageMs: number,
  scale = 1,
): HomeChevron[] {
  const B = BOUNCE_HOME;
  const length = Math.hypot(home.x - at.x, home.y - at.y);
  if (length === 0) return [];
  const dir = { x: (home.x - at.x) / length, y: (home.y - at.y) / length };
  const gap = B.gap * scale;
  const phase = (((seconds * B.speed * scale) % gap) + gap) % gap;
  const fadeIn = Math.max(0, Math.min(1, (ageMs + 200) / B.inMs));
  const out: HomeChevron[] = [];
  for (let j = 0; j < B.count; j++) {
    const d = width * 0.6 + B.lead * scale + j * gap + phase;
    if (d > length - B.endGap * scale) continue;
    out.push({
      at: { x: at.x + dir.x * d, y: at.y + dir.y * d },
      dir,
      alpha: fadeIn * (1 - j * B.dim),
    });
  }
  return out;
}

/** The outline of a home chevron (a barbed point along `dir`), flat, `scale` times its size. */
export function homeChevronShape(c: HomeChevron, scale = 1): number[] {
  const B = BOUNCE_HOME;
  const { at, dir } = c;
  const nx = -dir.y;
  const ny = dir.x;
  const p = (u: number, v: number): [number, number] => [
    at.x + (dir.x * u + nx * v) * scale,
    at.y + (dir.y * u + ny * v) * scale,
  ];
  return [...p(B.tip, 0), ...p(-B.back, -B.side), ...p(-B.notch, 0), ...p(-B.back, B.side)];
}
