/**
 * The capture of a node, "Fitted" (#819, ui-style 49): the timeline and the geometry of the flood of
 * the new owner's colour over the area of the node. Pure functions, no PixiJS: `FloodView` and
 * `MapView` draw what these say. Nothing here decides a capture: a flood starts on the snapshot that
 * already shows the new owner (AGENTS.md 7.1, 7.3); this only says how far the colour has come.
 *
 * The field of an area is its own outline scaled from the city: a point at `fit` 0.5 lies half way
 * from the city to the border along its ray, `fit` 1 on the border. The border of an area that is not
 * star-shaped round its city (an inlet, a river mouth) is taken at the farthest crossing of each ray,
 * smoothed round the city, as in the mockup: the front then reaches every part of the border together.
 */
import type { PlayerId } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import type { CellEdge } from './regionLayout.ts';
import { CAPTURE } from './style.ts';
import { easeOutCubic } from './tween.ts';

export type Owner = PlayerId | null;

const TAU = Math.PI * 2;

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
/** Where `t` is between `a` and `b`, 0..1. */
export const phase = (t: number, a: number, b: number): number => clamp01((t - a) / (b - a));
/** Smoothstep of a value in 0..1. */
export const smooth = (t: number): number => t * t * (3 - 2 * t);
/** Ease-out quad: the front starts fast and lands softly. */
export const easeOutQuad = (t: number): number => t * (2 - t);

/** Rays of the reach table: the shader reads it as 64 `vec4`. */
export const REACH_SAMPLES = 256;
/** Rays the farthest crossings are found on before they are smoothed (as in the mockup). */
const FINE_RAYS = 1440;
/** The smoothing of the reach round the city: passes of a box of ±`SMOOTH_HALF` fine rays. */
const SMOOTH_PASSES = 3;
const SMOOTH_HALF = 10;

/** The farthest crossing of the ray from `c` along `(dx, dy)` with the outline `poly`; -1 when none. */
function farthestCrossing(c: Point, dx: number, dy: number, poly: readonly Point[]): number {
  let best = -1;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Point;
    const b = poly[(i + 1) % poly.length] as Point;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const ax = a.x - c.x;
    const ay = a.y - c.y;
    const t = (ax * ey - ay * ex) / den;
    const u = (ax * dy - ay * dx) / den;
    if (t > 0 && u >= 0 && u <= 1 && t > best) best = t;
  }
  return best;
}

/**
 * How far the border of `cell` lies from `centre` round it: `samples` rays, ray `i` at the angle
 * `i / samples` of a turn (0 along +x, growing toward +y), each the farthest crossing, smoothed.
 */
export function radialReach(
  cell: readonly Point[],
  centre: Point,
  samples: number = REACH_SAMPLES,
): Float32Array {
  const fine = new Float32Array(FINE_RAYS);
  let last = 0;
  for (let i = 0; i < FINE_RAYS; i++) {
    const angle = (i / FINE_RAYS) * TAU;
    const r = farthestCrossing(centre, Math.cos(angle), Math.sin(angle), cell);
    fine[i] = r > 0 ? r : last;
    if (r > 0) last = r;
  }
  // A ray that missed before the first hit keeps the last good reach of the turn.
  for (let i = 0; i < FINE_RAYS && (fine[i] ?? 0) <= 0; i++) fine[i] = last;
  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    const src = fine.slice();
    for (let i = 0; i < FINE_RAYS; i++) {
      let sum = 0;
      for (let j = -SMOOTH_HALF; j <= SMOOTH_HALF; j++)
        sum += src[(i + j + FINE_RAYS) % FINE_RAYS] ?? 0;
      fine[i] = sum / (2 * SMOOTH_HALF + 1);
    }
  }
  const table = new Float32Array(samples);
  for (let i = 0; i < samples; i++) table[i] = sampleTurn(fine, i / samples);
  return table;
}

/** The value of a table round the turn at `share` (0..1) of it, linear between rays. */
function sampleTurn(table: Float32Array, share: number): number {
  const n = table.length;
  const at = (((share % 1) + 1) % 1) * n;
  const i0 = Math.floor(at) % n;
  const t = at - Math.floor(at);
  return (table[i0] ?? 0) * (1 - t) + (table[(i0 + 1) % n] ?? 0) * t;
}

/** The field of an area at `p`: 0 at the city, 1 on the border along the ray (the shader does the same). */
export function fitAt(reach: Float32Array, centre: Point, p: Point): number {
  const dx = p.x - centre.x;
  const dy = p.y - centre.y;
  const r = Math.hypot(dx, dy);
  if (r === 0) return 0;
  let angle = Math.atan2(dy, dx);
  if (angle < 0) angle += TAU;
  return r / Math.max(1, sampleTurn(reach, angle / TAU));
}

/** Where a flood is at a moment: what every layer of the area needs. */
export interface FloodLook {
  /** The front in the units of the field; below 0: not started. */
  readonly pos: number;
  /** The soft edge of the front in the units of the field. */
  readonly feather: number;
  /** 0..1: what is left outside the area switches (the last rim of the neighbours' border and glow). */
  readonly clean: number;
  /** Strength of the rim riding inside the front, 0..1 (an enemy capture: half). */
  readonly rim: number;
  /** The share of each road of the node, from its end, that shows the new look. */
  readonly road: number;
  /** Over: the area is drawn as the rest of the map again. */
  readonly done: boolean;
}

/** The flood `ms` after it started; `calm`: an enemy capture; `reduced`: "less motion". */
export function floodLook(ms: number, calm: boolean, reduced: boolean): FloodLook {
  const { feather } = CAPTURE;
  if (reduced) {
    const share = smooth(phase(ms, 0, CAPTURE.reducedMs));
    return { pos: -1, feather, clean: share, rim: 0, road: 1, done: ms >= CAPTURE.reducedMs };
  }
  const x = phase(ms, 0, CAPTURE.ms);
  const p = easeOutQuad(x);
  const started = x > 0;
  const rim =
    smooth(phase(x, 0, CAPTURE.rim.in)) *
    (1 - smooth(phase(x, CAPTURE.rim.out, 1))) *
    (calm ? CAPTURE.calm : 1);
  return {
    pos: started ? p * (1 + feather) : -1,
    feather,
    clean: smooth(phase(ms, CAPTURE.clean.from, CAPTURE.clean.to)),
    rim,
    // The crisp cut of a road sits in the middle of the mockup's soft edge along it.
    road: started ? clamp01(p * CAPTURE.roads.reach - CAPTURE.roads.feather / 2) : 0,
    done: ms >= CAPTURE.clean.to,
  };
}

/** How much of the new look shows at `fit` of the field: the front with its soft edge, or the clean-up. */
export function revealAt(look: FloodLook, fit: number): number {
  const front = smooth(clamp01((look.pos - fit) / look.feather));
  return Math.max(front, look.clean);
}

/** The field of the border lines: the new owner's line lies just inside the border, a neighbour's just outside. */
export const BORDER_FIT = { inside: 0.98, outside: 1.02 } as const;

/** The light at the city of a capture: a flash (none in the Engraved look, #856) and a ring of the owner's colour. */
export interface CityLight {
  /** Alpha of the flash; its reach is `CAPTURE.flash.reach` radii of the city. */
  readonly flash: number;
  /** Alpha of the ring, and how far it is outside the capacity ring (world units at 100 %). */
  readonly ring: number;
  readonly ringRadius: number;
}

/** The light of the city `ms` after the capture; `null` when there is none (over, or "less motion"). */
export function cityLight(ms: number, calm: boolean, reduced: boolean): CityLight | null {
  if (reduced || ms < 0 || ms >= Math.max(CAPTURE.flash.ms, CAPTURE.ring.ms)) return null;
  const f = 1 - phase(ms, 0, CAPTURE.flash.ms);
  const r = phase(ms, 0, CAPTURE.ring.ms);
  return {
    flash: calm ? 0 : CAPTURE.flash.alpha * f * f,
    ring: CAPTURE.ring.alpha * (1 - r) * (calm ? CAPTURE.calm : 1),
    ringRadius: CAPTURE.ring.from + CAPTURE.ring.grow * easeOutCubic(r),
  };
}

/** The areas that share a land or river edge with each area (`edges` of the territory). */
export function neighboursOf(edges: readonly CellEdge[], count: number): number[][] {
  const sets = Array.from({ length: count }, () => new Set<number>());
  for (const { cell, neighbour } of edges) {
    if (neighbour === null || neighbour === cell) continue;
    sets[cell]?.add(neighbour);
    sets[neighbour]?.add(cell);
  }
  return sets.map((s) => [...s].sort((a, b) => a - b));
}

/**
 * The areas whose glow each flood redraws, in the order of `nodes` (the floods under way, oldest
 * first): its own area and its neighbours (the glow of a border lies on both sides of it), except the
 * area of another flood and a neighbour an earlier flood already has. No area is drawn twice.
 */
export function glowRegions(
  nodes: readonly number[],
  neighbours: readonly (readonly number[])[],
): number[][] {
  const flooding = new Set(nodes);
  const taken = new Set(nodes);
  return nodes.map((node) => {
    const cells = [node];
    for (const n of neighbours[node] ?? []) {
      if (flooding.has(n) || taken.has(n)) continue;
      taken.add(n);
      cells.push(n);
    }
    return cells;
  });
}

/** A part of a road `[from, to]` (shares of it from its end `a`) in one look. */
export interface RoadPart<S> {
  readonly from: number;
  readonly to: number;
  readonly style: S;
}

/**
 * The parts of a road while the new look runs out along it from the captured end: `next` (the new
 * look) over the share `cut` from that end, `previous` over the rest. Empty parts are left out.
 */
export function roadParts<S>(
  previous: readonly RoadPart<S>[],
  next: readonly RoadPart<S>[],
  cut: number,
  fromA: boolean,
): RoadPart<S>[] {
  const k = clamp01(cut);
  const [newFrom, newTo] = fromA ? [0, k] : [1 - k, 1];
  const [oldFrom, oldTo] = fromA ? [k, 1] : [0, 1 - k];
  const clip = (parts: readonly RoadPart<S>[], lo: number, hi: number): RoadPart<S>[] =>
    parts
      .map((p) => ({ from: Math.max(p.from, lo), to: Math.min(p.to, hi), style: p.style }))
      .filter((p) => p.to - p.from > 1e-6);
  return [...clip(next, newFrom, newTo), ...clip(previous, oldFrom, oldTo)];
}
