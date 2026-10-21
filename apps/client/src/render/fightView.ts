import { Container, Graphics, GraphicsContext, Text, TextStyle } from 'pixi.js';
import { t } from '../i18n/index.ts';
import type { RenderFrame } from '../net/interpolate.ts';
import type { EventMsg, MapFile, PlayerId } from '../protocol.gen.ts';
import { effectProgress, numbersLook } from './effectsLayout.ts';
import {
  ARENA_RADIUS,
  END_FX_MS,
  LOSS_POP_MS,
  arenaSides,
  chargeLine,
  exchangeArrow,
  exchangeLook,
  exchangeOf,
  fightFx,
  fightPlace,
  fightResult,
  halfSlice,
  hatchLines,
  lighten,
  roundProgress,
  type ArenaSides,
  type EndFx,
  type FightFx,
  type FightPlace,
  type FightResult,
  type RoundFx,
  type SideCount,
  type SideShots,
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
/** Distance between the lines that hatch the discharged units of an arena. */
const HATCH_PITCH = 4;
/** The lightened tone of the discharged units: how far its colour moves to white. */
const REST_LIGHTEN = 0.6;
/** The label of the shots on an arrow: glyph, gap and padding (world units). */
const LABEL = { glyph: 8, gap: 2, between: 5, padX: 5, height: 14, radius: 5 } as const;

/** The arena over a fight: two halves (own left, enemy right), their numbers, the round arc. */
interface Arena {
  readonly view: Container;
  readonly base: Graphics;
  /** Per half, own then enemy: the discharged units' number (above), the charged units' (below). */
  readonly texts: readonly [Text, Text, Text, Text];
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

const flat = (points: readonly Point[]): number[] => points.flatMap((p) => [p.x, p.y]);

type Glyphs = Readonly<Record<FightResult, GraphicsContext>>;

/** Dictionary key of the word of a result. */
const RESULT_KEY = {
  captured: 'fight.captured',
  held: 'fight.held',
  bounced: 'fight.bounced',
} as const;

/**
 * The animation of fights (DEC-24, DEC-29; ui-style 9.9). Over every fight going on (`view.fights`)
 * floats an arena, a circle of two halves: own units on the left, the enemy's on the right. In
 * each half the charged units are the main colour, the discharged ones the lightened colour with
 * hatching, each with its number; an arc round the arena fills until the next round. The
 * last round of the fight (`FightView.last_round`) shows as an exchange of blows: an arc arrow in
 * the colour of the side that shot, from its half over into the opponent's, with a label of the
 * shots (a disc: real shots, a diamond: virtual ones, bonus or terrain); a side that did not shoot
 * has no arrow, and a fight without round data (an old replay) has none at all. Every `fight_round`
 * event also pops up the losses of the round. The end of a fight (`fight_ended`) shows its arena
 * again with the losses of the whole fight, the winner's half outlined, and a word with a glyph:
 * captured, held or both bounced. A fight on a road floats above its meeting point with a dotted
 * line down to it. With "less motion" no arrow grows and no number rises.
 *
 * Everything is a function of the render tick (`frame.tick`, fractional between snapshots), so a
 * paused scene shows a fight in the state of that tick. The objects are pooled: nothing is created
 * per frame once the pools have grown. `destroy()` releases everything.
 */
export class FightView {
  private readonly layer = new Container({ label: 'fights' });
  private readonly arenaLayer = new Container({ label: 'arenas' });
  private readonly endLayer = new Container({ label: 'fight-results' });
  private readonly labelLayer = new Container({ label: 'fight-shots' });
  private readonly popLayer = new Container({ label: 'fight-losses' });
  private readonly arenas: Arena[] = [];
  private readonly arrows = new Graphics();
  private readonly labels: ShotLabel[] = [];
  private readonly pops: Pop[] = [];
  private readonly ends: EndLabel[] = [];
  private readonly contexts: GraphicsContext[] = [];
  private readonly glyphs: Glyphs;
  private readonly styles: {
    count: TextStyle;
    shots: TextStyle;
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
    const text = (fill: number, size: number, stroke = true): TextStyle =>
      new TextStyle({
        fontFamily: 'system-ui, sans-serif',
        fontSize: size,
        fontWeight: '700',
        fill,
        ...(stroke ? { stroke: { color: BG, width: 3.5, join: 'round' as const } } : {}),
      });
    this.styles = {
      count: text(GLYPH_COLOR, 12),
      shots: text(GLYPH_COLOR, 11, false),
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
    // Bottom to top: arenas, results, the arrows with their labels, the loss numbers.
    this.layer.addChild(
      this.arenaLayer,
      this.endLayer,
      this.arrows,
      this.labelLayer,
      this.popLayer,
    );
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
      ...this.labels.flatMap((label) => [label.real, label.virtual]),
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
    this.arrows.clear();
    let arenas = 0;
    let labels = 0;
    for (const fight of frame.base.view.fights) {
      if (arenas >= MAX_ARENAS) break;
      const place = fightPlace(this.map, fight.node, fight.edge, fight.point, this.radiusOf);
      if (place === undefined) continue;
      const sides = arenaSides(fight, frame.groups, this.me);
      const arena = this.arena(arenas++);
      this.drawArena(arena, place, {
        sides,
        progress: roundProgress(fight.next_round_tick, frame.tick, roundTicks),
        winner: null,
        dim: false,
      });
      labels = this.drawExchange(
        place,
        exchangeOf(fight.last_round, this.me),
        fight.last_round === null ? 0 : frame.tick - fight.last_round.tick,
        labels,
        roundTicks,
        reduced,
      );
    }
    for (let i = labels; i < this.labels.length; i++) {
      const label = this.labels[i];
      if (label !== undefined) label.view.visible = false;
    }
    let ends = 0;
    for (const fx of this.effects) {
      if (fx.kind !== 'end') continue;
      const t = effectProgress(frame.tick - fx.tick, END_FX_MS, tickHz);
      if (t === null || arenas >= MAX_ARENAS) continue;
      const arena = this.arena(arenas++);
      const winner = fx.winner === null ? null : fx.winner === this.me ? 'own' : 'enemy';
      this.drawArena(arena, fx.place, {
        sides: null,
        losses: [
          `${MINUS}${String(fx.losses[this.me])}`,
          `${MINUS}${String(fx.losses[this.me === 0 ? 1 : 0])}`,
        ],
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
    this.drawPops(frame.tick, tickHz, reduced);
  }

  destroy(): void {
    this.arrows.destroy();
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
      const text = (): Text =>
        view.addChild(
          new Text({
            text: '',
            style: this.styles.count,
            anchor: 0.5,
            resolution: this.labelResolution,
          }),
        );
      arena = { view, base, texts: [text(), text(), text(), text()] };
      this.arenas.push(arena);
    }
    return arena;
  }

  private drawArena(
    arena: Arena,
    place: FightPlace,
    look: {
      /** A fight going on: the units and the charged ones of both sides. `null`: a finished fight. */
      sides: ArenaSides | null;
      /** A finished fight: the losses of the whole fight, own then enemy, in the halves. */
      losses?: readonly [string, string];
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
    g.circle(0, 0, R + 2.5).fill({ color: BG, alpha: 0.85 });
    const halves = [
      { color: own, mine: true, x0: Math.PI / 2, count: look.sides?.own },
      { color: enemy, mine: false, x0: -Math.PI / 2, count: look.sides?.enemy },
    ] as const;
    for (const half of halves) {
      if (half.count === undefined) {
        // A finished fight: a half of one tone, the loser's paler.
        const lost =
          look.dim && look.winner !== null && look.winner !== (half.mine ? 'own' : 'enemy');
        g.moveTo(0, half.mine ? R : -R)
          .arc(0, 0, R, half.x0, half.x0 + Math.PI)
          .closePath()
          .fill({ color: half.color, alpha: lost ? HALF_ALPHA * 0.35 : HALF_ALPHA });
      } else {
        this.drawHalf(g, half.mine, half.color, half.count);
      }
    }
    g.circle(0, 0, R).fill({ color: PLATE_FILL, alpha: 0.12 });
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
    this.placeNumbers(texts, look.sides, look.losses);
  }

  /**
   * One half of a fight going on: the charged units fill it from the bottom in the main colour, the
   * discharged ones above are the lightened colour with hatching (the hatching says it without
   * the hue: ui-style 9.9), a thin line where they meet.
   */
  private drawHalf(g: Graphics, mine: boolean, color: number, count: SideCount): void {
    const R = ARENA_RADIUS;
    const sign = mine ? -1 : 1;
    if (count.units <= 0) {
      // Nobody of this side is seen in the fight: a faint half.
      g.poly(flat(halfSlice(R, mine, -R, R))).fill({ color, alpha: 0.12 });
      return;
    }
    const level = chargeLine(count, R);
    const rest = halfSlice(R, mine, -R, level);
    const charged = halfSlice(R, mine, level, R);
    const light = lighten(color, REST_LIGHTEN);
    if (rest.length > 0) {
      g.poly(flat(rest)).fill({ color: light, alpha: 0.3 });
      for (const [from, to] of hatchLines(R, mine, -R, level, HATCH_PITCH)) {
        g.moveTo(from.x, from.y).lineTo(to.x, to.y);
      }
      g.stroke({ width: 1.3, color: light, alpha: 0.85 });
    }
    if (charged.length > 0) g.poly(flat(charged)).fill({ color, alpha: 0.95 });
    if (rest.length > 0 && charged.length > 0) {
      const edge = sign * Math.sqrt(Math.max(0, R * R - level * level));
      g.moveTo(0, level).lineTo(edge, level).stroke({ width: 1, color: FIGHT_COLOR, alpha: 0.7 });
    }
  }

  /**
   * The numbers of an arena: a fight going on: per half the discharged units' number above, the
   * charged ones' below (none for zero); a finished fight: the losses, one per half.
   */
  private placeNumbers(
    texts: Arena['texts'],
    sides: ArenaSides | null,
    losses: readonly [string, string] | undefined,
  ): void {
    const R = ARENA_RADIUS;
    const put = (text: Text | undefined, content: string | null, x: number, y: number): void => {
      if (text === undefined) return;
      text.visible = content !== null;
      if (content === null) return;
      if (text.text !== content) text.text = content;
      text.position.set(x, y);
    };
    const [ownRest, ownCharged, enemyRest, enemyCharged] = texts;
    const x = R * 0.46;
    const y = R * 0.46;
    if (sides === null) {
      put(ownRest, null, 0, 0);
      put(enemyRest, null, 0, 0);
      put(ownCharged, losses?.[0] ?? null, -R * 0.5, 0);
      put(enemyCharged, losses?.[1] ?? null, R * 0.5, 0);
      return;
    }
    const count = (n: number): string | null => (n > 0 ? String(n) : null);
    put(ownRest, count(sides.own.units - sides.own.charged), -x, -y);
    put(ownCharged, count(sides.own.charged), -x, y);
    put(enemyRest, count(sides.enemy.units - sides.enemy.charged), x, -y);
    put(enemyCharged, count(sides.enemy.charged), x, y);
  }

  // --- The exchange of blows ---------------------------------------------------------------------

  /**
   * The arrows of the last round of a fight: own over the top, the enemy's under the bottom, each
   * only if that side shot. Returns the number of labels used so far.
   */
  private drawExchange(
    place: FightPlace,
    exchange: ReturnType<typeof exchangeOf>,
    age: number,
    used: number,
    roundTicks: number,
    reduced: boolean,
  ): number {
    const look = exchangeLook(age, roundTicks, reduced);
    let next = used;
    if (look.alpha <= 0 || look.grow <= 0) return next;
    const enemy: PlayerId = this.me === 0 ? 1 : 0;
    const sides = [
      { shots: exchange.own, own: true, color: ownerColor(this.me, this.me) },
      { shots: exchange.enemy, own: false, color: ownerColor(this.me, enemy) },
    ] as const;
    for (const side of sides) {
      if (side.shots === null) continue;
      const arrow = exchangeArrow(side.own, ARENA_RADIUS, look.grow);
      const [first, ...rest] = arrow.line;
      if (first === undefined) continue;
      const at = (p: Point): Point => ({ x: place.arena.x + p.x, y: place.arena.y + p.y });
      const g = this.arrows;
      const trace = (): void => {
        const from = at(first);
        g.moveTo(from.x, from.y);
        for (const p of rest) {
          const q = at(p);
          g.lineTo(q.x, q.y);
        }
      };
      trace();
      g.stroke({ width: 6.5, color: BG, alpha: 0.6 * look.alpha, cap: 'round', join: 'round' });
      trace();
      g.stroke({ width: 3.5, color: side.color, alpha: look.alpha, cap: 'round', join: 'round' });
      if (arrow.head !== null) {
        g.poly(flat(arrow.head.map(at)))
          .fill({ color: side.color, alpha: look.alpha })
          .stroke({ width: 1.5, color: BG, alpha: 0.7 * look.alpha, join: 'round' });
      }
      if (look.grow >= 1 || reduced) {
        this.drawLabel(this.label(next++), at(arrow.label), side.shots, side.color, look.alpha);
      }
    }
    return next;
  }

  private label(index: number): ShotLabel {
    let label = this.labels[index];
    if (label === undefined) {
      const view = this.labelLayer.addChild(new Container({ label: 'fight-shot-label' }));
      const pill = view.addChild(new Graphics());
      const text = (): Text =>
        view.addChild(
          new Text({
            text: '',
            style: this.styles.shots,
            anchor: { x: 0, y: 0.5 },
            resolution: this.labelResolution,
          }),
        );
      label = { view, pill, real: text(), virtual: text(), key: '' };
      this.labels.push(label);
    }
    return label;
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

  // --- Losses of a round --------------------------------------------------------------------------

  private drawPops(tick: number, tickHz: number, reduced: boolean): void {
    let pops = 0;
    for (const fx of this.effects) {
      if (fx.kind !== 'round') continue;
      const pop = effectProgress(tick - fx.tick, LOSS_POP_MS, tickHz);
      if (pop !== null) pops = this.placePops(fx, pop, pops, reduced);
    }
    for (let i = pops; i < this.pops.length; i++) {
      const pop = this.pops[i];
      if (pop !== undefined) pop.text.visible = false;
    }
  }

  /** The losses of a round pop up beside the half of the side that lost them. */
  private placePops(fx: RoundFx, t: number, used: number, reduced: boolean): number {
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
        fx.place.arena.x + (side === 0 ? -1 : 1) * (ARENA_RADIUS + 15),
        fx.place.arena.y - 8 - look.rise,
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
