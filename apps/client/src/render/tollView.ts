import { Container, Graphics, GraphicsContext, Text, TextStyle } from 'pixi.js';
import type { EventMsg, MapFile, PlayerId } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import type { EnemyAnchors } from './entityView.ts';
import { borderPoint } from './fogLayout.ts';
import type { LineMark } from './fortView.ts';
import type { Punch } from './hitView.ts';
import type { TokenSpot } from './layout.ts';
import { reducedMotion } from './motion.ts';
import { pieceFamily, usePieceFont } from './pieceFont.ts';
import { BADGE_DOWN, CASING, CUT, INK, ownerColor } from './style.ts';
import {
  STRIKE,
  TOLL_HIT,
  hitCuts,
  hitPhase,
  strikeLines,
  tollInfo,
  tollMs,
  tollNumber,
  tollPop,
  tollSeed,
  type TollInfo,
} from './tollLayout.ts';

/** Most tolls drawn at once (a long road of walls taxes a group several times a second at most). */
const MAX_TOLLS = 8;
/** The tag of the number sits this far above the group (world units at 100%), and rises this much. */
const TAG_LIFT = 22;
const TAG_RISE = 6;
/** The tag (mockup `tollTag`): a thin dark plate, a down chevron before "-N". */
const TAG = {
  height: 17,
  radius: 4,
  fill: 0x0e0c09,
  alpha: 0.94,
  chevron: 9,
  pad: 6,
  digit: 7,
} as const;
/** A real minus sign. */
const MINUS = '−';

interface Tag {
  readonly view: Container;
  readonly frame: Graphics;
  readonly text: Text;
  width: number;
}

/**
 * The toll of road fortifications on the map (#707), Engraved (#858): per toll the strike from the gate
 * of the wall to the group (three hairlines: an ivory core between two in the colour of the wall's
 * owner), the engraved hit on the group (seven cuts and an ink ring, the token swells), and the tag
 * "-N" over it, a down chevron before the number. All in the layer `tolls`, which the «Supply» mode
 * does not hide. One `Graphics` holds the strikes and hits and is drawn only while a toll plays; the
 * tags are pooled. Every effect is a function of the render tick, so a paused scene shows a toll in the
 * state of its tick. With "less motion" only the tag stays, still. `destroy()` frees the pool.
 */
export class TollView {
  private readonly layer = new Container({ label: 'tolls' });
  private readonly lines = new Graphics({ label: 'toll-lines' });
  private readonly tags: Tag[] = [];
  private readonly frames = new Map<number, GraphicsContext>();
  private readonly style: TextStyle;
  private readonly colors: { own: number; enemy: number };
  private tolls: readonly TollInfo[] = [];
  private eventsSeen: readonly EventMsg[] | null = null;
  private eventCount = -1;
  private drewLines = false;
  private floor = 0;

  constructor(
    parent: Container,
    private readonly map: MapFile,
    me: PlayerId,
    private resolution: number,
    /** Where the toll of the wall of `node` on `edge` leaves it (`FortView.lineAt`). */
    private readonly lineAt: (node: number, edge: number) => LineMark | undefined,
  ) {
    const enemy: PlayerId = me === 0 ? 1 : 0;
    this.colors = { own: ownerColor(me, me), enemy: ownerColor(me, enemy) };
    this.style = new TextStyle({
      fontFamily: pieceFamily(),
      fontSize: 12.5,
      fontWeight: '600',
      fill: INK,
    });
    usePieceFont([this.style]);
    this.layer.addChild(this.lines);
    parent.addChild(this.layer);
  }

  setScreenResolution(resolution: number): void {
    this.resolution = resolution;
    for (const tag of this.tags) tag.text.resolution = resolution;
  }

  /** The thinnest line in world units (one device pixel). */
  setHairFloor(floor: number): void {
    this.floor = floor;
  }

  /** Whether a strike or a hit is drawn now (tests). */
  drawing(): boolean {
    return this.drewLines;
  }

  /**
   * Draws the tolls of the frame; returns the tokens that swell. `scale`: the size of everything on
   * the map (more when zoomed out).
   */
  update(
    events: readonly EventMsg[],
    tick: number,
    spots: ReadonlyMap<string, TokenSpot>,
    enemies: EnemyAnchors | null,
    tickHz: number,
    scale: number,
  ): Punch[] {
    this.readEvents(events);
    const reduced = reducedMotion();
    const punches: Punch[] = [];
    const g = this.lines;
    if (this.drewLines) g.clear();
    let drew = false;
    let used = 0;
    let count = 0;
    for (const toll of this.tolls) {
      const ms = tollMs(tick - toll.tick, tickHz);
      if (ms === null || count >= MAX_TOLLS) continue;
      if (this.map.edges[toll.edge] === undefined) continue;
      count++;
      const mark = this.lineAt(toll.node, toll.edge);
      const from: Point = mark ?? borderPoint(this.map, toll.edge) ?? { x: 0, y: 0 };
      const at = this.victimAt(toll, from, spots, enemies);
      // The wall that struck belongs to the side that did not pay.
      const color = toll.paid ? this.colors.enemy : this.colors.own;
      if (!reduced) {
        drew = this.strike(g, from, at, ms, color, scale) || drew;
        drew = this.hit(g, at, ms, color, scale, tollSeed(toll)) || drew;
        const pop = tollPop(ms);
        if (pop !== 1) punches.push({ at, scale: pop });
      }
      const number = tollNumber(ms, reduced, TAG_RISE);
      if (number === null) continue;
      const tag = this.tag(used++, toll.charges);
      tag.view.position.set(at.x, at.y - (TAG_LIFT + number.lift) * scale);
      tag.view.scale.set(scale);
      tag.view.alpha = number.alpha;
      tag.view.visible = true;
    }
    this.drewLines = drew;
    for (let i = used; i < this.tags.length; i++) {
      const tag = this.tags[i];
      if (tag !== undefined) tag.view.visible = false;
    }
    return punches;
  }

  private hair(width: number, scale: number): number {
    return Math.max(width * scale, this.floor);
  }

  /** The strike from the gate to the group: three hairlines, the ivory core between two of the colour. */
  private strike(
    g: Graphics,
    from: Point,
    to: Point,
    ms: number,
    color: number,
    scale: number,
  ): boolean {
    const lines = strikeLines(from, to, ms, scale);
    if (lines === null) return false;
    const path = (pair: readonly Point[] | undefined): void => {
      const a = pair?.[0];
      const b = pair?.[1];
      if (a !== undefined && b !== undefined) g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    };
    // The ivory core on a dark casing, the two hairlines of the wall's owner beside it.
    const core = this.hair(STRIKE.core, scale);
    path(lines[1]);
    g.stroke({ width: core + 1.6 * scale, color: CASING, alpha: 0.7, cap: 'round' });
    path(lines[1]);
    g.stroke({ width: core, color: INK, cap: 'round' });
    path(lines[0]);
    path(lines[2]);
    g.stroke({ width: this.hair(STRIKE.side, scale), color, cap: 'round' });
    return true;
  }

  /** The engraved hit on the group: seven cuts thrown out, every other in ink, and an ink ring. */
  private hit(
    g: Graphics,
    at: Point,
    ms: number,
    color: number,
    scale: number,
    seed: number,
  ): boolean {
    const q = hitPhase(ms);
    if (q === null) return false;
    const alpha = 1 - q;
    const { cuts, ring } = hitCuts(at, q, scale, seed);
    for (const ink of [true, false]) {
      for (const cut of cuts) {
        if (cut.ink !== ink) continue;
        g.moveTo(cut.from.x, cut.from.y).lineTo(cut.to.x, cut.to.y);
      }
      g.stroke({
        width: this.hair(TOLL_HIT.width, scale),
        color: ink ? INK : color,
        alpha,
        cap: 'round',
      });
    }
    g.circle(at.x, at.y, ring).stroke({
      width: this.hair(0.8, scale),
      color: INK,
      alpha: alpha * 0.8,
    });
    return true;
  }

  /** The tolls among the events, read again only when the list has grown. */
  private readEvents(events: readonly EventMsg[]): void {
    if (events === this.eventsSeen && events.length === this.eventCount) return;
    this.eventsSeen = events;
    this.eventCount = events.length;
    this.tolls = events.flatMap((event) => tollInfo(event) ?? []);
  }

  /** The group that lost the charges: the own token, or the enemy figure on the road nearest the wall. */
  private victimAt(
    toll: TollInfo,
    from: Point,
    spots: ReadonlyMap<string, TokenSpot>,
    enemies: EnemyAnchors | null,
  ): Point {
    if (toll.group !== null) {
      const spot = spots.get(toll.group);
      if (spot !== undefined) return { x: spot.x, y: spot.y };
      return from;
    }
    return enemies?.nearestOnEdge(toll.edge, from) ?? from;
  }

  /** The frame of a tag `width` wide (a few widths, cached): the plate, its thin rule, the chevron. */
  private frame(width: number): GraphicsContext {
    let ctx = this.frames.get(width);
    if (ctx === undefined) {
      const { height, radius, fill, alpha, chevron, pad } = TAG;
      const x = -width / 2;
      const y = -height / 2;
      ctx = new GraphicsContext()
        .roundRect(x, y, width, height, radius)
        .fill({ color: fill, alpha })
        .stroke({ width: 1.6, color: CUT })
        .roundRect(x + 1.5, y + 1.5, width - 3, height - 3, radius - 1)
        .stroke({ width: 0.8, color: INK, alpha: 0.55 });
      // The down chevron: the loss of a charge (the mockup's `chevrons(..., 'down')`).
      const cx = x + pad + chevron / 2 - 1;
      const hw = chevron * 0.42;
      const hh = chevron * 0.24;
      const stroke = chevron * 0.24;
      for (const [tone, w] of [
        [CUT, stroke + 2.6],
        [BADGE_DOWN, stroke],
      ] as const) {
        ctx
          .moveTo(cx - hw, -hh)
          .lineTo(cx, hh)
          .lineTo(cx + hw, -hh)
          .stroke({ width: w, color: tone, cap: 'round', join: 'round' });
      }
      this.frames.set(width, ctx);
    }
    return ctx;
  }

  private tag(index: number, charges: number): Tag {
    let tag = this.tags[index];
    if (tag === undefined) {
      const view = this.layer.addChild(new Container({ label: 'toll-tag', visible: false }));
      const frame = view.addChild(new Graphics());
      const text = view.addChild(
        new Text({ text: '', style: this.style, anchor: 0.5, resolution: this.resolution }),
      );
      tag = { view, frame, text, width: 0 };
      this.tags.push(tag);
    }
    const label = `${MINUS}${String(charges)}`;
    if (tag.text.text !== label) tag.text.text = label;
    // The width of the plate: the number (from its characters, no text measure), the chevron and the padding.
    const width = Math.ceil(label.length * TAG.digit + TAG.chevron + 2 * TAG.pad + 2);
    if (width !== tag.width) {
      tag.width = width;
      tag.frame.context = this.frame(width);
    }
    tag.text.position.set((TAG.chevron + 2) / 2, 0.5);
    return tag;
  }

  destroy(): void {
    this.layer.destroy({ children: true });
    for (const ctx of this.frames.values()) ctx.destroy();
    this.style.destroy();
  }
}
