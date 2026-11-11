import { Graphics } from 'pixi.js';
import { ENGRAVED, easeSettle } from '../theme/tokens.ts';
import { helmet, helmetExtent } from '../units/helmet.ts';
import type { TokenSpot } from './layout.ts';
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
export function tickPoints(corner: TickCorner, grow: number): [number, number][] {
  const ox = -corner.sx * grow;
  const oy = -corner.sy * grow;
  const arm = CORNER_TICKS.arm;
  return [
    [corner.x + ox + corner.sx * arm, corner.y + oy],
    [corner.x + ox, corner.y + oy],
    [corner.x + ox, corner.y + oy + corner.sy * arm],
  ];
}

export type TickLook = 'select' | 'hover';

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
    const key = `${look}:${spot.enemy === true ? 'e' : 'o'}:${String(spot.width)}:${k.toFixed(3)}`;
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
    for (const pass of ['casing', 'ink'] as const) {
      for (const corner of shown) {
        const [a, b, c] = tickPoints(corner, grow);
        if (a === undefined || b === undefined || c === undefined) continue;
        g.moveTo(a[0], a[1]).lineTo(b[0], b[1]).lineTo(c[0], c[1]);
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
