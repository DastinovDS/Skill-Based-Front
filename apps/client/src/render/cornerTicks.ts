import { Graphics } from 'pixi.js';
import { ENGRAVED, easeSettle } from '../theme/tokens.ts';
import { helmet, helmetExtent } from '../units/helmet.ts';
import type { Diamond, TokenSpot } from './layout.ts';
import { reducedMotion } from './motion.ts';
import { CASING, CORNER_TICKS } from './style.ts';

/** A corner of the box round a helmet and the way its two arms point (towards the box's inside). */
export interface TickCorner {
  readonly x: number;
  readonly y: number;
  readonly sx: 1 | -1;
  readonly sy: 1 | -1;
}

/**
 * The corners of the box round the helmet of `spot` as drawn (its fitted `width`, casing and strap
 * included, `CORNER_TICKS.gap` clear), flat around the token's centre, clockwise from the top left
 * on screen: the opponent's helmet faces left, so its box is the mirror.
 */
export function tickCorners(spot: Pick<TokenSpot, 'width' | 'enemy'>): TickCorner[] {
  const enemy = spot.enemy === true;
  const e = helmetExtent(helmet(enemy ? 'enemy' : 'own', spot.width));
  const gap = CORNER_TICKS.gap;
  const x0 = (enemy ? -e.right : e.left) - gap;
  const x1 = (enemy ? -e.left : e.right) + gap;
  const y0 = e.top - gap;
  const y1 = e.bottom + gap;
  return [
    { x: x0, y: y0, sx: 1, sy: 1 },
    { x: x1, y: y0, sx: -1, sy: 1 },
    { x: x1, y: y1, sx: -1, sy: -1 },
    { x: x0, y: y1, sx: 1, sy: -1 },
  ];
}

/** The corners a look shows: all four selected, the top left and the bottom right hovered. */
export function tickCornersFor(look: TickLook, corners: readonly TickCorner[]): TickCorner[] {
  return look === 'select' ? [...corners] : [corners[0], corners[2]].filter((c) => c !== undefined);
}

/** The three points of the L of a corner, `grow` further out along its diagonal. */
export function tickPoints(
  corner: TickCorner,
  grow: number,
  arm: number = CORNER_TICKS.arm,
): [number, number][] {
  const ox = -corner.sx * grow;
  const oy = -corner.sy * grow;
  return [
    [corner.x + ox + corner.sx * arm, corner.y + oy],
    [corner.x + ox, corner.y + oy],
    [corner.x + ox, corner.y + oy + corner.sy * arm],
  ];
}

export type TickLook = 'select' | 'hover';

type Pair = [number, number];

/**
 * The part of the segment `a` to `b` outside the diamond `d` grown by `reach` (a distance across,
 * not along the axes): up to two pieces (the start and the end), as parameters 0..1. The diamond is
 * four half planes, so the clip is the intersection of four intervals (Cyrus-Beck).
 */
export function outsideDiamond(a: Pair, b: Pair, d: Diamond, reach: number): [number, number][] {
  const limit = d.h + reach * Math.SQRT2;
  let t0 = 0;
  let t1 = 1;
  for (const [sx, sy] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const) {
    // g(t) = g0 + g1 t <= 0 inside this half plane.
    const g0 = sx * (a[0] - d.x) + sy * (a[1] - d.y) - limit;
    const g1 = sx * (b[0] - a[0]) + sy * (b[1] - a[1]);
    if (g1 === 0) {
      if (g0 > 0) return [[0, 1]];
      continue;
    }
    const t = -g0 / g1;
    if (g1 > 0) t1 = Math.min(t1, t);
    else t0 = Math.max(t0, t);
  }
  if (t0 >= t1) return [[0, 1]];
  const pieces: [number, number][] = [];
  if (t0 > 0) pieces.push([0, t0]);
  if (t1 < 1) pieces.push([t1, 1]);
  return pieces;
}

/**
 * The strokes of the tick `corner` (`grow` further out) with the diamonds of `under` taken out: an
 * L with nothing over it is one path, an L cut by a diamond is the pieces that stay. `reach` is how
 * far from a diamond's edge a stroke ends (the cap of the dark casing then just touches it).
 */
export function tickPaths(
  corner: TickCorner,
  grow: number,
  under: readonly Diamond[],
  reach: number,
): Pair[][] {
  const [a, b, c] = tickPoints(corner, grow);
  if (a === undefined || b === undefined || c === undefined) return [];
  if (under.length === 0) return [[a, b, c]];
  // Each arm as a list of kept pieces along it, from the corner out.
  const arm = (from: Pair, to: Pair): [number, number][] => {
    let kept: [number, number][] = [[0, 1]];
    for (const d of under) {
      kept = kept.flatMap(([k0, k1]) =>
        outsideDiamond(at(from, to, k0), at(from, to, k1), d, reach).map(
          ([p, q]): [number, number] => [k0 + p * (k1 - k0), k0 + q * (k1 - k0)],
        ),
      );
    }
    return kept;
  };
  const one = arm(b, a);
  const two = arm(b, c);
  const paths: Pair[][] = [];
  const first = one[0];
  const second = two[0];
  const joined = first?.[0] === 0 && second?.[0] === 0;
  if (joined) {
    paths.push([at(b, a, first[1]), b, at(b, c, second[1])]);
  }
  one.forEach(([p, q], i) => {
    if (!(joined && i === 0)) paths.push([at(b, a, p), at(b, a, q)]);
  });
  two.forEach(([p, q], i) => {
    if (!(joined && i === 0)) paths.push([at(b, c, p), at(b, c, q)]);
  });
  return paths;
}

function at(from: Pair, to: Pair, t: number): Pair {
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
}

/** How far in a cue is `ageMs` after it appeared: 0 (not yet) to 1; at once under "less motion". */
export function tickProgress(ageMs: number, reduced: boolean): number {
  if (reduced) return 1;
  return easeSettle(ageMs / CORNER_TICKS.ms);
}

/**
 * The corner ticks of one group, selected or hovered (B6, #949): a `Graphics` in the overlay at the
 * token's place and scale, redrawn only when the group, its drawn width or the step of the entrance
 * changes. State is shape and weight (four ticks, or two fainter), not colour.
 */
export class CornerTicks {
  readonly view: Graphics;
  private key = '';
  private id = '';
  private since = 0;

  constructor(label: string) {
    this.view = new Graphics({ label, visible: false });
  }

  /** Shows the ticks of group `id` at `spot` in `look`, or hides them (`spot` undefined). */
  update(id: string, spot: TokenSpot | undefined, look: TickLook, now: number): void {
    const g = this.view;
    if (spot === undefined) {
      g.visible = false;
      this.key = '';
      this.id = '';
      return;
    }
    // A cue that has just appeared (or moved to another group) comes in.
    if (!g.visible || this.id !== id) this.since = now;
    this.id = id;
    g.visible = true;
    g.position.set(spot.x, spot.y);
    g.scale.set(spot.scale);
    const k = tickProgress(now - this.since, reducedMotion());
    const under = (spot.under ?? []).map(
      (d) => `${d.x.toFixed(1)},${d.y.toFixed(1)},${d.h.toFixed(1)}`,
    );
    const key = `${look}:${spot.enemy === true ? 'e' : 'o'}:${String(spot.width)}:${k.toFixed(3)}:${under.join(';')}`;
    if (key === this.key) return;
    this.key = key;
    this.draw(spot, look, k);
  }

  private draw(spot: TokenSpot, look: TickLook, k: number): void {
    const g = this.view;
    g.clear();
    const T = CORNER_TICKS;
    // The mockup eases the entrance twice: the alpha with `k`, the grow with the eased `k`.
    const grow = (1 - easeSettle(k)) * T.grow;
    const shown = tickCornersFor(look, tickCorners(spot));
    const alpha = look === 'select' ? T.ink.select : T.ink.hover;
    const under = spot.under ?? [];
    for (const pass of ['casing', 'ink'] as const) {
      // A gilt diamond over the cue (the VP lozenge): the casing's square cap just touches its edge,
      // the ink stops a hair short of the end of the casing.
      const reach = T.casing.width / 2 + (pass === 'casing' ? 0.1 : 0.9);
      for (const corner of shown) {
        for (const path of tickPaths(corner, grow, under, reach)) {
          path.forEach(([x, y], i) => {
            if (i === 0) g.moveTo(x, y);
            else g.lineTo(x, y);
          });
        }
      }
      if (pass === 'casing') {
        g.stroke({
          width: T.casing.width,
          color: CASING,
          alpha: T.casing.alpha * k,
          cap: 'square',
          join: 'miter',
        });
      } else {
        g.stroke({
          width: T.ink.width,
          color: ENGRAVED.ink,
          alpha: alpha * k,
          cap: 'butt',
          join: 'miter',
        });
      }
    }
  }

  destroy(): void {
    this.view.destroy();
  }
}
