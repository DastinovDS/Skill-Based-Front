import { Container, Graphics, GraphicsContext, Text, TextStyle } from 'pixi.js';
import { t } from '../i18n/index.ts';
import type { RenderFrame } from '../net/interpolate.ts';
import type { EventMsg, FightRoundView, MapFile, PlayerId } from '../protocol.gen.ts';
import {
  layoutArenas,
  type ArenaSlot,
  type ArenaSpot,
  type Obstacle,
  type Rect,
} from './arenaLayout.ts';
import { ringRadius } from './cityLayout.ts';
import { numbersLook } from './effectsLayout.ts';
import {
  CAPTION_RISE,
  CHIP,
  END_SHARE,
  LOSS_POP_SHARE,
  PLATE,
  arenaCenter,
  arenaSides,
  changedChips,
  chipAt,
  chipHatch,
  chipHeight,
  chipPulse,
  chipsOf,
  exchangeArrow,
  exchangeLook,
  exchangeOf,
  fightFx,
  fightPlace,
  fightResult,
  lighten,
  roundEffect,
  roundProgress,
  type ArenaSides,
  type ChipState,
  type EndFx,
  type FightFx,
  type FightPlace,
  type FightResult,
  type RoundFx,
  type SideCount,
  type SideShots,
} from './fightFx.ts';
import { dashAlong } from './intentLayout.ts';
import { dashSegments } from './layout.ts';
import type { MapLayers } from './layers.ts';
import { drawModeGlyph } from './shapes.ts';
import type { Point } from './camera.ts';
import {
  BG,
  FIGHT_COLOR,
  GLYPH_COLOR,
  LOSS_FONT_SIZE,
  PLATE_FILL,
  WARN,
  ownerColor,
} from './style.ts';

const MAX_ARENAS = 8;
const MAX_POPS = 16;
const MAX_ENDS = 6;
/** Two sides, each at most `CHIP.max` chips. */
const CHIPS_PER_ARENA = 2 * CHIP.max;
/** The minus sign (U+2212) in front of a loss number. */
const MINUS = '−';
/** The tone of the discharged units and the hatching on their chips. */
const REST_LIGHTEN = 0.6;
/** The plate: its inner margin and the rows of the bottom strip (px from the middle). */
const STOCK_Y = 20;
const BAR_Y = PLATE.halfHeight - 9;
const BAR_HEIGHT = 3;
const BAR_WIDTH = 2 * PLATE.halfWidth - 24;
/** Where the "+N" and its small charged count sit on the strip (px from the middle line). */
const MORE_X = PLATE.halfWidth - 38;
const HIDDEN_CHARGED_X = PLATE.halfWidth - 22;
/** The label of the shots on an arrow: glyph, gap and padding (px). */
const LABEL = { glyph: 8, gap: 2, between: 5, padX: 5, height: 16, radius: 6 } as const;
/** A silent charge's badge sits at the lower right of its chip. */
const BADGE_OFFSET = { x: 8, y: 7 } as const;

/** What the view draws in one arena: a fight going on, or the end of one. */
type ArenaItem =
  | {
      readonly kind: 'live';
      readonly fight: FightData;
      readonly place: FightPlace;
      readonly sides: ArenaSides;
      readonly exchange: ReturnType<typeof exchangeOf>;
      readonly age: number;
    }
  | {
      readonly kind: 'end';
      readonly fx: EndFx;
      readonly place: FightPlace;
      readonly phase: number;
    };

type FightData = RenderFrame['base']['view']['fights'][number];

/** What an arena needs beyond its plate (px): arrows, labels and the caption; the end label. */
const ARROW_REACH = { top: 30, bottom: 28, caption: 28 } as const;
const END_REACH = { top: 32, bottom: 4 } as const;

/** A key of the place of a fight: the arena of a fight and its end share one. */
function usualSpot(place: FightPlace, scale: number): ArenaSpot {
  const centre = arenaCenter(place, scale);
  return { x: centre.x, y: centre.y, moved: 0 };
}

/** An arena that moved this far (px) from its usual spot gets a dotted line to its place. */
const TETHER_MIN = 8;

function placeKey(place: FightPlace): string {
  return `${String(place.node)}/${String(place.edge)}/${String(place.at.x)},${String(place.at.y)}`;
}

type Side = 'own' | 'enemy';
const SIDES: readonly Side[] = ['own', 'enemy'];

/** The arena over a fight: the plate with its chips, stocks and bar, the arrows of the last round. */
interface Arena {
  readonly view: Container;
  /**
   * The arrows, their labels and the caption: on a layer over every plate, at the same place and
   * scale as `view`, so the arrow of one fight is never hidden under the plate of another.
   */
  readonly top: Container;
  /** A dotted line down to a fight on a road, and a cross there. */
  readonly tether: Graphics;
  readonly plate: Graphics;
  /** A finished fight: the halves tinted by the owners, the winner's outlined. */
  readonly tint: Graphics;
  readonly chips: Graphics[];
  readonly badges: Graphics[];
  /** Per side: the diamond of the bonus stock, "×N" beside it. */
  readonly stockMark: Readonly<Record<Side, Graphics>>;
  readonly stockText: Readonly<Record<Side, Text>>;
  /** Per side: "+N" of the chips that do not fit, the dot and the number of the charged ones among them. */
  readonly more: Readonly<Record<Side, Text>>;
  readonly moreDot: Readonly<Record<Side, Graphics>>;
  readonly moreCharged: Readonly<Record<Side, Text>>;
  /** Per side, a finished fight: the losses of the whole fight. */
  readonly loss: Readonly<Record<Side, Text>>;
  readonly track: Graphics;
  readonly fill: Graphics;
  readonly arrows: Graphics;
  readonly labels: Readonly<Record<Side, ShotLabel>>;
  readonly caption: Caption;
}

/** The label of the shots of one side on its arrow: a disc and a number, a diamond and a number. */
interface ShotLabel {
  readonly view: Container;
  readonly pill: Graphics;
  readonly real: Text;
  readonly virtual: Text;
  /** What the pill was drawn for: the numbers and widths; it is redrawn only when they change. */
  key: string;
}

/** The caption "bonus attack" over the plate in a round with a virtual shot. */
interface Caption {
  readonly view: Container;
  readonly pill: Graphics;
  readonly text: Text;
  key: string;
}

/** A number that pops up after a round. */
interface Pop {
  readonly text: Text;
}

/** The result label of a finished fight: a glyph and a word in a dark pill. */
interface EndLabel {
  readonly view: Container;
  readonly pill: Graphics;
  readonly glyph: Graphics;
  readonly text: Text;
  result: FightResult | null;
}

/** What the view remembers of a fight from frame to frame: the chips of both sides, to see a reinforcement. */
interface Seen {
  totals: [number, number];
  /** Chips that joined since: from this index on, at this tick (`null`: none yet). */
  grew: [{ from: number; tick: number } | null, { from: number; tick: number } | null];
}

const flat = (points: readonly Point[]): number[] => points.flatMap((p) => [p.x, p.y]);

type Glyphs = Readonly<Record<FightResult, GraphicsContext>>;

/** Dictionary key of the word of a result. */
const RESULT_KEY = {
  captured: 'fight.captured',
  held: 'fight.held',
  bounced: 'fight.bounced',
} as const;

/** The three corners of a chip of `side`, tip down, centred on its box. */
function chipCorners(side: number): Point[] {
  const h = chipHeight(side);
  return [
    { x: -side / 2, y: -h / 2 },
    { x: side / 2, y: -h / 2 },
    { x: 0, y: h / 2 },
  ];
}

/**
 * The animation of fights (DEC-24, DEC-29, DEC-32; ui-style 9.9, 27, 29). Over every fight going
 * on (`view.fights`) floats the arena (A1 "chips"): a plate of two halves, own units on the left,
 * the enemy's on the right, a chip for every unit that was in the fight: a charged one filled, a
 * discharged one hollow and hatched, a dead one dashed (the form tells it, not the hue; the
 * enemy's chips have a second, dark outline). Up to eight chips a side, the rest is "+N" with its
 * exact number (and a small number of the charged ones hidden in it). A charged chip that does
 * not shoot (the plains, DEC-24 F2) has an amber crossed badge. Under each half is the stock of
 * bonus shots left of that side (a diamond and "×N", dashed and dim at 0), along the bottom a bar
 * fills until the next round. The last round of the fight (`FightView.last_round`) shows as an
 * exchange of blows over the plate: an arc arrow in the colour of the side that shot, with a label
 * of the shots (a disc: real shots, a diamond: virtual ones); a bonus shot draws a different arrow
 * (a glow, a dashed stem, a diamond head) and the caption "bonus attack" over the plate (the
 * source of the bonus is not told); a side that did not shoot has no arrow. A chip that changed in
 * the round, or joined with a reinforcement, pulses once. A fight without round data (an old
 * replay: #323) has chips and no arrows and no stock. Every `fight_round` event also pops up the
 * losses of the round. The end of a fight (`fight_ended`) shows its plate again with the losses of
 * the whole fight, the winner's half outlined, and a word with a glyph: captured, held or both
 * bounced. A fight on a road floats above its meeting point with a dotted line down to it.
 *
 * The arena is drawn in screen pixels (ui-style 27.2, item 7): every container is scaled by
 * `1 / cameraScale`, so chips do not shrink at 60% and the text is laid out at one unit a pixel.
 * Every duration is a share of a round (`roundTicks`), nothing is in fixed seconds. With "less
 * motion" no arrow grows, no chip pulses and no number rises.
 *
 * Everything is a function of the render tick (`frame.tick`, fractional between snapshots), so a
 * paused scene shows a fight in the state of that tick. The objects are pooled: nothing is created
 * per frame once the pools have grown. `destroy()` releases everything.
 */
export class FightView {
  private readonly layer = new Container({ label: 'fights' });
  private readonly arenaLayer = new Container({ label: 'arenas' });
  private readonly shotLayer = new Container({ label: 'fight-shots' });
  private readonly endLayer = new Container({ label: 'fight-results' });
  private readonly popLayer = new Container({ label: 'fight-losses' });
  private readonly arenas: Arena[] = [];
  private readonly pops: Pop[] = [];
  private readonly ends: EndLabel[] = [];
  private readonly contexts: GraphicsContext[] = [];
  private readonly glyphs: Glyphs;
  private readonly plateContext: GraphicsContext;
  private readonly barContext: GraphicsContext;
  private readonly badgeContext: GraphicsContext;
  private readonly chipContext: Readonly<
    Record<Side, Readonly<Record<ChipState, GraphicsContext>>>
  >;
  private readonly stockContext: Readonly<
    Record<Side, { readonly on: GraphicsContext; readonly off: GraphicsContext }>
  >;
  private readonly dotContext: Readonly<Record<Side, GraphicsContext>>;
  private readonly styles: {
    more: TextStyle;
    small: TextStyle;
    stock: TextStyle;
    shots: TextStyle;
    caption: TextStyle;
    own: TextStyle;
    enemy: TextStyle;
    /** The losses of a finished fight on the tinted halves of the plate: light, so it reads on both hues. */
    total: TextStyle;
    word: TextStyle;
  };
  private readonly seen = new Map<string, Seen>();
  private effects: FightFx[] = [];
  private eventsSeen: readonly EventMsg[] | null = null;
  private eventCount = -1;
  private cameraScale = 1;
  /** The canvas in scaled-world px (`setViewport`); `null` until the camera is known. */
  private view: Rect | null = null;
  /** Where the arena of each place stands now: the loss numbers and the end labels follow it. */
  private readonly spots = new Map<string, ArenaSpot>();

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    private readonly me: PlayerId,
    private resolution: number,
    /** Radius of a city now (`CityView.radiusOf`). */
    private readonly radiusOf: (node: number) => number,
  ) {
    const text = (fill: number, size: number, stroke = true): TextStyle =>
      new TextStyle({
        fontFamily: 'system-ui, sans-serif',
        fontSize: size,
        fontWeight: '700',
        fill,
        ...(stroke ? { stroke: { color: BG, width: 3.5, join: 'round' as const } } : {}),
      });
    const enemy: PlayerId = me === 0 ? 1 : 0;
    this.styles = {
      more: text(GLYPH_COLOR, 12),
      small: text(GLYPH_COLOR, 10),
      stock: text(GLYPH_COLOR, 12),
      shots: text(GLYPH_COLOR, 12, false),
      caption: text(GLYPH_COLOR, 12, false),
      own: text(ownerColor(me, me), LOSS_FONT_SIZE),
      enemy: text(ownerColor(me, enemy), LOSS_FONT_SIZE),
      total: text(GLYPH_COLOR, LOSS_FONT_SIZE + 3),
      word: new TextStyle({
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        fontWeight: '700',
        fill: GLYPH_COLOR,
      }),
    };
    this.glyphs = {
      captured: this.context((g) =>
        g
          .rect(-4.5, -5.5, 1.8, 11)
          .fill(GLYPH_COLOR)
          .poly([-2.7, -5.5, 5, -2.5, -2.7, 0.5])
          .fill(GLYPH_COLOR),
      ),
      held: this.context((g) => drawModeGlyph(g, 'defense')),
      bounced: this.context((g) =>
        g
          .poly([-5.5, -3, -1, -6.5, -1, -4, 5.5, -4, 5.5, -2, -1, -2, -1, 0.5])
          .fill(GLYPH_COLOR)
          .poly([5.5, 3, 1, 6.5, 1, 4, -5.5, 4, -5.5, 2, 1, 2, 1, -0.5])
          .fill(GLYPH_COLOR),
      ),
    };
    const { halfWidth: hw, halfHeight: hh } = PLATE;
    this.plateContext = this.context((g) => {
      g.roundRect(-hw, -hh, 2 * hw, 2 * hh + 2, 12)
        .fill({ color: PLATE_FILL, alpha: 0.96 })
        .stroke({ width: 1.6, color: FIGHT_COLOR, alpha: 0.85 });
      // The middle line between the halves.
      for (const [from, to] of dashSegments({ x: 0, y: -hh + 5 }, { x: 0, y: hh - 12 }, 3, 3)) {
        g.moveTo(from.x, from.y).lineTo(to.x, to.y);
      }
      return g.stroke({ width: 1, color: FIGHT_COLOR, alpha: 0.4 });
    });
    this.barContext = this.context((g) =>
      g.roundRect(0, 0, BAR_WIDTH, BAR_HEIGHT, BAR_HEIGHT / 2).fill(FIGHT_COLOR),
    );
    this.badgeContext = this.context((g) =>
      g
        .circle(0, 0, 4.6)
        .fill(PLATE_FILL)
        .stroke({ width: 1.5, color: WARN })
        .moveTo(-3, 3)
        .lineTo(3, -3)
        .stroke({ width: 1.5, color: WARN }),
    );
    const colorOf = (side: Side): number => ownerColor(me, side === 'own' ? me : enemy);
    this.chipContext = {
      own: this.chipContexts('own', colorOf('own')),
      enemy: this.chipContexts('enemy', colorOf('enemy')),
    };
    const diamond = (r: number): Point[] => [
      { x: 0, y: -r },
      { x: r, y: 0 },
      { x: 0, y: r },
      { x: -r, y: 0 },
    ];
    const stock = (side: Side): { on: GraphicsContext; off: GraphicsContext } => ({
      // Left: a filled diamond. Empty: the same diamond dashed and dim, so zero reads by its form.
      on: this.context((g) =>
        g
          .poly(flat(diamond(6)))
          .fill(lighten(colorOf(side), 0.1))
          .stroke({ width: 1.5, color: colorOf(side), join: 'round' }),
      ),
      off: this.context((g) => {
        const corners = diamond(6);
        corners.forEach((from, i) => {
          const to = corners[(i + 1) % corners.length];
          if (to === undefined) return;
          for (const [a, b] of dashSegments(from, to, 2, 2)) g.moveTo(a.x, a.y).lineTo(b.x, b.y);
        });
        return g.stroke({ width: 1.5, color: colorOf(side), alpha: 0.6, cap: 'round' });
      }),
    });
    this.stockContext = { own: stock('own'), enemy: stock('enemy') };
    const dot = (side: Side): GraphicsContext =>
      this.context((g) =>
        g.circle(0, 0, 2.6).fill(colorOf(side)).stroke({ width: 1, color: GLYPH_COLOR }),
      );
    this.dotContext = { own: dot('own'), enemy: dot('enemy') };
    // Bottom to top: arenas (each with its arrows and labels), results, the loss numbers.
    this.layer.addChild(this.arenaLayer, this.endLayer, this.shotLayer, this.popLayer);
    layers.layer.effects.addChild(this.layer);
  }

  /**
   * The three chip drawings of a side. Charged: filled, a light outline (the enemy's also a dark
   * inner one). Discharged: hollow, outlined in the side's colour, hatched. Dead: dashed and faint.
   */
  private chipContexts(side: Side, color: number): Readonly<Record<ChipState, GraphicsContext>> {
    const corners = chipCorners(CHIP.side);
    const inner = chipCorners(CHIP.side * 0.58);
    const light = lighten(color, REST_LIGHTEN);
    return {
      charged: this.context((g) => {
        g.poly(flat(corners)).fill(color).stroke({ width: 1.6, color: GLYPH_COLOR, join: 'round' });
        if (side === 'enemy') {
          g.poly(flat(inner)).stroke({ width: 1.1, color: BG, join: 'round' });
        }
        return g;
      }),
      empty: this.context((g) => {
        g.poly(flat(corners)).fill(PLATE_FILL);
        for (const [from, to] of chipHatch(CHIP.side, 3.5))
          g.moveTo(from.x, from.y).lineTo(to.x, to.y);
        g.stroke({ width: 1.2, color: light, alpha: 0.85 });
        g.poly(flat(corners)).stroke({ width: 1.8, color, join: 'round' });
        if (side === 'enemy') {
          g.poly(flat(inner)).stroke({ width: 1.1, color: BG, join: 'round' });
        }
        return g;
      }),
      killed: this.context((g) => {
        corners.forEach((from, i) => {
          const to = corners[(i + 1) % corners.length];
          if (to === undefined) return;
          for (const [a, b] of dashSegments(from, to, 2.5, 2.5))
            g.moveTo(a.x, a.y).lineTo(b.x, b.y);
        });
        return g.stroke({ width: 1.6, color, alpha: 0.6, cap: 'round' });
      }),
    };
  }

  private context(draw: (g: GraphicsContext) => GraphicsContext): GraphicsContext {
    const context = draw(new GraphicsContext());
    this.contexts.push(context);
    return context;
  }

  /** Camera scale (CSS px per world unit): the arena keeps its size on screen. */
  setCameraScale(scale: number): void {
    if (scale > 0) this.cameraScale = scale;
  }

  /**
   * The canvas as a rectangle in scaled-world px (the world times the camera scale, so the middle
   * of the canvas is `camera * scale`): the arenas stay inside it when they can.
   */
  setViewport(rect: Rect | null): void {
    this.view = rect;
  }

  /**
   * Texture pixels per text unit. The arena is drawn at one unit a CSS px, so this is the device
   * pixel ratio rounded up, not the zoom of the map.
   */
  setScreenResolution(resolution: number): void {
    this.resolution = resolution;
    const texts: Text[] = [
      ...this.arenas.flatMap((arena) => [
        ...SIDES.flatMap((side) => [
          arena.stockText[side],
          arena.more[side],
          arena.moreCharged[side],
          arena.loss[side],
          arena.labels[side].real,
          arena.labels[side].virtual,
        ]),
        arena.caption.text,
      ]),
      ...this.pops.map((pop) => pop.text),
      ...this.ends.map((end) => end.text),
    ];
    for (const text of texts) {
      if (text.resolution !== resolution) text.resolution = resolution;
    }
  }

  update(
    frame: RenderFrame,
    events: readonly EventMsg[],
    roundTicks: number,
    reduced: boolean,
  ): void {
    this.readEvents(events);
    const k = 1 / this.cameraScale;
    const live = new Set<string>();
    // What to draw, the fights going on first: they have the best places on the screen.
    const items: ArenaItem[] = [];
    for (const fight of frame.base.view.fights) {
      if (items.length >= MAX_ARENAS) break;
      const place = fightPlace(this.map, fight.node, fight.edge, fight.point, this.radiusOf);
      if (place === undefined) continue;
      live.add(fight.id);
      const sides = arenaSides(fight, frame.groups, this.me);
      const exchange = exchangeOf(fight.last_round, this.me);
      const age = fight.last_round === null ? 0 : frame.tick - fight.last_round.tick;
      items.push({ kind: 'live', fight, place, sides, exchange, age });
    }
    for (const fx of this.effects) {
      if (fx.kind !== 'end') continue;
      const phase = roundEffect(frame.tick - fx.tick, END_SHARE, roundTicks);
      if (phase === null || items.length >= MAX_ARENAS) continue;
      items.push({ kind: 'end', fx, place: fx.place, phase });
    }
    const spots = this.layout(items);
    this.spots.clear();
    let ends = 0;
    items.forEach((item, index) => {
      const arena = this.arena(index);
      const spot = spots[index];
      if (spot === undefined) return;
      this.placeArena(arena, item.place, spot, k);
      if (!this.spots.has(placeKey(item.place))) this.spots.set(placeKey(item.place), spot);
      if (item.kind === 'live') {
        const { fight, sides, exchange, age } = item;
        this.drawFight(arena, {
          sides,
          pulses: this.pulses(
            fight.id,
            sides,
            fight.last_round,
            age,
            frame.tick,
            roundTicks,
            reduced,
          ),
          progress: roundProgress(fight.next_round_tick, frame.tick, roundTicks),
          exchange,
          age,
          roundTicks,
          reduced,
        });
      } else {
        this.drawEnded(arena, item.fx, item.phase);
        if (!item.fx.legacy && ends < MAX_ENDS) {
          this.drawEnd(this.endLabel(ends++), item.fx, item.phase, spot, k);
        }
      }
    });
    for (const id of this.seen.keys()) {
      if (!live.has(id)) this.seen.delete(id);
    }
    this.hide(this.arenas, items.length);
    for (let i = items.length; i < this.arenas.length; i++) {
      const arena = this.arenas[i];
      if (arena !== undefined) arena.top.visible = false;
    }
    for (let i = ends; i < this.ends.length; i++) {
      const label = this.ends[i];
      if (label !== undefined) label.view.visible = false;
    }
    this.drawPops(frame.tick, roundTicks, reduced, k);
  }

  /**
   * Where each arena stands (#360): over its place when that spot is free, else at the free spot
   * nearest to it, clear of the other plates, of the cities and of the edge of the screen.
   */
  private layout(items: readonly ArenaItem[]): ArenaSpot[] {
    if (items.length === 0) return [];
    const slots = items.map((item): ArenaSlot => {
      const base = { at: item.place.at, ring: item.place.ring, road: item.place.node === null };
      if (item.kind === 'end') return { ...base, top: END_REACH.top, bottom: END_REACH.bottom };
      // The arrows over (own) and under (the enemy's) the plate and the caption of a bonus shot.
      const round = item.fight.last_round;
      if (round === null) return { ...base, top: 4, bottom: 4 };
      const bonus = round.virtual.some((n) => n > 0);
      return {
        ...base,
        top: ARROW_REACH.top + (bonus ? ARROW_REACH.caption : 0),
        bottom: ARROW_REACH.bottom,
      };
    });
    const cities: Obstacle[] = this.map.nodes.map((node) => ({
      at: { x: node.x, y: node.y },
      ring: ringRadius(this.radiusOf(node.id)),
    }));
    return layoutArenas(slots, cities, this.cameraScale, this.view);
  }

  destroy(): void {
    this.layer.destroy({ children: true });
    for (const context of this.contexts) context.destroy();
    for (const style of Object.values(this.styles)) style.destroy();
  }

  private readEvents(events: readonly EventMsg[]): void {
    if (events === this.eventsSeen && events.length === this.eventCount) return;
    this.eventsSeen = events;
    this.eventCount = events.length;
    this.effects = [];
    for (const event of events) {
      const fx = fightFx(event, this.map, this.radiusOf);
      if (fx !== null) this.effects.push(fx);
    }
  }

  private hide(pool: readonly { view: Container }[], used: number): void {
    for (let i = used; i < pool.length; i++) {
      const item = pool[i];
      if (item !== undefined) item.view.visible = false;
    }
  }

  /**
   * The world position of a point `dx`, `dy` px from the middle of the arena of `place` (where it
   * stands now: the usual spot over the place if no arena is there).
   */
  private around(place: FightPlace, dx: number, dy: number, k: number): Point {
    const spot = this.spots.get(placeKey(place)) ?? usualSpot(place, this.cameraScale);
    return { x: spot.x + dx * k, y: spot.y + dy * k };
  }

  // --- Arena -------------------------------------------------------------------------------------

  private text(
    parent: Container,
    style: TextStyle,
    anchor: number | { x: number; y: number },
  ): Text {
    return parent.addChild(
      new Text({ text: '', style, anchor, resolution: this.resolution, visible: false }),
    );
  }

  private arena(index: number): Arena {
    let arena = this.arenas[index];
    if (arena === undefined) {
      const view = this.arenaLayer.addChild(new Container({ label: 'arena' }));
      const tether = view.addChild(new Graphics());
      const plate = view.addChild(new Graphics(this.plateContext));
      const tint = view.addChild(new Graphics());
      const chips = Array.from({ length: CHIPS_PER_ARENA }, () => {
        const chip = view.addChild(new Graphics(this.chipContext.own.charged));
        chip.visible = false;
        return chip;
      });
      const badges: Graphics[] = [];
      const pair = <T>(make: (side: Side) => T): Readonly<Record<Side, T>> => ({
        own: make('own'),
        enemy: make('enemy'),
      });
      const stockMark = pair((side) => view.addChild(new Graphics(this.stockContext[side].on)));
      const stockText = pair(() => this.text(view, this.styles.stock, 0.5));
      const more = pair(() => this.text(view, this.styles.more, 0.5));
      const moreDot = pair((side) => view.addChild(new Graphics(this.dotContext[side])));
      const moreCharged = pair(() => this.text(view, this.styles.small, { x: 0, y: 0.5 }));
      const loss = pair(() => this.text(view, this.styles.total, 0.5));
      const track = view.addChild(new Graphics(this.barContext));
      track.alpha = 0.18;
      const fill = view.addChild(new Graphics(this.barContext));
      const top = this.shotLayer.addChild(new Container({ label: 'arena-shots' }));
      const arrows = top.addChild(new Graphics());
      const labels = pair(() => this.shotLabel(top));
      const caption = this.captionLabel(top);
      for (const g of [...Object.values(stockMark), ...Object.values(moreDot), tint]) {
        g.visible = false;
      }
      arena = {
        view,
        top,
        tether,
        plate,
        tint,
        chips,
        badges,
        stockMark,
        stockText,
        more,
        moreDot,
        moreCharged,
        loss,
        track,
        fill,
        arrows,
        labels,
        caption,
      };
      this.arenas.push(arena);
    }
    return arena;
  }

  private placeArena(arena: Arena, place: FightPlace, spot: ArenaSpot, k: number): void {
    for (const part of [arena.view, arena.top]) {
      part.position.set(spot.x, spot.y);
      part.scale.set(k);
      part.alpha = 1;
      part.visible = true;
    }
    // A dotted line to the true place of a fight on a road (with a cross there), or of a fight in
    // a city whose arena had to move off its usual spot.
    const g = arena.tether.clear();
    const road = place.node === null;
    if (!road && spot.moved < TETHER_MIN) return;
    const dx = (place.at.x - spot.x) / k;
    const dy = (place.at.y - spot.y) / k;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) return;
    const ux = dx / dist;
    const uy = dy / dist;
    // From the edge of the plate to the cross, or to the ring of the city.
    const out = Math.min(
      ux === 0 ? Infinity : PLATE.halfWidth / Math.abs(ux),
      uy === 0 ? Infinity : (PLATE.halfHeight + 2) / Math.abs(uy),
    );
    const from = out + 2;
    const to = road ? dist - 5 : dist - place.ring / k - 4;
    for (let d = from; d < to; d += 7) {
      const end = Math.min(to, d + 3.5);
      g.moveTo(ux * d, uy * d).lineTo(ux * end, uy * end);
    }
    g.stroke({ width: 1.5, color: FIGHT_COLOR, alpha: 0.8 });
    if (road) {
      g.moveTo(dx - 4, dy - 4)
        .lineTo(dx + 4, dy + 4)
        .moveTo(dx + 4, dy - 4)
        .lineTo(dx - 4, dy + 4)
        .stroke({ width: 2, color: FIGHT_COLOR, cap: 'round' });
    }
  }

  /** Which chips pulse now: the ones that changed in the last round and the ones that joined. */
  private pulses(
    id: string,
    sides: ArenaSides,
    round: FightRoundView | null,
    age: number,
    tick: number,
    roundTicks: number,
    reduced: boolean,
  ): Record<Side, ReadonlyMap<number, number>> {
    const totals: [number, number] = [
      sides.own.units + sides.own.losses,
      sides.enemy.units + sides.enemy.losses,
    ];
    const seen = this.seen.get(id);
    if (seen === undefined) {
      this.seen.set(id, { totals, grew: [null, null] });
    } else {
      for (const i of [0, 1] as const) {
        const before = seen.totals[i];
        const now = totals[i];
        if (now > before) seen.grew[i] = { from: before, tick };
        else if (now < before) seen.grew[i] = null;
        seen.totals[i] = now;
      }
    }
    const grew = this.seen.get(id)?.grew ?? [null, null];
    const result: Record<Side, Map<number, number>> = { own: new Map(), enemy: new Map() };
    if (reduced) return result;
    SIDES.forEach((side, i) => {
      const pulse = chipPulse(age, roundTicks, false);
      if (round !== null && pulse !== 1) {
        const player: PlayerId = side === 'own' ? this.me : this.me === 0 ? 1 : 0;
        const changed = changedChips(sides[side], {
          spent: round.spent[player],
          losses: round.losses[player],
        });
        for (const index of changed) result[side].set(index, pulse);
      }
      const joined = grew[i] ?? null;
      if (joined !== null) {
        const swell = chipPulse(tick - joined.tick, roundTicks, false);
        if (swell !== 1) {
          for (let index = joined.from; index < (totals[i] ?? 0); index++) {
            result[side].set(index, swell);
          }
        }
      }
    });
    return result;
  }

  /** The arena of a fight going on: chips, stocks, the bar to the next round, the last exchange. */
  private drawFight(
    arena: Arena,
    look: {
      sides: ArenaSides;
      pulses: Record<Side, ReadonlyMap<number, number>>;
      progress: number;
      exchange: ReturnType<typeof exchangeOf>;
      age: number;
      roundTicks: number;
      reduced: boolean;
    },
  ): void {
    arena.plate.visible = true;
    arena.tint.visible = false;
    let badges = 0;
    let used = 0;
    for (const side of SIDES) {
      const counts = look.sides[side];
      const own = side === 'own';
      const chips = chipsOf(counts);
      chips.shown.forEach((state, index) => {
        const chip = arena.chips[used++];
        if (chip === undefined) return;
        const at = chipAt(index, chips.shown.length, own);
        chip.context = this.chipContext[side][state];
        chip.label = `chip:${state}`;
        chip.position.set(at.x, at.y);
        chip.scale.set(look.pulses[side].get(index) ?? 1);
        chip.visible = true;
        if (chips.silent.includes(index)) {
          const badge = this.badge(arena, badges++);
          badge.position.set(at.x + BADGE_OFFSET.x, at.y + BADGE_OFFSET.y);
          badge.visible = true;
        }
      });
      this.drawStrip(arena, side, counts, chips.hidden, chips.hiddenCharged, own);
    }
    for (let i = used; i < arena.chips.length; i++) {
      const chip = arena.chips[i];
      if (chip !== undefined) chip.visible = false;
    }
    for (let i = badges; i < arena.badges.length; i++) {
      const badge = arena.badges[i];
      if (badge !== undefined) badge.visible = false;
    }
    for (const side of SIDES) arena.loss[side].visible = false;
    const x0 = -BAR_WIDTH / 2;
    arena.track.position.set(x0, BAR_Y);
    arena.track.visible = true;
    arena.fill.position.set(x0, BAR_Y);
    arena.fill.scale.x = Math.max(0.0001, look.progress);
    arena.fill.visible = look.progress > 0;
    this.drawExchange(arena, look.exchange, look.age, look.roundTicks, look.reduced);
  }

  /** The strip under the chips of a side: the bonus stock, "+N", the charged ones among the hidden. */
  private drawStrip(
    arena: Arena,
    side: Side,
    counts: SideCount,
    hidden: number,
    hiddenCharged: number,
    own: boolean,
  ): void {
    const sign = own ? -1 : 1;
    const mark = arena.stockMark[side];
    const stock = counts.bonus;
    mark.context = stock > 0 ? this.stockContext[side].on : this.stockContext[side].off;
    mark.position.set(sign * 22, STOCK_Y);
    mark.visible = true;
    const text = arena.stockText[side];
    const stockLabel = `×${String(stock)}`;
    if (text.text !== stockLabel) text.text = stockLabel;
    text.alpha = stock > 0 ? 1 : 0.5;
    text.position.set(sign * 37, STOCK_Y);
    text.visible = true;
    const more = arena.more[side];
    more.visible = hidden > 0;
    if (hidden > 0) {
      const label = `+${String(hidden)}`;
      if (more.text !== label) more.text = label;
      more.position.set(sign * MORE_X, STOCK_Y);
    }
    const dot = arena.moreDot[side];
    const charged = arena.moreCharged[side];
    dot.visible = hiddenCharged > 0;
    charged.visible = hiddenCharged > 0;
    if (hiddenCharged > 0) {
      const label = String(hiddenCharged);
      if (charged.text !== label) charged.text = label;
      dot.position.set(sign * HIDDEN_CHARGED_X, STOCK_Y + 1);
      // The number sits on the outer side of the dot, aligned away from it.
      charged.anchor.set(own ? 1 : 0, 0.5);
      charged.position.set(sign * (HIDDEN_CHARGED_X + 5), STOCK_Y + 1);
    }
  }

  private badge(arena: Arena, index: number): Graphics {
    let badge = arena.badges[index];
    if (badge === undefined) {
      badge = arena.view.addChildAt(
        new Graphics(this.badgeContext),
        arena.view.getChildIndex(arena.track),
      );
      badge.label = 'mute-badge';
      arena.badges.push(badge);
    }
    return badge;
  }

  /** A finished fight: the plate with the halves tinted, the losses of the whole fight, the winner outlined. */
  private drawEnded(arena: Arena, fx: EndFx, phase: number): void {
    arena.view.alpha = numbersLook(phase, true).alpha;
    arena.plate.visible = true;
    for (const chip of arena.chips) chip.visible = false;
    for (const badge of arena.badges) badge.visible = false;
    for (const side of SIDES) {
      arena.stockMark[side].visible = false;
      arena.stockText[side].visible = false;
      arena.more[side].visible = false;
      arena.moreDot[side].visible = false;
      arena.moreCharged[side].visible = false;
    }
    arena.track.visible = false;
    arena.fill.visible = false;
    arena.arrows.clear();
    arena.top.visible = false;
    const winner = fx.winner === null ? null : fx.winner === this.me ? 'own' : 'enemy';
    const g = arena.tint.clear();
    const { halfWidth: hw, halfHeight: hh } = PLATE;
    for (const side of SIDES) {
      const own = side === 'own';
      const lost = winner !== null && winner !== side;
      g.roundRect(own ? -hw + 3 : 3, -hh + 3, hw - 6, 2 * hh - 4, 9).fill({
        color: ownerColor(this.me, own ? this.me : this.me === 0 ? 1 : 0),
        alpha: lost ? 0.12 : 0.32,
      });
    }
    if (winner !== null) {
      // The winner's half is outlined thick: the side is told by its place, not by the hue.
      g.roundRect(winner === 'own' ? -hw + 1 : 1, -hh + 1, hw - 2, 2 * hh, 11).stroke({
        width: 3,
        color: FIGHT_COLOR,
      });
    }
    arena.tint.visible = true;
    const own = this.me;
    const enemy: PlayerId = this.me === 0 ? 1 : 0;
    for (const [side, player] of [
      ['own', own],
      ['enemy', enemy],
    ] as const) {
      const text = arena.loss[side];
      const label = `${MINUS}${String(fx.losses[player])}`;
      if (text.text !== label) text.text = label;
      text.position.set((side === 'own' ? -1 : 1) * PLATE.halfWidth * 0.5, -2);
      text.visible = true;
    }
  }

  // --- The exchange of blows ---------------------------------------------------------------------

  /**
   * The arrows of the last round of a fight over the plate: own over the top, the enemy's under the
   * bottom, each only if that side shot; a bonus shot draws the other arrow and the caption.
   */
  private drawExchange(
    arena: Arena,
    exchange: ReturnType<typeof exchangeOf>,
    age: number,
    roundTicks: number,
    reduced: boolean,
  ): void {
    const look = exchangeLook(age, roundTicks, reduced);
    const g = arena.arrows.clear();
    for (const side of SIDES) arena.labels[side].view.visible = false;
    arena.caption.view.visible = false;
    arena.arrows.label = 'arrows:';
    if (look.alpha <= 0 || look.grow <= 0) return;
    const enemy: PlayerId = this.me === 0 ? 1 : 0;
    let bonus = false;
    const kinds: string[] = [];
    for (const side of SIDES) {
      const own = side === 'own';
      const shots = exchange[side];
      if (shots === null) continue;
      const color = ownerColor(this.me, own ? this.me : enemy);
      // A round of bonus shots only is drawn with the bonus arrow; a mixed one with the plain arrow
      // and the counts of its label.
      const virtual = shots.virtual > 0 && shots.real === 0;
      if (shots.virtual > 0) bonus = true;
      kinds.push(`${side}-${virtual ? 'bonus' : 'plain'}`);
      const arrow = exchangeArrow(own, look.grow);
      const [first, ...rest] = arrow.line;
      if (first === undefined) continue;
      const trace = (): void => {
        g.moveTo(first.x, first.y);
        for (const p of rest) g.lineTo(p.x, p.y);
      };
      trace();
      g.stroke({ width: 6.5, color: BG, alpha: 0.6 * look.alpha, cap: 'round', join: 'round' });
      if (virtual) this.drawBonusArrow(g, arrow, color, look.alpha);
      else this.drawPlainArrow(g, arrow, color, look.alpha, trace);
      if (look.grow >= 1 || reduced) {
        this.drawLabel(arena.labels[side], arrow.label, shots, color, look.alpha);
      }
    }
    // What the arrows are, by side: the label is how the tests (and the dev tools) tell them apart.
    arena.arrows.label = `arrows:${kinds.join(',')}`;
    if (bonus && (look.grow >= 1 || reduced)) this.drawCaption(arena.caption, look.alpha);
  }

  private drawPlainArrow(
    g: Graphics,
    arrow: ReturnType<typeof exchangeArrow>,
    color: number,
    alpha: number,
    trace: () => void,
  ): void {
    trace();
    g.stroke({ width: 3.5, color, alpha, cap: 'round', join: 'round' });
    if (arrow.head !== null) {
      g.poly(flat(arrow.head))
        .fill({ color, alpha })
        .stroke({ width: 1.5, color: BG, alpha: 0.7 * alpha, join: 'round' });
    }
  }

  /**
   * The arrow of a bonus (virtual) shot (A1): a wide glow, a dashed stem and a diamond for a head,
   * so its silhouette differs from the plain arrow's without the hue.
   */
  private drawBonusArrow(
    g: Graphics,
    arrow: ReturnType<typeof exchangeArrow>,
    color: number,
    alpha: number,
  ): void {
    const [first, ...rest] = arrow.line;
    if (first === undefined) return;
    g.moveTo(first.x, first.y);
    for (const p of rest) g.lineTo(p.x, p.y);
    g.stroke({ width: 7, color, alpha: 0.35 * alpha, cap: 'round', join: 'round' });
    for (const dash of dashAlong(arrow.line, 4, 3, 0)) {
      const [from, ...tail] = dash;
      if (from === undefined) continue;
      g.moveTo(from.x, from.y);
      for (const p of tail) g.lineTo(p.x, p.y);
    }
    g.stroke({ width: 2, color: GLYPH_COLOR, alpha, cap: 'round' });
    if (arrow.head !== null) {
      const { tip, direction: d } = arrow;
      const c = { x: tip.x - d.x * 6, y: tip.y - d.y * 6 };
      g.poly([
        tip.x,
        tip.y,
        c.x - d.y * 6,
        c.y + d.x * 6,
        c.x - d.x * 6,
        c.y - d.y * 6,
        c.x + d.y * 6,
        c.y - d.x * 6,
      ])
        .fill({ color: BG, alpha })
        .stroke({ width: 2.2, color, alpha, join: 'round' });
    }
  }

  private shotLabel(parent: Container): ShotLabel {
    const view = parent.addChild(new Container({ label: 'fight-shot-label', visible: false }));
    const pill = view.addChild(new Graphics());
    return {
      view,
      pill,
      real: this.text(view, this.styles.shots, { x: 0, y: 0.5 }),
      virtual: this.text(view, this.styles.shots, { x: 0, y: 0.5 }),
      key: '',
    };
  }

  /**
   * The label of the shots of a side, centred on `at`: a disc and the number of real shots, a
   * diamond and the number of virtual ones (the shape tells which is which, not the hue), in a
   * dark pill outlined in the colour of the shooter. A kind with no shot is left out.
   */
  private drawLabel(
    label: ShotLabel,
    at: Point,
    shots: SideShots,
    color: number,
    alpha: number,
  ): void {
    const parts = [
      { glyph: 'disc', text: label.real, count: shots.real },
      { glyph: 'diamond', text: label.virtual, count: shots.virtual },
    ] as const;
    const shown = parts.filter((part) => part.count > 0);
    for (const part of parts) {
      const value = String(part.count);
      if (part.count > 0 && part.text.text !== value) part.text.text = value;
      part.text.visible = part.count > 0;
    }
    const widths = shown.map((part) => LABEL.glyph + LABEL.gap + part.text.width);
    const total =
      widths.reduce((sum, w) => sum + w, 0) +
      LABEL.between * Math.max(0, shown.length - 1) +
      2 * LABEL.padX;
    const key = `${shown.map((part) => `${part.glyph}${String(part.count)}`).join(',')}|${String(
      total,
    )}|${String(color)}`;
    if (label.key !== key) {
      label.key = key;
      const g = label.pill.clear();
      g.roundRect(-total / 2, -LABEL.height / 2, total, LABEL.height, LABEL.radius)
        .fill({ color: PLATE_FILL, alpha: 0.95 })
        .stroke({ width: 1.8, color });
      let x = -total / 2 + LABEL.padX;
      shown.forEach((part, i) => {
        const cx = x + LABEL.glyph / 2;
        if (part.glyph === 'disc') {
          g.circle(cx, 0, 3.3).fill(GLYPH_COLOR);
        } else {
          g.poly([cx - 4, 0, cx, -4, cx + 4, 0, cx, 4]).stroke({
            width: 1.6,
            color: GLYPH_COLOR,
            join: 'round',
          });
        }
        part.text.position.set(x + LABEL.glyph + LABEL.gap, 0);
        x += (widths[i] ?? 0) + LABEL.between;
      });
    }
    label.view.position.set(at.x, at.y);
    label.view.alpha = alpha;
    label.view.visible = true;
  }

  private captionLabel(parent: Container): Caption {
    const view = parent.addChild(new Container({ label: 'fight-bonus-caption', visible: false }));
    const pill = view.addChild(new Graphics());
    return { view, pill, text: this.text(view, this.styles.caption, { x: 0, y: 0.5 }), key: '' };
  }

  /** "◇ bonus attack" over the plate: a diamond and the words, in a dark pill. */
  private drawCaption(caption: Caption, alpha: number): void {
    const word = t('fight.bonusAttack');
    caption.text.visible = true;
    if (caption.text.text !== word) caption.text.text = word;
    const width = 8 + 8 + 5 + caption.text.width + 10;
    const key = `${word}|${String(width)}`;
    if (caption.key !== key) {
      caption.key = key;
      const left = -width / 2;
      caption.pill
        .clear()
        .roundRect(left, -9.5, width, 19, 9.5)
        .fill({ color: PLATE_FILL, alpha: 0.96 })
        .stroke({ width: 1.6, color: FIGHT_COLOR })
        .poly([left + 12, -4.5, left + 16.5, 0, left + 12, 4.5, left + 7.5, 0])
        .stroke({ width: 1.6, color: GLYPH_COLOR, join: 'round' });
      caption.text.position.set(left + 21, 0);
    }
    caption.view.position.set(0, -PLATE.halfHeight - CAPTION_RISE);
    caption.view.alpha = alpha;
    caption.view.visible = true;
  }

  // --- The end of a fight ------------------------------------------------------------------------

  private endLabel(index: number): EndLabel {
    let label = this.ends[index];
    if (label === undefined) {
      const view = this.endLayer.addChild(new Container({ label: 'fight-result' }));
      const pill = view.addChild(new Graphics());
      const glyph = view.addChild(new Graphics(this.glyphs.held));
      const text = this.text(view, this.styles.word, { x: 0, y: 0.5 });
      label = { view, pill, glyph, text, result: null };
      this.ends.push(label);
    }
    return label;
  }

  private drawEnd(label: EndLabel, fx: EndFx, phase: number, spot: ArenaSpot, k: number): void {
    const result = fightResult(fx);
    const word = t(RESULT_KEY[result]);
    label.text.visible = true;
    if (label.result !== result || label.text.text !== word) {
      label.result = result;
      label.glyph.context = this.glyphs[result];
      label.text.text = word;
      const width = 24 + label.text.width + 8;
      label.pill.clear();
      label.pill
        .roundRect(-12, -10, width, 20, 6)
        .fill({ color: PLATE_FILL, alpha: 0.92 })
        .stroke({ width: 1.5, color: FIGHT_COLOR, alpha: 0.9 });
      label.glyph.position.set(0, 0);
      label.text.position.set(12, 0);
    }
    // The label sits above the plate, centred on it, and fades out in the last third.
    const width = 24 + label.text.width + 8;
    const at = { x: spot.x + (-width / 2 + 12) * k, y: spot.y + (-PLATE.halfHeight - 20) * k };
    label.view.position.set(at.x, at.y);
    label.view.scale.set(k);
    label.view.alpha = numbersLook(phase, true).alpha;
    label.view.visible = true;
  }

  // --- Losses of a round --------------------------------------------------------------------------

  private drawPops(tick: number, roundTicks: number, reduced: boolean, k: number): void {
    let pops = 0;
    for (const fx of this.effects) {
      if (fx.kind !== 'round') continue;
      const pop = roundEffect(tick - fx.tick, LOSS_POP_SHARE, roundTicks);
      if (pop !== null) pops = this.placePops(fx, pop, pops, reduced, k);
    }
    for (let i = pops; i < this.pops.length; i++) {
      const pop = this.pops[i];
      if (pop !== undefined) pop.text.visible = false;
    }
  }

  /** The losses of a round pop up beside the half of the side that lost them. */
  private placePops(fx: RoundFx, phase: number, used: number, reduced: boolean, k: number): number {
    const enemy: PlayerId = this.me === 0 ? 1 : 0;
    const look = numbersLook(phase, reduced);
    let next = used;
    ([this.me, enemy] as const).forEach((player, side) => {
      const losses = fx.losses[player];
      if (losses <= 0 || next >= MAX_POPS) return;
      const pop = this.pop(next++, side === 0 ? 'own' : 'enemy');
      const label = `${MINUS}${String(losses)}`;
      if (pop.text.text !== label) pop.text.text = label;
      pop.text.alpha = look.alpha;
      const at = this.around(
        fx.place,
        (side === 0 ? -1 : 1) * (PLATE.halfWidth + 18),
        -look.rise,
        k,
      );
      pop.text.position.set(at.x, at.y);
      pop.text.scale.set(k);
      pop.text.visible = true;
    });
    return next;
  }

  private pop(index: number, side: Side): Pop {
    let pop = this.pops[index];
    if (pop === undefined) {
      const text = this.text(this.popLayer, this.styles[side], 0.5);
      pop = { text };
      this.pops.push(pop);
    }
    // A pool slot serves either side from frame to frame.
    if (pop.text.style !== this.styles[side]) pop.text.style = this.styles[side];
    return pop;
  }
}
