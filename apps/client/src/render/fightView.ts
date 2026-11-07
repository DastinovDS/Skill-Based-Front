import { Container, Graphics, GraphicsContext, Text, TextStyle } from 'pixi.js';
import type { BakedSprite, SpriteCache } from './bake.ts';
import {
  arenaPlateSpec,
  chevronBadgeSpec,
  chipSpec,
  helmetChipSpec,
  selfShotSpec,
} from './bakedShapes.ts';
import { unitStyle } from '../units/unitStyle.ts';
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
  CHIP,
  END_SHARE,
  PLATE,
  SELF_SHOT_SHARE,
  arenaSides,
  changedChips,
  chipAt,
  chipPulse,
  chipsOf,
  fightFx,
  fightPlace,
  fightResult,
  pinnedPenalty,
  roundEffect,
  roundProgress,
  type ArenaSides,
  type ChipBadge,
  type EndFx,
  type FightFx,
  type FightPlace,
  type FightResult,
  type RoundFx,
} from './fightFx.ts';
import { HIT_SHARE, NUMBER_SHARE, sinceShare, type Contacts } from './fightImpact.ts';
import type { MapLayers } from './layers.ts';
import { drawModeGlyph } from './shapes.ts';
import type { Point } from './camera.ts';
import { stackBadges, type BadgeMark } from './badgeLayout.ts';
import {
  BADGE,
  BG,
  FIGHT_COLOR,
  GLYPH_COLOR,
  LOSS_FONT_SIZE,
  PLATE_FILL,
  ownerColor,
} from './style.ts';

const MAX_ARENAS = 8;
const MAX_POPS = 16;
const MAX_ENDS = 6;
/** Two sides, each at most `CHIP.max` chips. */
const CHIPS_PER_ARENA = 2 * CHIP.max;
/** The minus sign (U+2212) in front of a loss number. */
const MINUS = '−';
/** Where "-N" stands from the middle of the token that lost the units (world units at 100%). */
const POP_OFFSET = { x: 17, y: 18 } as const;
/** The plate: the row of "+N" under the chips and the bar along the bottom (px from the middle). */
const STRIP_Y = 16;
const BAR_Y = PLATE.halfHeight - 9;
const BAR_HEIGHT = 3;
const BAR_WIDTH = 2 * PLATE.halfWidth - 24;
/** Where the "+N" and its small charged count sit on the strip (px from the middle line). */
const MORE_X = PLATE.halfWidth - 38;
const HIDDEN_CHARGED_X = PLATE.halfWidth - 22;
/** The badges of a chip (#791) sit at its top right corner (px from its middle). */
const CHIP_BADGE = { x: 7.5, y: -6.5 } as const;

/** What the view draws in one arena: a fight going on, or the end of one. */
type ArenaItem =
  | {
      readonly kind: 'live';
      readonly fight: FightData;
      readonly place: FightPlace;
      readonly sides: ArenaSides;
      readonly age: number;
    }
  | {
      readonly kind: 'end';
      readonly fx: EndFx;
      readonly place: FightPlace;
      readonly phase: number;
    };

type FightData = RenderFrame['base']['view']['fights'][number];

/** What an arena needs beyond its plate (px): its badges over the top row; the end label. */
const LIVE_REACH = { top: 4, bottom: 4 } as const;
const END_REACH = { top: 32, bottom: 4 } as const;

/** An arena that moved this far (px) from its usual spot gets a dotted line to its place. */
const TETHER_MIN = 8;

type Side = 'own' | 'enemy';
const SIDES: readonly Side[] = ['own', 'enemy'];

/** The arena over a fight: the plate with its chips and their badges, the "+N" and the bar. */
interface Arena {
  readonly view: Container;
  /** A dotted line down to a fight on a road, and a cross there. */
  readonly tether: Graphics;
  readonly plate: BakedSprite;
  /** A finished fight: the halves tinted by the owners, the winner's outlined. */
  readonly tint: Graphics;
  readonly chips: BakedSprite[];
  /** The chevron badges of the chips (#791), pooled: a chip has at most one up and one down. */
  readonly badges: BakedSprite[];
  /** The self-shot of a chip whose charge the terrain burned in the round (DEC-45), pooled. */
  readonly burns: BakedSprite[];
  /** Per side: "+N" of the chips that do not fit, the dot and the number of the charged ones among them. */
  readonly more: Readonly<Record<Side, Text>>;
  readonly moreDot: Readonly<Record<Side, Graphics>>;
  readonly moreCharged: Readonly<Record<Side, Text>>;
  /** Per side, a finished fight: the losses of the whole fight. */
  readonly loss: Readonly<Record<Side, Text>>;
  readonly track: Graphics;
  readonly fill: Graphics;
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

/**
 * What the view remembers of a fight from frame to frame: the chips of both sides, to see a
 * reinforcement, and the penalty chips pinned in front (#791, `pinnedPenalty`), own then enemy.
 */
interface Seen {
  totals: [number, number];
  /** Chips that joined since: from this index on, at this tick (`null`: none yet). */
  grew: [{ from: number; tick: number } | null, { from: number; tick: number } | null];
  pinned: [number, number];
}

type Glyphs = Readonly<Record<FightResult, GraphicsContext>>;

/** Dictionary key of the word of a result. */
const RESULT_KEY = {
  captured: 'fight.captured',
  held: 'fight.held',
  bounced: 'fight.bounced',
} as const;

/**
 * The animation of fights (DEC-24, DEC-29, DEC-32; ui-style 9.9, 27, 29). Over every fight going
 * on (`view.fights`) floats the arena (A1 "chips"): a plate of two halves, own units on the left,
 * the enemy's on the right, a chip for every unit that was in the fight: a charged one filled, a
 * discharged one hollow and hatched, a dead one dashed (the form tells it, not the hue; the
 * enemy's chips have a second, dark outline). Up to eight chips a side, the rest is "+N" with its
 * exact number (and a small number of the charged ones hidden in it). The badges are on the chips
 * (#791, variant "Chevrons" and arena "On chips" of #776): a chip with a bonus shot left
 * (`FightView.virtual_left`: a planned order, mountains) has green chevrons up, the badge goes when
 * its shot fires; a charge the terrain takes (`FightView.mute`: plains) has red chevrons down on a
 * chip pinned in front that never moves. Under item F2 that chip stays charged and silent with its
 * badge to the end; under `combat.terrain_burn` (DEC-45) it shoots itself in the first round (a short
 * self-shot, the charge goes out, the badge goes). Along the bottom a bar fills until the next
 * round. The shots are the tracers on the map between the groups (`ShotView`, shot style 1, #352),
 * not on the plate. A chip that changed in the round, or joined with a reinforcement, pulses once. A
 * fight without round data (an old replay: #323) has chips and no badges. Every `fight_round` event also pops up the
 * losses of the round. The end of a fight (`fight_ended`) shows its plate again with the losses of
 * the whole fight, the winner's half outlined, and a word with a glyph: captured, held or both
 * bounced. A fight on a road floats above its meeting point with a dotted line down to it.
 *
 * The arena is drawn in screen pixels (ui-style 27.2, item 7): every container is scaled by
 * `1 / cameraScale`, so chips do not shrink at 60% and the text is laid out at one unit a pixel.
 * Every duration is a share of a round (`roundTicks`), nothing is in fixed seconds. With "less
 * motion" no chip pulses and no number rises.
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
  private readonly barContext: GraphicsContext;
  private readonly dotContext: Readonly<Record<Side, GraphicsContext>>;
  private readonly styles: {
    more: TextStyle;
    small: TextStyle;
    own: TextStyle;
    enemy: TextStyle;
    /** The losses of a finished fight on the tinted halves of the plate: light, so it reads on both hues. */
    total: TextStyle;
    word: TextStyle;
  };
  private readonly seen = new Map<string, Seen>();
  private effects: FightFx[] = [];
  private roundFx: RoundFx[] = [];
  /** Where the two sides of a fight stand on the map: the loss numbers rise over the group that lost them. */
  private contactsOf: (place: FightPlace) => Contacts = (place) => ({
    own: place.at,
    enemy: place.at,
  });
  private eventsSeen: readonly EventMsg[] | null = null;
  private eventCount = -1;
  private cameraScale = 1;
  /** The canvas in scaled-world px (`setViewport`); `null` until the camera is known. */
  private view: Rect | null = null;

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    private readonly me: PlayerId,
    private resolution: number,
    /** Radius of a city now (`CityView.radiusOf`). */
    private readonly radiusOf: (node: number) => number,
    /** The baked plate and chips, in screen px (`bake.ts`). */
    private readonly sprites: SpriteCache,
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
    this.barContext = this.context((g) =>
      g.roundRect(0, 0, BAR_WIDTH, BAR_HEIGHT, BAR_HEIGHT / 2).fill(FIGHT_COLOR),
    );
    const colorOf = (side: Side): number => this.colorOf(side);
    const dot = (side: Side): GraphicsContext =>
      this.context((g) =>
        g.circle(0, 0, 2.6).fill(colorOf(side)).stroke({ width: 1, color: GLYPH_COLOR }),
      );
    this.dotContext = { own: dot('own'), enemy: dot('enemy') };
    // Bottom to top: arenas, results, the loss numbers.
    this.layer.addChild(this.arenaLayer, this.endLayer, this.shotLayer, this.popLayer);
    layers.layer.effects.addChild(this.layer);
  }

  /** The colour of a side of the arena: own blue, the opponent red. */
  private colorOf(side: Side): number {
    return ownerColor(this.me, side === 'own' ? this.me : this.me === 0 ? 1 : 0);
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

  /** Where the groups of a fight stand (`EffectsView`: their tokens): the numbers of losses go over them. */
  setContacts(contactsOf: (place: FightPlace) => Contacts): void {
    this.contactsOf = contactsOf;
  }

  /** The rounds of the events: what happened in each (the hits are drawn from them). */
  rounds(): readonly RoundFx[] {
    return this.roundFx;
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
      ...this.arenas.flatMap((arena) =>
        SIDES.flatMap((side) => [arena.more[side], arena.moreCharged[side], arena.loss[side]]),
      ),
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
      const age = fight.last_round === null ? 0 : frame.tick - fight.last_round.tick;
      items.push({ kind: 'live', fight, place, sides, age });
    }
    for (const fx of this.effects) {
      if (fx.kind !== 'end') continue;
      const phase = roundEffect(frame.tick - fx.tick, END_SHARE, roundTicks);
      if (phase === null || items.length >= MAX_ARENAS) continue;
      items.push({ kind: 'end', fx, place: fx.place, phase });
    }
    const spots = this.layout(items);
    let ends = 0;
    items.forEach((item, index) => {
      const arena = this.arena(index);
      const spot = spots[index];
      if (spot === undefined) return;
      this.placeArena(arena, item.place, spot, k);
      if (item.kind === 'live') {
        const { fight, sides, age } = item;
        const pulses = this.pulses(
          fight.id,
          sides,
          fight.last_round,
          age,
          frame.tick,
          roundTicks,
          reduced,
        );
        this.drawFight(arena, {
          sides,
          pulses,
          pinned: this.pinnedOf(fight.id),
          burnedNow: this.burnedNow(fight.last_round),
          progress: roundProgress(fight.next_round_tick, frame.tick, roundTicks),
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
      return { ...base, top: LIVE_REACH.top, bottom: LIVE_REACH.bottom };
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
    this.roundFx = [];
    for (const event of events) {
      const fx = fightFx(event, this.map, this.radiusOf);
      if (fx === null) continue;
      this.effects.push(fx);
      if (fx.kind === 'round') this.roundFx.push(fx);
    }
  }

  private hide(pool: readonly { view: Container }[], used: number): void {
    for (let i = used; i < pool.length; i++) {
      const item = pool[i];
      if (item !== undefined) item.view.visible = false;
    }
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
      const plate = view.addChild(this.sprites.sprite(arenaPlateSpec()));
      const tint = view.addChild(new Graphics());
      const chips = Array.from({ length: CHIPS_PER_ARENA }, () => {
        const chip = view.addChild(this.sprites.sprite());
        chip.visible = false;
        return chip;
      });
      const badges: BakedSprite[] = [];
      const burns: BakedSprite[] = [];
      const pair = <T>(make: (side: Side) => T): Readonly<Record<Side, T>> => ({
        own: make('own'),
        enemy: make('enemy'),
      });
      const more = pair(() => this.text(view, this.styles.more, 0.5));
      const moreDot = pair((side) => view.addChild(new Graphics(this.dotContext[side])));
      const moreCharged = pair(() => this.text(view, this.styles.small, { x: 0, y: 0.5 }));
      const loss = pair(() => this.text(view, this.styles.total, 0.5));
      const track = view.addChild(new Graphics(this.barContext));
      track.alpha = 0.18;
      const fill = view.addChild(new Graphics(this.barContext));
      for (const g of [...Object.values(moreDot), tint]) g.visible = false;
      arena = {
        view,
        tether,
        plate,
        tint,
        chips,
        badges,
        burns,
        more,
        moreDot,
        moreCharged,
        loss,
        track,
        fill,
      };
      this.arenas.push(arena);
    }
    return arena;
  }

  private placeArena(arena: Arena, place: FightPlace, spot: ArenaSpot, k: number): void {
    const part = arena.view;
    part.position.set(spot.x, spot.y);
    part.scale.set(k);
    part.alpha = 1;
    part.visible = true;
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
    const burnedNow = this.burnedNow(round);
    const pinnedNow = (before: number, side: Side): number =>
      pinnedPenalty(before, sides[side], burnedNow[side]);
    if (seen === undefined) {
      this.seen.set(id, {
        totals,
        grew: [null, null],
        pinned: [pinnedNow(0, 'own'), pinnedNow(0, 'enemy')],
      });
    } else {
      seen.pinned = [pinnedNow(seen.pinned[0], 'own'), pinnedNow(seen.pinned[1], 'enemy')];
      for (const i of [0, 1] as const) {
        const before = seen.totals[i];
        const now = totals[i];
        if (now > before) seen.grew[i] = { from: before, tick };
        else if (now < before) seen.grew[i] = null;
        seen.totals[i] = now;
      }
    }
    const grew = this.seen.get(id)?.grew ?? [null, null];
    const pinned = this.pinnedOf(id);
    const result: Record<Side, Map<number, number>> = { own: new Map(), enemy: new Map() };
    if (reduced) return result;
    SIDES.forEach((side, i) => {
      const pulse = chipPulse(age, roundTicks, false);
      if (round !== null && pulse !== 1) {
        const player: PlayerId = side === 'own' ? this.me : this.me === 0 ? 1 : 0;
        // A charge the terrain burned goes out in the round on its pinned chip (DEC-45, #791).
        const changed = changedChips(
          sides[side],
          {
            spent: round.spent[player],
            burned: round.burned[player],
            losses: round.losses[player],
          },
          pinned[side],
        );
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

  /** The penalty chips pinned in front of each side of a fight (#791), as the view remembers them. */
  private pinnedOf(id: string): Readonly<Record<Side, number>> {
    const pinned = this.seen.get(id)?.pinned ?? [0, 0];
    return { own: pinned[0], enemy: pinned[1] };
  }

  /** The charges the terrain burned in `round`, by side (DEC-45); zeros without a round. */
  private burnedNow(round: FightRoundView | null): Readonly<Record<Side, number>> {
    if (round === null) return { own: 0, enemy: 0 };
    const enemy: PlayerId = this.me === 0 ? 1 : 0;
    return { own: round.burned[this.me], enemy: round.burned[enemy] };
  }

  /** The arena of a fight going on: chips with their badges, the bar to the next round. */
  private drawFight(
    arena: Arena,
    look: {
      sides: ArenaSides;
      pulses: Record<Side, ReadonlyMap<number, number>>;
      pinned: Readonly<Record<Side, number>>;
      burnedNow: Readonly<Record<Side, number>>;
      progress: number;
      age: number;
      roundTicks: number;
      reduced: boolean;
    },
  ): void {
    arena.plate.visible = true;
    arena.tint.visible = false;
    let badges = 0;
    let burns = 0;
    let used = 0;
    // The self-shot of a burned charge (DEC-45): from the tick of the round, a share of a round long.
    const burnPhase = roundEffect(look.age, SELF_SHOT_SHARE, look.roundTicks);
    for (const side of SIDES) {
      const counts = look.sides[side];
      const own = side === 'own';
      const chips = chipsOf(counts, look.pinned[side]);
      chips.shown.forEach((state, index) => {
        const chip = arena.chips[used++];
        if (chip === undefined) return;
        const at = chipAt(index, chips.shown.length, own);
        // Helmet chips (#784): the own ones face right, the opponent's left, so the sides look at each other.
        const helmets = unitStyle() === 'helmet';
        chip.set(
          helmets
            ? helmetChipSpec(state, !own, this.colorOf(side))
            : chipSpec(state, !own, this.colorOf(side)),
        );
        chip.label = `chip:${state}`;
        chip.position.set(at.x, at.y);
        const pulse = look.pulses[side].get(index) ?? 1;
        chip.scale.set(helmets && !own ? -pulse : pulse, pulse);
        chip.visible = true;
        badges = this.drawChipBadges(arena, badges, chips.badges[index] ?? null, at);
      });
      // The chips whose charge the terrain burned in the last round shoot themselves (DEC-45).
      const burned = look.burnedNow[side];
      if (burnPhase !== null && burned > 0) {
        for (const index of chips.burned.slice(-burned)) {
          const at = chipAt(index, chips.shown.length, own);
          const burn = this.burn(arena, burns++);
          const grow = look.reduced ? 1 : 0.7 + 0.7 * burnPhase;
          burn.scale.set(grow);
          burn.alpha = look.reduced ? 1 : 1 - burnPhase * burnPhase;
          burn.position.set(at.x, at.y);
          burn.visible = true;
        }
      }
      this.drawStrip(arena, side, chips.hidden, chips.hiddenCharged, own);
    }
    for (let i = used; i < arena.chips.length; i++) {
      const chip = arena.chips[i];
      if (chip !== undefined) chip.visible = false;
    }
    for (let i = badges; i < arena.badges.length; i++) {
      const badge = arena.badges[i];
      if (badge !== undefined) badge.visible = false;
    }
    for (let i = burns; i < arena.burns.length; i++) {
      const burn = arena.burns[i];
      if (burn !== undefined) burn.visible = false;
    }
    for (const side of SIDES) arena.loss[side].visible = false;
    const x0 = -BAR_WIDTH / 2;
    arena.track.position.set(x0, BAR_Y);
    arena.track.visible = true;
    arena.fill.position.set(x0, BAR_Y);
    arena.fill.scale.x = Math.max(0.0001, look.progress);
    arena.fill.visible = look.progress > 0;
  }

  /**
   * The chevron badges of one chip at its top right corner (#791): up for its bonus shots, down
   * under it for its penalty; baked sprites with a bounded key, pooled per arena. Returns the next
   * free slot of the pool.
   */
  private drawChipBadges(arena: Arena, used: number, badge: ChipBadge | null, at: Point): number {
    if (badge === null) return used;
    const marks: BadgeMark[] = [];
    if (badge.up > 0) marks.push({ dir: 'up', count: badge.up });
    if (badge.down > 0) marks.push({ dir: 'down', count: badge.down });
    const corner = { x: at.x + CHIP_BADGE.x, y: at.y + CHIP_BADGE.y };
    const places = stackBadges(corner, marks, BADGE.chipSize);
    let next = used;
    marks.forEach((mark, i) => {
      const sprite = this.badgeSprite(arena, next++);
      sprite.set(chevronBadgeSpec(mark.dir, mark.count, BADGE.chipSize));
      sprite.label = `badge:${mark.dir}:${String(mark.count)}`;
      const place = places[i] ?? corner;
      sprite.position.set(place.x, place.y);
      sprite.visible = true;
    });
    return next;
  }

  /** The strip under the chips of a side: "+N", the charged ones among the hidden. */
  private drawStrip(
    arena: Arena,
    side: Side,
    hidden: number,
    hiddenCharged: number,
    own: boolean,
  ): void {
    const sign = own ? -1 : 1;
    const more = arena.more[side];
    more.visible = hidden > 0;
    if (hidden > 0) {
      const label = `+${String(hidden)}`;
      if (more.text !== label) more.text = label;
      more.position.set(sign * MORE_X, STRIP_Y);
    }
    const dot = arena.moreDot[side];
    const charged = arena.moreCharged[side];
    dot.visible = hiddenCharged > 0;
    charged.visible = hiddenCharged > 0;
    if (hiddenCharged > 0) {
      const label = String(hiddenCharged);
      if (charged.text !== label) charged.text = label;
      dot.position.set(sign * HIDDEN_CHARGED_X, STRIP_Y + 1);
      // The number sits on the outer side of the dot, aligned away from it.
      charged.anchor.set(own ? 1 : 0, 0.5);
      charged.position.set(sign * (HIDDEN_CHARGED_X + 5), STRIP_Y + 1);
    }
  }

  private badgeSprite(arena: Arena, index: number): BakedSprite {
    let badge = arena.badges[index];
    if (badge === undefined) {
      badge = arena.view.addChildAt(this.sprites.sprite(), arena.view.getChildIndex(arena.track));
      arena.badges.push(badge);
    }
    return badge;
  }

  private burn(arena: Arena, index: number): BakedSprite {
    let burn = arena.burns[index];
    if (burn === undefined) {
      burn = arena.view.addChildAt(
        this.sprites.sprite(selfShotSpec()),
        arena.view.getChildIndex(arena.track),
      );
      burn.label = 'self-shot';
      arena.burns.push(burn);
    }
    return burn;
  }

  /** A finished fight: the plate with the halves tinted, the losses of the whole fight, the winner outlined. */
  private drawEnded(arena: Arena, fx: EndFx, phase: number): void {
    arena.view.alpha = numbersLook(phase, true).alpha;
    arena.plate.visible = true;
    for (const chip of arena.chips) chip.visible = false;
    for (const badge of arena.badges) badge.visible = false;
    for (const burn of arena.burns) burn.visible = false;
    for (const side of SIDES) {
      arena.more[side].visible = false;
      arena.moreDot[side].visible = false;
      arena.moreCharged[side].visible = false;
    }
    arena.track.visible = false;
    arena.fill.visible = false;
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
      // "-N" rises over the group that lost the units from the moment the shot lands.
      const pop = sinceShare(tick - fx.tick, HIT_SHARE, NUMBER_SHARE, roundTicks);
      if (pop !== null) pops = this.placePops(fx, pop, pops, reduced, k);
    }
    for (let i = pops; i < this.pops.length; i++) {
      const pop = this.pops[i];
      if (pop !== undefined) pop.text.visible = false;
    }
  }

  /** The losses of a round pop up over the group of the side that lost them. */
  private placePops(fx: RoundFx, phase: number, used: number, reduced: boolean, k: number): number {
    const enemy: PlayerId = this.me === 0 ? 1 : 0;
    const look = numbersLook(phase, reduced);
    const contacts = this.contactsOf(fx.place);
    // The text is laid out at one unit a px of screen (`k` undoes the zoom of the map).
    const scale = Math.max(1, k);
    let next = used;
    ([this.me, enemy] as const).forEach((player, side) => {
      const losses = fx.losses[player];
      if (losses <= 0 || next >= MAX_POPS) return;
      const pop = this.pop(next++, side === 0 ? 'own' : 'enemy');
      const label = `${MINUS}${String(losses)}`;
      if (pop.text.text !== label) pop.text.text = label;
      pop.text.alpha = look.alpha;
      const at = side === 0 ? contacts.own : contacts.enemy;
      pop.text.position.set(
        at.x + POP_OFFSET.x * scale,
        at.y - POP_OFFSET.y * scale - look.rise * k,
      );
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
