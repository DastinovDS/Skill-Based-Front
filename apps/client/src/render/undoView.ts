import { Graphics } from 'pixi.js';
import type { MapFile } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import { ringRadius } from './cityLayout.ts';
import {
  barbHead,
  drawCasedArrow,
  pathLength,
  pointAlong,
  slicePath,
  trimPath,
} from './casedArrow.ts';
import { hairFloor } from './engraving.ts';
import type { UndoMark } from './interaction.ts';
import type { MapLayers } from './layers.ts';
import { nodePoint, type TokenSpot } from './layout.ts';
import { reducedMotion } from './motion.ts';
import { CASED, CASING, FINE_RING, INK, REWIND, YOU } from './style.ts';
import { nothingLook, rewindLook, rewindRing } from './undoLayout.ts';
import { helmetWidth } from './shapes.ts';

/**
 * The cue of `X` on the map (#764) in the Engraved style, Rewind fixed (#851, ui-style 54b): the
 * player sees which action was undone, because a group turned back that fails to retake its node
 * dies (DEC-24, item G3). The cancelled order winds back into the group behind a double barb that
 * points at the group, and a three-quarter ring winds round the group (or round the city that lost
 * its recruit), its head leading the turn. "Nothing to undo" is a crossed quarter ring beside the
 * pointer. Ink on a dark casing, the order in the own colour; the shapes tell it, not a colour.
 *
 * `update` runs every frame; a cue lives on the clock, a few shapes for about a second.
 */
export class UndoView {
  private readonly g = new Graphics();
  private zoom = 1;
  private resolution = 1;

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    private readonly radiusOf: (node: number) => number,
    private readonly color: number = YOU,
  ) {
    this.g.label = 'undo-cue';
    layers.layer.effects.addChild(this.g);
  }

  /** The camera (css px per world unit) and the device pixel ratio: hairlines keep one device pixel. */
  setCamera(zoom: number, resolution: number): void {
    this.zoom = zoom;
    this.resolution = resolution;
  }

  /**
   * `pointer`: where the pointer is on the map; `scale`: keeps the sign of "nothing to undo"
   * readable zoomed out, like the other effects.
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
    const hair = hairFloor(this.zoom, this.resolution);
    for (const mark of marks) {
      if (mark.group === null && mark.node === null) {
        const look = nothingLook(now - mark.at, reduced);
        if (look === null) continue;
        const off = REWIND.empty.offset;
        this.drawNothing(
          { x: pointer.x + (off.x + look.dx) * scale, y: pointer.y + off.y * scale },
          scale,
          look.alpha,
          hair,
        );
        continue;
      }
      const look = rewindLook(now - mark.at, reduced);
      if (look === null) continue;
      const spot = mark.group === null ? undefined : spotOf(mark.group);
      const at = spot ?? (mark.node === null ? undefined : nodePoint(this.map, mark.node));
      if (at === undefined) continue;
      // The ring hugs the helmet of a group (the mockup's `w * 0.62 + 5`), or the Fine ring of a city.
      const radius =
        spot !== undefined
          ? helmetWidth(spot.side, spot.inside === true) * spot.scale * 0.62 + REWIND.ring.gap
          : ringRadius(this.radiusOf(mark.node ?? 0)) + FINE_RING.r1;
      if (look.arrowAlpha > 0) this.drawArrow(mark, at, spot, look.arrow, look.arrowAlpha, hair);
      if (look.ringAlpha > 0) this.drawRing(at, radius, look.ring, look.ringAlpha, hair);
    }
  }

  destroy(): void {
    this.g.destroy();
  }

  /**
   * The way the order still had, from the group to its target, winding back into the group: the
   * Cased arrow without its head, cut to `share` of its length, and two barbs at its end turned
   * towards the group.
   */
  private drawArrow(
    mark: UndoMark,
    at: Point,
    spot: TokenSpot | undefined,
    share: number,
    alpha: number,
    hair: number,
  ): void {
    const ahead = mark.path[0] === mark.node ? mark.path.slice(1) : mark.path;
    const dest = ahead.at(-1);
    const nodes = ahead.map((id) => nodePoint(this.map, id));
    if (dest === undefined || nodes.some((p) => p === undefined)) return;
    const lead =
      spot === undefined ? 0 : helmetWidth(spot.side, spot.inside === true) * spot.scale * 0.45;
    const whole = trimPath(
      [at, ...(nodes as Point[])],
      lead,
      ringRadius(this.radiusOf(dest)) + CASED.endGap,
    );
    const length = pathLength(whole);
    if (length <= 0) return;
    const part = slicePath(whole, 0, Math.min(length, Math.max(REWIND.keep, length * share)));
    if (part.length < 2) return;
    const g = this.g;
    drawCasedArrow(g, part, {
      color: this.color,
      alpha,
      noHead: true,
      seconds: null,
      hair,
      zoom: this.zoom,
    });
    // The rewind sign: two solid barbs pointing back along the line, the first at its end.
    const end = pointAlong(part, pathLength(part));
    const B = REWIND.barb;
    const back = { x: -end.dir.x, y: -end.dir.y };
    for (const off of [B.gap, 0]) {
      const tip = {
        x: end.at.x - end.dir.x * (off + B.length),
        y: end.at.y - end.dir.y * (off + B.length),
      };
      const head = barbHead(tip, back, B.length, B.width).flatMap((p) => [p.x, p.y]);
      g.poly(head).stroke({ width: B.casing, color: CASING, alpha, join: 'round' });
      g.poly(head).fill({ color: this.color, alpha });
      g.poly(head).stroke({ width: Math.max(B.ink, hair), color: INK, alpha, join: 'round' });
    }
  }

  /** The three-quarter ring winding round the group, its head leading the turn. */
  private drawRing(at: Point, radius: number, share: number, alpha: number, hair: number): void {
    const ring = rewindRing(at, radius, share);
    if (ring === null) return;
    const g = this.g;
    const R = REWIND.ring;
    const trace = (): void => {
      const [first, ...rest] = ring.arc;
      if (first === undefined) return;
      g.moveTo(first.x, first.y);
      for (const p of rest) g.lineTo(p.x, p.y);
    };
    trace();
    g.stroke({ width: R.casing, color: CASING, alpha, cap: 'round' });
    trace();
    g.stroke({ width: Math.max(R.ink, hair), color: INK, alpha, cap: 'round' });
    const H = REWIND.ringHead;
    const head = barbHead(ring.tip, ring.dir, H.length, H.width).flatMap((p) => [p.x, p.y]);
    g.poly(head).stroke({ width: H.casing, color: CASING, alpha, join: 'round' });
    g.poly(head).fill({ color: INK, alpha });
  }

  /** "Nothing to undo": a quarter ring (the rewind, going nowhere) struck through. */
  private drawNothing(at: Point, scale: number, alpha: number, hair: number): void {
    const g = this.g;
    const E = REWIND.empty;
    const r = E.radius * scale;
    const s = E.slash * scale;
    const arc = (): void => {
      const from = -Math.PI;
      g.moveTo(at.x + r * Math.cos(from), at.y + r * Math.sin(from)).arc(
        at.x,
        at.y,
        r,
        from,
        -Math.PI / 2,
      );
    };
    const slash = (): void => {
      g.moveTo(at.x - s, at.y + s).lineTo(at.x + s, at.y - s);
    };
    arc();
    g.stroke({ width: E.casing * scale, color: CASING, alpha, cap: 'round' });
    arc();
    g.stroke({ width: Math.max(E.ink * scale, hair), color: INK, alpha, cap: 'round' });
    slash();
    g.stroke({ width: (E.casing - 0.6) * scale, color: CASING, alpha, cap: 'round' });
    slash();
    g.stroke({ width: Math.max((E.ink - 0.1) * scale, hair), color: INK, alpha, cap: 'round' });
  }
}
