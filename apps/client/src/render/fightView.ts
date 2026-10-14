import { Container, Graphics, GraphicsContext, Text, TextStyle } from 'pixi.js';
import { t } from '../i18n/index.ts';
import type { RenderFrame } from '../net/interpolate.ts';
import type { EventMsg, MapFile, PlayerId } from '../protocol.gen.ts';
import { effectProgress, numbersLook, starPolygon } from './effectsLayout.ts';
import {
  ARENA_RADIUS,
  END_FX_MS,
  LOSS_POP_MS,
  ROUND_FX_MS,
  SHOT_START,
  arenaSides,
  fightFx,
  fightPlace,
  fightResult,
  roundProgress,
  shotCount,
  shotLook,
  sparkLook,
  type EndFx,
  type FightFx,
  type FightPlace,
  type FightResult,
  type RoundFx,
} from './fightFx.ts';
import type { MapLayers } from './layers.ts';
import { drawModeGlyph } from './shapes.ts';
import type { Point } from './camera.ts';
import { BG, FIGHT_COLOR, GLYPH_COLOR, LOSS_FONT_SIZE, PLATE_FILL, ownerColor } from './style.ts';

const MAX_ARENAS = 8;
const MAX_POPS = 16;
const MAX_ENDS = 6;
/** The minus sign (U+2212) in front of a loss number. */
const MINUS = '−';
const HALF_ALPHA = 0.6;
/** Radius of the progress arc around the arena, and its width. */
const ARC_GAP = 4.5;
const ARC_WIDTH = 3;
/** The size of the star of an impact. */
const SPARK = { outer: 14, inner: 5, points: 8 } as const;

/** The arena over a fight: two halves (own left, enemy right), their numbers, the round arc. */
interface Arena {
  readonly view: Container;
  readonly base: Graphics;
  readonly texts: readonly [Text, Text];
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

type Glyphs = Readonly<Record<FightResult, GraphicsContext>>;

/** Dictionary key of the word of a result. */
const RESULT_KEY = {
  captured: 'fight.captured',
  held: 'fight.held',
  bounced: 'fight.bounced',
} as const;

/**
 * The animation of fights (DEC-24; ui-style 9.9). Over every fight going on (`view.fights`) floats
 * an arena: own units on the left half, the enemy's on the right, an arc that fills until the
 * next round. Every `fight_round` event sends the shots of the round from each side to the middle
 * (a spark where they land) and pops up the losses of the round; the end of a fight
 * (`fight_ended`) shows its arena again with the losses of the whole fight, the winner's half
 * outlined, and a word with a glyph: captured, held or both bounced. A fight on a road floats above
 * its meeting point with a dotted line down to it. With "less motion" no shot flies and no number
 * rises.
 *
 * Everything is a function of the render tick (`frame.tick`, fractional between snapshots), so a
 * paused scene shows a fight in the state of that tick. The objects are pooled: nothing is created
 * per frame once the pools have grown. `destroy()` releases everything.
 */
export class FightView {
  private readonly layer = new Container({ label: 'fights' });
  private readonly arenaLayer = new Container({ label: 'arenas' });
  private readonly endLayer = new Container({ label: 'fight-results' });
  private readonly popLayer = new Container({ label: 'fight-losses' });
  private readonly arenas: Arena[] = [];
  private readonly shots = new Graphics();
  private readonly pops: Pop[] = [];
  private readonly ends: EndLabel[] = [];
  private readonly contexts: GraphicsContext[] = [];
  private readonly glyphs: Glyphs;
  private readonly styles: {
    count: TextStyle;
    own: TextStyle;
    enemy: TextStyle;
    word: TextStyle;
  };
  private effects: FightFx[] = [];
  private eventsSeen: readonly EventMsg[] | null = null;
  private eventCount = -1;

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    private readonly me: PlayerId,
    private labelResolution: number,
    /** Radius of a city now (`CityView.radiusOf`). */
    private readonly radiusOf: (node: number) => number,
  ) {
    const text = (fill: number, size: number): TextStyle =>
      new TextStyle({
        fontFamily: 'system-ui, sans-serif',
        fontSize: size,
        fontWeight: '700',
        fill,
        stroke: { color: BG, width: 3.5, join: 'round' },
      });
    this.styles = {
      count: text(GLYPH_COLOR, 12),
      own: text(ownerColor(me, me), LOSS_FONT_SIZE),
      enemy: text(ownerColor(me, me === 0 ? 1 : 0), LOSS_FONT_SIZE),
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
    // Bottom to top: arenas, results, the shots, the loss numbers.
    this.layer.addChild(this.arenaLayer, this.endLayer, this.shots, this.popLayer);
    layers.layer.effects.addChild(this.layer);
  }

  private context(draw: (g: GraphicsContext) => GraphicsContext): GraphicsContext {
    const context = draw(new GraphicsContext());
    this.contexts.push(context);
    return context;
  }

  setLabelResolution(resolution: number): void {
    this.labelResolution = resolution;
    const texts = [
      ...this.arenas.flatMap((arena) => arena.texts),
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
    tickHz: number,
    roundTicks: number,
    reduced: boolean,
  ): void {
    this.readEvents(events);
    let arenas = 0;
    for (const fight of frame.base.view.fights) {
      if (arenas >= MAX_ARENAS) break;
      const place = fightPlace(this.map, fight.node, fight.edge, fight.point, this.radiusOf);
      if (place === undefined) continue;
      const sides = arenaSides(fight, frame.groups, this.me);
      const arena = this.arena(arenas++);
      this.drawArena(arena, place, {
        own: String(sides.own),
        enemy: String(sides.enemy),
        progress: roundProgress(fight.next_round_tick, frame.tick, roundTicks),
        winner: null,
        dim: false,
      });
    }
    let ends = 0;
    for (const fx of this.effects) {
      if (fx.kind !== 'end') continue;
      const t = effectProgress(frame.tick - fx.tick, END_FX_MS, tickHz);
      if (t === null || arenas >= MAX_ARENAS) continue;
      const arena = this.arena(arenas++);
      const winner = fx.winner === null ? null : fx.winner === this.me ? 'own' : 'enemy';
      this.drawArena(arena, fx.place, {
        own: `${MINUS}${String(fx.losses[this.me])}`,
        enemy: `${MINUS}${String(fx.losses[this.me === 0 ? 1 : 0])}`,
        progress: null,
        winner,
        dim: true,
      });
      if (!fx.legacy && ends < MAX_ENDS) this.drawEnd(this.endLabel(ends++), fx, t);
    }
    this.hide(this.arenas, arenas);
    for (let i = ends; i < this.ends.length; i++) {
      const label = this.ends[i];
      if (label !== undefined) label.view.visible = false;
    }
    this.drawRounds(frame.tick, tickHz, reduced);
  }

  destroy(): void {
    this.shots.destroy();
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

  // --- Arena -------------------------------------------------------------------------------------

  private arena(index: number): Arena {
    let arena = this.arenas[index];
    if (arena === undefined) {
      const view = this.arenaLayer.addChild(new Container({ label: 'arena' }));
      const base = view.addChild(new Graphics());
      const text = (x: number): Text => {
        const item = view.addChild(
          new Text({
            text: '',
            style: this.styles.count,
            anchor: 0.5,
            resolution: this.labelResolution,
          }),
        );
        item.position.set(x, 0);
        return item;
      };
      arena = { view, base, texts: [text(-ARENA_RADIUS * 0.5), text(ARENA_RADIUS * 0.5)] };
      this.arenas.push(arena);
    }
    return arena;
  }

  private drawArena(
    arena: Arena,
    place: FightPlace,
    look: {
      own: string;
      enemy: string;
      /** The arc towards the next round; `null`: a finished fight, no arc. */
      progress: number | null;
      winner: 'own' | 'enemy' | null;
      /** A finished fight: the loser's half fades. */
      dim: boolean;
    },
  ): void {
    const { view, base, texts } = arena;
    view.visible = true;
    view.position.set(place.arena.x, place.arena.y);
    const R = ARENA_RADIUS;
    const own = ownerColor(this.me, this.me);
    const enemy = ownerColor(this.me, this.me === 0 ? 1 : 0);
    const g = base.clear();
    // A dotted line down to the true place of a fight on a road, and a cross there.
    if (place.node === null) {
      const dy = place.at.y - place.arena.y;
      for (let y = R + 3; y < dy - 4; y += 7) {
        g.moveTo(0, y).lineTo(0, Math.min(dy - 4, y + 3.5));
      }
      g.stroke({ width: 1.5, color: FIGHT_COLOR, alpha: 0.8 });
      g.moveTo(-4, dy - 4)
        .lineTo(4, dy + 4)
        .moveTo(4, dy - 4)
        .lineTo(-4, dy + 4)
        .stroke({ width: 2, color: FIGHT_COLOR, cap: 'round' });
    }
    g.circle(0, 0, R + 2.5).fill({ color: BG, alpha: 0.8 });
    const halves = [
      { color: own, mine: true, x0: Math.PI / 2 },
      { color: enemy, mine: false, x0: -Math.PI / 2 },
    ] as const;
    for (const half of halves) {
      const lost =
        look.dim && look.winner !== null && look.winner !== (half.mine ? 'own' : 'enemy');
      g.moveTo(0, half.mine ? R : -R)
        .arc(0, 0, R, half.x0, half.x0 + Math.PI)
        .closePath()
        .fill({ color: half.color, alpha: lost ? HALF_ALPHA * 0.35 : HALF_ALPHA });
    }
    g.circle(0, 0, R).fill({ color: PLATE_FILL, alpha: 0.25 });
    g.moveTo(0, -R).lineTo(0, R).stroke({ width: 1.5, color: FIGHT_COLOR, alpha: 0.9 });
    g.circle(0, 0, R).stroke({ width: 1.5, color: FIGHT_COLOR, alpha: 0.9 });
    if (look.progress !== null && look.progress > 0) {
      const start = -Math.PI / 2;
      const r = R + ARC_GAP;
      g.moveTo(r * Math.cos(start), r * Math.sin(start));
      g.arc(0, 0, r, start, start + 2 * Math.PI * look.progress).stroke({
        width: ARC_WIDTH,
        color: FIGHT_COLOR,
        cap: 'round',
      });
    }
    if (look.winner !== null) {
      // The winner's half is outlined thick: the side is told by its place, not by the hue.
      const mine = look.winner === 'own';
      const from = mine ? Math.PI / 2 : -Math.PI / 2;
      const r = R + ARC_GAP;
      g.moveTo(r * Math.cos(from), r * Math.sin(from));
      g.arc(0, 0, r, from, from + Math.PI).stroke({
        width: ARC_WIDTH + 1,
        color: FIGHT_COLOR,
        cap: 'round',
      });
    }
    [look.own, look.enemy].forEach((label, i) => {
      const text = texts[i];
      if (text !== undefined && text.text !== label) text.text = label;
    });
  }

  // --- The end of a fight ------------------------------------------------------------------------

  private endLabel(index: number): EndLabel {
    let label = this.ends[index];
    if (label === undefined) {
      const view = this.endLayer.addChild(new Container({ label: 'fight-result' }));
      const pill = view.addChild(new Graphics());
      const glyph = view.addChild(new Graphics(this.glyphs.held));
      const text = view.addChild(
        new Text({
          text: '',
          style: this.styles.word,
          anchor: { x: 0, y: 0.5 },
          resolution: this.labelResolution,
        }),
      );
      label = { view, pill, glyph, text, result: null };
      this.ends.push(label);
    }
    return label;
  }

  private drawEnd(label: EndLabel, fx: EndFx, phase: number): void {
    const result = fightResult(fx);
    const word = t(RESULT_KEY[result]);
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
    // The label sits above the arena, centred on it, and fades out in the last third.
    const width = 24 + label.text.width + 8;
    label.view.position.set(
      fx.place.arena.x - width / 2 + 12,
      fx.place.arena.y - ARENA_RADIUS - 20,
    );
    label.view.alpha = numbersLook(phase, true).alpha;
    label.view.visible = true;
  }

  // --- Rounds: shots and losses ---------------------------------------------------------------------

  private drawRounds(tick: number, tickHz: number, reduced: boolean): void {
    const g = this.shots;
    g.clear();
    let pops = 0;
    for (const fx of this.effects) {
      if (fx.kind !== 'round') continue;
      const shot = effectProgress(tick - fx.tick, ROUND_FX_MS, tickHz);
      if (shot !== null && !reduced) this.drawShots(g, fx, shot);
      const pop = effectProgress(tick - fx.tick, LOSS_POP_MS, tickHz);
      if (pop !== null) pops = this.drawPops(fx, pop, pops, reduced);
    }
    for (let i = pops; i < this.pops.length; i++) {
      const pop = this.pops[i];
      if (pop !== undefined) pop.text.visible = false;
    }
  }

  /** Shots fly from both sides to the middle of the arena; a spark where they land. */
  private drawShots(g: Graphics, fx: RoundFx, t: number): void {
    const { arena } = fx.place;
    const enemy: PlayerId = this.me === 0 ? 1 : 0;
    // The enemy's shots are not sent to a player: for it the hits (its losses) are drawn.
    const counts: readonly [number, number] = [
      shotCount(fx.shots[this.me]),
      shotCount(fx.shots[enemy] ?? fx.losses[this.me]),
    ];
    let landed = 0;
    counts.forEach((count, side) => {
      const dir = side === 0 ? -1 : 1;
      const color = ownerColor(this.me, side === 0 ? this.me : enemy);
      for (let i = 0; i < count; i++) {
        const look = shotLook(t, i);
        if (look.alpha <= 0) continue;
        const spread = (i - (count - 1) / 2) * 6;
        const x = arena.x + dir * SHOT_START * (1 - look.flight);
        const y = arena.y + spread;
        const tail = x - dir * 11;
        g.moveTo(tail, y).lineTo(x, y);
        g.stroke({ width: 5.5, color: BG, alpha: 0.6 * look.alpha, cap: 'round' });
        g.moveTo(tail, y).lineTo(x, y);
        g.stroke({ width: 3, color, alpha: look.alpha, cap: 'round' });
        g.circle(x, y, 3).fill({ color: FIGHT_COLOR, alpha: look.alpha });
        landed = Math.max(landed, look.spark);
      }
    });
    const look = sparkLook(landed);
    if (look.alpha > 0) {
      g.poly(this.spark(arena, look.scale))
        .fill({ color: FIGHT_COLOR, alpha: look.alpha })
        .stroke({ width: 2, color: BG, alpha: look.alpha, join: 'round' });
    }
  }

  private spark(at: Point, scale: number): number[] {
    return starPolygon(SPARK.outer * scale, SPARK.inner * scale, SPARK.points).map((value, i) =>
      i % 2 === 0 ? at.x + value : at.y + value,
    );
  }

  /** The losses of a round pop up over the half of the side that lost them. */
  private drawPops(fx: RoundFx, t: number, used: number, reduced: boolean): number {
    const enemy: PlayerId = this.me === 0 ? 1 : 0;
    const look = numbersLook(t, reduced);
    let next = used;
    ([this.me, enemy] as const).forEach((player, side) => {
      const losses = fx.losses[player];
      if (losses <= 0 || next >= MAX_POPS) return;
      const pop = this.pop(next++, side === 0 ? 'own' : 'enemy');
      const label = `${MINUS}${String(losses)}`;
      if (pop.text.text !== label) pop.text.text = label;
      pop.text.alpha = look.alpha;
      pop.text.position.set(
        fx.place.arena.x + (side === 0 ? -1 : 1) * (ARENA_RADIUS + 12),
        fx.place.arena.y - ARENA_RADIUS - 4 - look.rise,
      );
      pop.text.visible = true;
    });
    return next;
  }

  private pop(index: number, side: 'own' | 'enemy'): Pop {
    let pop = this.pops[index];
    if (pop === undefined) {
      const text = this.popLayer.addChild(
        new Text({
          text: '',
          style: this.styles[side],
          anchor: 0.5,
          resolution: this.labelResolution,
        }),
      );
      pop = { text };
      this.pops.push(pop);
    }
    // A pool slot serves either side from frame to frame.
    if (pop.text.style !== this.styles[side]) pop.text.style = this.styles[side];
    return pop;
  }
}
