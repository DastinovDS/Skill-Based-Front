/**
 * The shots of a round on the map, shot style 1 "Tracers" at strength "Stronger" (ui-style 29.1, 29.4; #352):
 * a curved comet that leaves the group that shot, tapers into a tail and lands on the other group; two
 * shots that meet bend round each other (a lens of two arcs) and meet in the middle; a bonus shot is
 * a hollow tail with three diamonds trailing it; the path stays a moment after the hit and fades.
 *
 * Pure functions, no PixiJS and no DOM. Nothing decides what happened: the shots are what
 * `impactsOf` made of the fields of `fight_round` (shots, virtual shots, losses), the places are the
 * tokens of the groups (`Contacts`), and every time is a share of a round (`combat.round_ticks`).
 * With 20 ticks at 10 Hz the flight of a hit is 0.6 s, of two shots that meet 0.3 s, the path fades
 * for 0.5 s after it (ui-style 29.1).
 *
 * The risk written beside the owner's choice (29.4, item 1): at the distance of 46 between the groups
 * the way from one to the other is short and its bend almost invisible. The groups are not moved
 * apart; the **trail is lengthened** instead: a path shorter than `MIN_REACH` starts behind the
 * shooter (the tail leaves from under its token) and the bend never sags less than `MIN_BEND`. Both
 * follow the strength of the effects.
 */
import type { Point } from './camera.ts';
import { HIT_SHARE, type Contacts, type Impact, type Side } from './fightImpact.ts';
import { rnd } from './particles.ts';
import { FIGHT_FX_STRENGTH } from './style.ts';

// --- Look constants (world units at 100%, shares of a round) -----------------------------------------

/** How far from the middle of a group its shot leaves and lands: about the edge of the token. */
export const TOKEN_REACH = 14;
/** A path shorter than this is lengthened behind the shooter (risk 1, before the strength factor). */
export const MIN_REACH = 46;
/** The sag of the arc over the chord, and the least it may be (so that a short path still bends). */
export const BEND = 0.3;
export const MIN_BEND = 7;
/** The tail covers this much of the path behind the head (before the strength factor). */
export const TAIL_SHARE = 0.55;
/** Width of the tail at the head (before the strength factor). */
export const TAIL_WIDTH = 13;
/** The tail is cut into this many segments, one polygon. */
export const TAIL_SEGMENTS = 8;
/** The path fades this share of a round after the hit (0.5 s of 2 s). */
export const AFTERGLOW_SHARE = 0.25;
/** The sparks of a tracer at "Stronger": how many, and how long one lives (a share of a round, 0.32 s of 2 s). */
export const SPARKS = 5;
export const SPARK_LIFE_SHARE = 0.16;
/** The diamonds that trail a bonus shot: how far behind the head (the share of the path), sizes and alphas. */
export const ECHOES = [
  { back: 0.1, size: 6.5, alpha: 0.5 },
  { back: 0.2, size: 5.5, alpha: 0.35 },
  { back: 0.3, size: 4.5, alpha: 0.2 },
] as const;

/** The strength factor of the length and the width of a tail: 0.7 at no strength, 1.18 at "Stronger". */
export function tailFactor(strength: number = FIGHT_FX_STRENGTH): number {
  return 0.7 + 0.3 * strength;
}

/** Sparks a shot leaves: `SPARKS` at "Stronger", three at "medium" (strength 1). */
export function sparkCount(strength: number = FIGHT_FX_STRENGTH): number {
  return Math.max(1, Math.round((SPARKS * strength) / FIGHT_FX_STRENGTH));
}

/** How bright the glow of a head and the tail are: full at "Stronger", a little less at "medium". */
export function brightness(strength: number = FIGHT_FX_STRENGTH): number {
  return Math.min(1, 0.6 + 0.25 * strength);
}

// --- Geometry -----------------------------------------------------------------------------------------

/** One shot of a round: where its path runs. */
export interface Shot {
  readonly shooter: Side;
  /** All its shots were virtual (ui-style 21): a hollow tail with a diamond. */
  readonly bonus: boolean;
  /** It meets the shot of the other side half way: nobody is hit. */
  readonly cancel: boolean;
  /** Where the head leaves from (at the token of the shooter), and where it lands. */
  readonly a: Point;
  readonly b: Point;
  /** The start of the path: behind `a` when the way is short, else `a`. */
  readonly p0: Point;
  /** The control point of the quadratic arc from `p0` to `b`. */
  readonly ctrl: Point;
  /** The unit vector from the shooter to the target, and the one to the left of it. */
  readonly dir: Point;
  readonly normal: Point;
  /** Length of the path from `p0` to `b`. */
  readonly length: number;
  /** The parameter of the arc where the head starts (0 when the way is not lengthened). */
  readonly start: number;
  /** When it lands, a share of a round after the tick. */
  readonly at: number;
}

const sub = (p: Point, q: Point): Point => ({ x: p.x - q.x, y: p.y - q.y });
const along = (p: Point, d: Point, k: number): Point => ({ x: p.x + d.x * k, y: p.y + d.y * k });
const len = (p: Point): number => Math.hypot(p.x, p.y);

/** The point of the quadratic arc `p0, ctrl, b` at parameter `s` (0..1). */
export function arcAt(shot: Pick<Shot, 'p0' | 'ctrl' | 'b'>, s: number): Point {
  const w = 1 - s;
  return {
    x: w * w * shot.p0.x + 2 * w * s * shot.ctrl.x + s * s * shot.b.x,
    y: w * w * shot.p0.y + 2 * w * s * shot.ctrl.y + s * s * shot.b.y,
  };
}

/** The unit tangent of the arc at `s`. */
export function arcTangent(shot: Pick<Shot, 'p0' | 'ctrl' | 'b'>, s: number): Point {
  const dx = 2 * (1 - s) * (shot.ctrl.x - shot.p0.x) + 2 * s * (shot.b.x - shot.ctrl.x);
  const dy = 2 * (1 - s) * (shot.ctrl.y - shot.p0.y) + 2 * s * (shot.b.y - shot.ctrl.y);
  const l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
}

/**
 * The shots of an impact: one from the shooter to the victim (a kill or a charge put out), or two for
 * shots that cancel, each ending in the middle between the groups. A shot leaves and lands
 * `TOKEN_REACH` from the middle of a group (less if the groups stand closer than that). A path shorter
 * than `MIN_REACH` times the strength factor (and `scale`, more when the map is zoomed out, so that the
 * trail keeps its size on the screen) is lengthened behind the shooter; the arc bends to the
 * left of the way, so that the two shots of a cancel bend to the opposite sides of the road and make a lens.
 */
export function shotsOf(
  impact: Impact,
  contacts: Contacts,
  strength: number = FIGHT_FX_STRENGTH,
  scale = 1,
): Shot[] {
  const cancel = impact.kind === 'cancel';
  const shooters: readonly Side[] = cancel
    ? ['own', 'enemy']
    : impact.shooter === null
      ? []
      : [impact.shooter];
  const kk = tailFactor(strength);
  const shots: Shot[] = [];
  for (const shooter of shooters) {
    const target: Side = shooter === 'own' ? 'enemy' : 'own';
    const from = contacts[shooter];
    const to = contacts[target];
    const gap = len(sub(to, from)) || 1;
    const dir = { x: (to.x - from.x) / gap, y: (to.y - from.y) / gap };
    const reach = Math.min(TOKEN_REACH, 0.3 * gap);
    const a = along(from, dir, reach);
    const b = cancel
      ? { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
      : along(to, dir, -(reach + 1));
    const chord = len(sub(b, a));
    // The least way and the least bend keep their size on the screen when the map is zoomed out (`scale`).
    const extra = Math.max(0, MIN_REACH * kk * scale - chord);
    const p0 = along(a, dir, -extra);
    const length = chord + extra;
    const normal = { x: -dir.y, y: dir.x };
    const sag = Math.max(BEND * length, MIN_BEND * scale);
    const mid = { x: (p0.x + b.x) / 2, y: (p0.y + b.y) / 2 };
    // The apex of a quadratic arc is half way between the chord and the control point.
    const ctrl = along(mid, normal, 2 * sag);
    shots.push({
      shooter,
      bonus: impact.bonusBy[shooter],
      cancel,
      a,
      b,
      p0,
      ctrl,
      dir,
      normal,
      length,
      start: length > 0 ? extra / length : 0,
      at: impact.at,
    });
  }
  return shots;
}

// --- Time ---------------------------------------------------------------------------------------------

/** Where a shot is: flying (the head at `s` on the arc) or fading (progress `fade` 0..1 of the afterglow). */
export type ShotPhase =
  | { readonly kind: 'flight'; readonly flown: number; readonly s: number }
  | { readonly kind: 'fade'; readonly fade: number }
  | null;

/**
 * The phase of a shot `age` ticks after the tick of its round: the head flies linearly from `start` to
 * the end of the arc over `shot.at` of a round, then the path fades over `AFTERGLOW_SHARE`. Before the
 * tick (the wind-up of #351) and after the afterglow: `null`.
 */
export function shotPhase(age: number, shot: Shot, roundTicks: number): ShotPhase {
  const round = Math.max(1, roundTicks);
  if (age < 0) return null;
  const share = age / round;
  if (share < shot.at) {
    const flown = share / shot.at;
    return { kind: 'flight', flown, s: shot.start + (1 - shot.start) * flown };
  }
  const fade = (share - shot.at) / AFTERGLOW_SHARE;
  return fade < 1 ? { kind: 'fade', fade } : null;
}

/** The tick (age) by which every tracer of a round is gone: the hit of the slowest and the afterglow. */
export const TRACER_END_SHARE = HIT_SHARE + AFTERGLOW_SHARE;

// --- The tail ------------------------------------------------------------------------------------------

/** The outline of a tail: the points of its axis from the tail end to the head, and its two edges. */
export interface Tail {
  readonly axis: readonly Point[];
  readonly left: readonly Point[];
  readonly right: readonly Point[];
}

/**
 * The tail of a shot whose head is at `s`: `TAIL_SEGMENTS` segments along the arc from `s - TAIL_SHARE`
 * (times the strength factor, not before the start of the path) to `s`, as wide as `TAIL_WIDTH` times the
 * factor and `scale` at the head and nothing at the tail end. One polygon: `left` then `right` reversed.
 * `pad` widens it (world units at 100%, scaled the same way): the underlay of the tail.
 */
export function tailOutline(
  shot: Pick<Shot, 'p0' | 'ctrl' | 'b'>,
  s: number,
  scale: number,
  strength: number = FIGHT_FX_STRENGTH,
  pad = 0,
): Tail {
  const kk = tailFactor(strength);
  const from = Math.max(0, s - TAIL_SHARE * kk);
  const axis: Point[] = [];
  const left: Point[] = [];
  const right: Point[] = [];
  for (let j = 0; j <= TAIL_SEGMENTS; j++) {
    const at = from + ((s - from) * j) / TAIL_SEGMENTS;
    const p = arcAt(shot, at);
    const t = arcTangent(shot, at);
    const half = ((TAIL_WIDTH * kk + pad) * scale * (j / TAIL_SEGMENTS)) / 2;
    axis.push(p);
    left.push({ x: p.x - t.y * half, y: p.y + t.x * half });
    right.push({ x: p.x + t.y * half, y: p.y - t.x * half });
  }
  return { axis, left, right };
}

/** The whole path of a shot as a polyline (the afterglow). */
export function pathPoints(shot: Pick<Shot, 'p0' | 'ctrl' | 'b'>, steps = 14): Point[] {
  return Array.from({ length: steps + 1 }, (_, i) => arcAt(shot, i / steps));
}

// --- The sparks and the echoes --------------------------------------------------------------------------

/** A spark of a tracer: where it is and how far through its life (0..1). */
export interface Spark {
  readonly at: Point;
  readonly life: number;
}

/**
 * The sparks the head leaves behind: `sparkCount` are born at even places of the flown way and drift to
 * one side or the other while they live for `SPARK_LIFE_SHARE` of a round. A function of the flight
 * progress and the seed, nothing is stored.
 */
export function sparksOf(
  shot: Shot,
  flown: number,
  seed: number,
  strength: number = FIGHT_FX_STRENGTH,
): Spark[] {
  const out: Spark[] = [];
  const count = sparkCount(strength);
  for (let j = 0; j < count; j++) {
    const born = (j + 1) / (count + 1);
    const ageShare = (flown - born) * shot.at;
    if (ageShare < 0 || ageShare >= SPARK_LIFE_SHARE) continue;
    const life = ageShare / SPARK_LIFE_SHARE;
    const s = shot.start + (1 - shot.start) * born;
    const p = arcAt(shot, s);
    const drift = (rnd(j, seed) - 0.5) * 9 * life;
    out.push({ at: along(p, shot.normal, drift), life });
  }
  return out;
}

/** The places of the diamonds that trail a bonus shot whose head is at `s`. */
export function echoesOf(
  shot: Pick<Shot, 'p0' | 'ctrl' | 'b'>,
  s: number,
): { at: Point; size: number; alpha: number }[] {
  return ECHOES.map((echo) => ({
    at: arcAt(shot, Math.max(0, s - echo.back)),
    size: echo.size,
    alpha: echo.alpha,
  }));
}

/** Soft glow spots along a tail (`ShotView`). */
export const GLOW_SPOT_COUNT = 3;

/** Particles a tracer has at most in flight: the head and its glow, the glow along the tail, the sparks, the echoes. */
export function tracerBudget(
  shot: Pick<Shot, 'bonus'>,
  strength: number = FIGHT_FX_STRENGTH,
): number {
  return 2 + GLOW_SPOT_COUNT + sparkCount(strength) + (shot.bonus ? ECHOES.length : 0);
}
