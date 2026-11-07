import { Graphics } from 'pixi.js';
import type { MapFile } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import { dashAlong } from './intentLayout.ts';
import type { UndoMark } from './interaction.ts';
import type { MapLayers } from './layers.ts';
import { arrowGeometry, nodePoint, type TokenSpot } from './layout.ts';
import { reducedMotion } from './motion.ts';
import { unitStyle } from '../units/unitStyle.ts';
import { ARROW_HEAD, BG, ORDER_GHOST_DASH, ORDER_GHOST_GAP, PAPER, UNDO_CUE } from './style.ts';
import {
  circlePoints,
  cutPolyline,
  insetEnd,
  undoGlyph,
  undoLook,
  type UndoLook,
} from './undoLayout.ts';

/** The resting ring round a group token, against the side of its triangle (a helmet with its strap is bigger, #784). */
const GROUP_RING = { triangle: 0.85, helmet: 1 } as const;
/** The resting ring round a city: this far outside its circle (world units). */
const NODE_RING_GAP = 8;

/**
 * The cue of `X` on the map (#764): the player sees which action was undone, because a group turned
 * back that fails to retake its node dies (DEC-24, item G3). At the place of the undone action a
 * dashed ring closes in on the group or the city and a round-arrow sign stands beside it; the dashed
 * arrow of a cancelled order runs back into the group. All of it in paper with a dark casing: the
 * shape and the dashes tell it, not a colour. "Nothing to undo" is a dim crossed sign at the pointer.
 *
 * `update` runs every frame; the cue lives on the clock, a few shapes for about a second.
 */
export class UndoView {
  private readonly g = new Graphics();

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    private readonly radiusOf: (node: number) => number,
  ) {
    this.g.label = 'undo-cue';
    layers.layer.effects.addChild(this.g);
  }

  /**
   * `pointer`: where the pointer is on the map; `scale`: keeps the cue readable zoomed out, like
   * the other effects.
   */
  update(
    marks: readonly UndoMark[],
    spotOf: (group: string) => TokenSpot | undefined,
    pointer: Point,
    scale: number,
    now: number = performance.now(),
  ): void {
    const g = this.g;
    g.clear();
    const reduced = reducedMotion();
    for (const mark of marks) {
      const look = undoLook(now - mark.at, reduced);
      if (look === null) continue;
      if (mark.group === null && mark.node === null) {
        const off = UNDO_CUE.emptyOffset * scale;
        const at = { x: pointer.x + off, y: pointer.y - off };
        this.drawSign(at, scale, look.alpha * UNDO_CUE.emptyAlpha, true);
        continue;
      }
      const spot = mark.group === null ? undefined : spotOf(mark.group);
      const at = spot ?? (mark.node === null ? undefined : nodePoint(this.map, mark.node));
      if (at === undefined) continue;
      const radius =
        spot !== undefined
          ? spot.side * spot.scale * GROUP_RING[unitStyle()]
          : this.radiusOf(mark.node ?? 0) + NODE_RING_GAP;
      this.drawArrow(mark, at, look, scale);
      this.drawRing(at, radius * look.ring, look.alpha, scale);
      const corner = radius * Math.SQRT1_2;
      const sign = (UNDO_CUE.sign + 2) * scale * Math.SQRT1_2;
      this.drawSign({ x: at.x + corner + sign, y: at.y - corner - sign }, scale, look.alpha, false);
    }
  }

  destroy(): void {
    this.g.destroy();
  }

  /** The way the order still had, from the group to its target, running back into the group. */
  private drawArrow(mark: UndoMark, at: Point, look: UndoLook, scale: number): void {
    const ahead = mark.path[0] === mark.node ? mark.path.slice(1) : mark.path;
    const dest = ahead.at(-1);
    const nodes = ahead.map((id) => nodePoint(this.map, id));
    if (dest === undefined || nodes.some((p) => p === undefined)) return;
    const whole = insetEnd([at, ...(nodes as Point[])], this.radiusOf(dest) + 2);
    const points = cutPolyline(whole, look.arrow);
    const last = points.at(-1);
    const before = points.at(-2);
    if (last === undefined || before === undefined) return;
    const g = this.g;
    const head = arrowGeometry(before, last, 0, 0, ARROW_HEAD.length, ARROW_HEAD.width);
    const dashes = dashAlong(
      head === null ? points : [...points.slice(0, -1), head.end],
      ORDER_GHOST_DASH,
      ORDER_GHOST_GAP,
      0,
    );
    for (const pass of [
      { width: (UNDO_CUE.arrowWidth + 3) * scale, color: BG, alpha: 0.6 * look.alpha },
      { width: UNDO_CUE.arrowWidth * scale, color: PAPER, alpha: look.alpha },
    ]) {
      this.trace(dashes);
      g.stroke({ ...pass, cap: 'round' });
    }
    if (head !== null) {
      g.poly([head.head[0], head.head[1], head.head[2]])
        .fill({ color: PAPER, alpha: look.alpha })
        .stroke({ width: 1.5 * scale, color: BG, alpha: 0.8 * look.alpha });
    }
  }

  private drawRing(at: Point, radius: number, alpha: number, scale: number): void {
    const dashes = dashAlong(
      circlePoints(at, radius),
      UNDO_CUE.ringDash * scale,
      UNDO_CUE.ringGap * scale,
      0,
      true,
    );
    const g = this.g;
    this.trace(dashes);
    g.stroke({
      width: (UNDO_CUE.ringWidth + 3) * scale,
      color: BG,
      alpha: 0.7 * alpha,
      cap: 'round',
    });
    this.trace(dashes);
    g.stroke({ width: UNDO_CUE.ringWidth * scale, color: PAPER, alpha, cap: 'round' });
  }

  /** The round-arrow sign on a dark disc; `crossed`: there was nothing to undo. */
  private drawSign(at: Point, scale: number, alpha: number, crossed: boolean): void {
    const g = this.g;
    const radius = UNDO_CUE.sign * scale;
    const { arc, head } = undoGlyph(at, radius * 0.55);
    g.circle(at.x, at.y, radius)
      .fill({ color: BG, alpha: 0.85 * alpha })
      .stroke({ width: 1.5 * scale, color: PAPER, alpha });
    this.trace([arc]);
    g.stroke({ width: UNDO_CUE.signWidth * scale, color: PAPER, alpha, cap: 'round' });
    g.poly([head[0], head[1], head[2]]).fill({ color: PAPER, alpha });
    if (crossed) {
      const r = radius * Math.SQRT1_2;
      g.moveTo(at.x - r, at.y + r).lineTo(at.x + r, at.y - r);
      g.stroke({ width: (UNDO_CUE.signWidth + 2) * scale, color: BG, alpha, cap: 'round' });
      g.moveTo(at.x - r, at.y + r).lineTo(at.x + r, at.y - r);
      g.stroke({ width: UNDO_CUE.signWidth * scale, color: PAPER, alpha, cap: 'round' });
    }
  }

  private trace(lines: readonly (readonly Point[])[]): void {
    for (const [first, ...rest] of lines) {
      if (first === undefined) continue;
      this.g.moveTo(first.x, first.y);
      for (const p of rest) this.g.lineTo(p.x, p.y);
    }
  }
}
