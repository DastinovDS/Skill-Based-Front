import { Container, Graphics, GraphicsContext, Text, TextStyle } from 'pixi.js';
import type { EventMsg, MapFile, PlayerId } from '../protocol.gen.ts';
import type { RenderFrame } from '../net/interpolate.ts';
import type { Point } from './camera.ts';
import {
  bounceArrow,
  bounceInfo,
  captureInfo,
  effectProgress,
  flashLook,
  numbersLook,
  scaledPolygon,
  starPolygon,
  waveLook,
  type BounceInfo,
  type CaptureInfo,
} from './effectsLayout.ts';
import type { MapLayers } from './layers.ts';
import {
  dashSegments,
  edgeEnds,
  fightInfo,
  nodePoint,
  type FightInfo,
  type TokenSpot,
} from './layout.ts';
import { reducedMotion } from './motion.ts';
import {
  BG,
  BOUNCE_LENGTH,
  BOUNCE_MS,
  FIGHT_COLOR,
  FLASH_MS,
  FLASH_STAR,
  LOSS_FONT_SIZE,
  NUMBERS_MS,
  ORDER_GHOST_DASH,
  ORDER_GHOST_GAP,
  WAVE_FILL_ALPHA,
  WAVE_MS,
  WAVE_STROKE,
  ownerColor,
} from './style.ts';

const MAX_FIGHTS = 8;
const MAX_WAVES = 4;
/** The minus sign (U+2212) in front of a loss number. */
const MINUS = '−';

interface FightMark {
  view: Container;
  star: Graphics;
  /** Own losses on the left, the opponent's on the right. */
  texts: [Text, Text];
}

/** Where a bounced group goes back to, found once when its own token is on the road. */
type BounceArrow = NonNullable<ReturnType<typeof bounceArrow>> | null;

/**
 * Effects of events on the map (ui-style 9.9, U8): the white flash of a fight and then the two
 * loss numbers (own on the left, the opponent's on the right: the side is told by the place and
 * the colour), the short dashed arrow of an own group bounced back along its road, and the wave of
 * the new owner over the cell of a captured city. With "less motion" only the numbers stay, and
 * they do not rise. Events come from the server (`fight`, `fight_group`, `node_captured`); nothing
 * is guessed: the enemy's bounces are not sent, so none is drawn.
 *
 * `update` runs every frame with the render tick; the effects are a function of the tick, so a
 * paused or frozen scene shows them in the state of that tick. `destroy()` releases everything.
 */
export class EffectsView {
  private readonly layer = new Container({ label: 'effects' });
  private readonly marks: FightMark[] = [];
  private readonly waves: Graphics[] = [];
  private readonly arrows = new Graphics();
  private readonly contexts: GraphicsContext[] = [];
  private readonly star: GraphicsContext;
  private readonly lossStyles: Record<'own' | 'enemy', TextStyle>;
  private fights: FightInfo[] = [];
  private captures: CaptureInfo[] = [];
  private bounces: BounceInfo[] = [];
  private readonly arrowAt = new Map<string, BounceArrow>();
  private eventsSeen: readonly EventMsg[] | null = null;
  private eventCount = -1;

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    private readonly me: PlayerId,
    private labelResolution: number,
    /** The Voronoi cells of the cities (`MapView.cells`). */
    private readonly cells: readonly (readonly Point[])[],
  ) {
    this.star = this.context((g) =>
      g
        .poly(starPolygon(FLASH_STAR.outer, FLASH_STAR.inner, FLASH_STAR.points))
        .fill(FIGHT_COLOR)
        .stroke({ width: 2.5, color: BG, join: 'round' }),
    );
    const loss = (color: number): TextStyle =>
      new TextStyle({
        fontFamily: 'system-ui, sans-serif',
        fontSize: LOSS_FONT_SIZE,
        fontWeight: '700',
        fill: color,
        stroke: { color: BG, width: 3.5, join: 'round' },
      });
    this.lossStyles = { own: loss(ownerColor(me, me)), enemy: loss(ownerColor(me, other(me))) };
    this.layer.addChild(this.arrows);
    layers.layer.effects.addChild(this.layer);
  }

  private context(draw: (g: GraphicsContext) => GraphicsContext): GraphicsContext {
    const context = draw(new GraphicsContext());
    this.contexts.push(context);
    return context;
  }

  setLabelResolution(resolution: number): void {
    this.labelResolution = resolution;
    for (const mark of this.marks) {
      for (const text of mark.texts) {
        if (text.resolution !== resolution) text.resolution = resolution;
      }
    }
  }

  update(
    frame: RenderFrame,
    events: readonly EventMsg[],
    spots: ReadonlyMap<string, TokenSpot>,
    tickHz: number,
  ): void {
    this.readEvents(events);
    const reduced = reducedMotion();
    this.drawFights(frame.tick, tickHz, reduced);
    this.drawWaves(frame.tick, tickHz, reduced);
    this.drawBounces(frame, spots, tickHz, reduced);
  }

  destroy(): void {
    this.arrows.destroy();
    this.layer.destroy({ children: true });
    for (const context of this.contexts) context.destroy();
    this.lossStyles.own.destroy();
    this.lossStyles.enemy.destroy();
  }

  private readEvents(events: readonly EventMsg[]): void {
    if (events === this.eventsSeen && events.length === this.eventCount) return;
    this.eventsSeen = events;
    this.eventCount = events.length;
    this.fights = [];
    this.captures = [];
    this.bounces = [];
    for (const event of events) {
      const fight = fightInfo(event, this.map);
      if (fight !== null) this.fights.push(fight);
      const capture = captureInfo(event, this.map);
      if (capture !== null) this.captures.push(capture);
      const bounce = bounceInfo(event);
      if (bounce !== null) this.bounces.push(bounce);
    }
    // Forget arrows of bounces that left the event list.
    const live = new Set(this.bounces.map(bounceKey));
    for (const key of this.arrowAt.keys()) {
      if (!live.has(key)) this.arrowAt.delete(key);
    }
  }

  // --- Fight: flash and loss numbers ---------------------------------------------------------

  private drawFights(tick: number, tickHz: number, reduced: boolean): void {
    let used = 0;
    for (const fight of this.fights) {
      const t = effectProgress(tick - fight.event.tick, NUMBERS_MS, tickHz);
      if (t === null || used >= MAX_FIGHTS) continue;
      const mark = this.fightMark(used++);
      mark.view.position.set(fight.at.x, fight.at.y);
      const numbers = numbersLook(t, reduced);
      mark.texts.forEach((text, i) => {
        const losses = fight.losses[i === 0 ? this.me : other(this.me)];
        const label = `${MINUS}${String(losses)}`;
        if (text.text !== label) text.text = label;
        text.alpha = numbers.alpha;
        text.position.set(i === 0 ? -17 : 17, 20 - numbers.rise);
      });
      const flash = reduced ? null : effectProgress(tick - fight.event.tick, FLASH_MS, tickHz);
      mark.star.visible = flash !== null;
      if (flash !== null) {
        const look = flashLook(flash);
        mark.star.scale.set(look.scale);
        mark.star.alpha = look.alpha;
      }
      mark.view.visible = true;
    }
    for (let i = used; i < this.marks.length; i++) {
      const mark = this.marks[i];
      if (mark !== undefined) mark.view.visible = false;
    }
  }

  private fightMark(index: number): FightMark {
    let mark = this.marks[index];
    if (mark === undefined) {
      const view = this.layer.addChild(new Container({ label: 'fight' }));
      const star = view.addChild(new Graphics(this.star));
      const text = (style: TextStyle): Text =>
        view.addChild(new Text({ text: '', style, anchor: 0.5, resolution: this.labelResolution }));
      mark = { view, star, texts: [text(this.lossStyles.own), text(this.lossStyles.enemy)] };
      this.marks.push(mark);
    }
    return mark;
  }

  // --- Capture: the wave over the cell -------------------------------------------------------

  private drawWaves(tick: number, tickHz: number, reduced: boolean): void {
    let used = 0;
    if (!reduced) {
      for (const capture of this.captures) {
        const t = effectProgress(tick - capture.tick, WAVE_MS, tickHz);
        const cell = this.cells[capture.node];
        if (t === null || cell === undefined || used >= MAX_WAVES) continue;
        const g = this.wave(used++);
        const look = waveLook(t);
        const color = ownerColor(this.me, capture.player);
        const polygon = scaledPolygon(cell, capture.at, look.scale);
        g.clear();
        g.poly(polygon).fill({ color, alpha: WAVE_FILL_ALPHA * look.alpha });
        g.poly(polygon).stroke({ ...WAVE_STROKE, color, alpha: WAVE_STROKE.alpha * look.alpha });
        g.visible = true;
      }
    }
    for (let i = used; i < this.waves.length; i++) {
      const g = this.waves[i];
      if (g !== undefined) g.visible = false;
    }
  }

  private wave(index: number): Graphics {
    let g = this.waves[index];
    if (g === undefined) {
      g = this.layer.addChildAt(new Graphics(), 0);
      this.waves.push(g);
    }
    return g;
  }

  // --- Bounce: an arrow back along the road ---------------------------------------------------

  private drawBounces(
    frame: RenderFrame,
    spots: ReadonlyMap<string, TokenSpot>,
    tickHz: number,
    reduced: boolean,
  ): void {
    const g = this.arrows;
    g.clear();
    if (reduced) return;
    for (const bounce of this.bounces) {
      const t = effectProgress(frame.tick - bounce.tick, BOUNCE_MS, tickHz);
      if (t === null) continue;
      const key = bounceKey(bounce);
      if (!this.arrowAt.has(key)) {
        // Found once, on the first frame the group is on a road: the arrow stays where it began.
        const arrow = this.findArrow(bounce, frame, spots);
        if (arrow === undefined) continue;
        this.arrowAt.set(key, arrow);
      }
      const arrow = this.arrowAt.get(key);
      if (arrow === null || arrow === undefined) continue;
      const color = ownerColor(this.me, this.me);
      const alpha = 1 - t;
      for (const [a, b] of dashSegments(arrow.from, arrow.end, ORDER_GHOST_DASH, ORDER_GHOST_GAP)) {
        g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      }
      g.stroke({ width: 5.5, color: BG, alpha: 0.6 * alpha, cap: 'round' });
      for (const [a, b] of dashSegments(arrow.from, arrow.end, ORDER_GHOST_DASH, ORDER_GHOST_GAP)) {
        g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      }
      g.stroke({ width: 3, color, alpha, cap: 'round' });
      const [tip, left, right] = arrow.head;
      g.poly([tip.x, tip.y, left.x, left.y, right.x, right.y])
        .fill({ color, alpha })
        .stroke({ width: 1.5, color: BG, alpha });
    }
  }

  /** `undefined`: the group is not on a road (yet); `null`: no arrow can be made. */
  private findArrow(
    bounce: BounceInfo,
    frame: RenderFrame,
    spots: ReadonlyMap<string, TokenSpot>,
  ): BounceArrow | undefined {
    const item = frame.groups.find((entry) => entry.group.id === bounce.group);
    const spot = spots.get(bounce.group);
    const location = item?.location;
    if (location?.kind !== 'edge' || spot === undefined) return undefined;
    // The bounce goes back to the node the group left from.
    const home = nodePoint(this.map, location.from_node);
    if (home === undefined || edgeEnds(this.map, location.edge) === undefined) return null;
    return bounceArrow(spot, home, BOUNCE_LENGTH, 10);
  }
}

function other(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

function bounceKey(bounce: BounceInfo): string {
  return `${String(bounce.tick)}:${bounce.group}`;
}
