import { Container, Graphics, GraphicsContext, Text, TextStyle } from 'pixi.js';
import type { BakedSprite, SpriteCache } from './bake.ts';
import {
  triangleBackSpec,
  triangleFrontSpec,
  triangleLevelSpec,
  shieldSpec,
} from './bakedShapes.ts';
import { tf } from '../i18n/index.ts';
import type { Mode, PlayerId } from '../protocol.gen.ts';
import type { WarehouseBar } from './cityLayout.ts';
import type { DefenseBonus } from './cityStacks.ts';
import { chargeLevel, countLabel, triangleHeight, triangleSide } from './layout.ts';
import {
  BAR_BASE,
  BAR_SEGMENT,
  BG,
  BUILD_PLATE,
  COUNT_FONT_SIZE,
  GLYPH_COLOR,
  PACKET_OUTLINE,
  PACKET_SIDE,
  PACKET_TAIL,
  PACKET_TRANSFER,
  PAPER,
  PLATE_FILL,
  SEGMENT_EMPTY_BAR,
  DEFENSE_LABEL,
  SHIELD_BADGE_SCALE,
  UNIT_INNER_SCALE,
  UNIT_LABEL,
  UNIT_QUESTION_FONT_SIZE,
  UNIT_SIDES,
  ownerColor,
} from './style.ts';

/** Glyph of a mode, drawn around (0, 0) in a box of about 10 x 10 units. */
export function drawModeGlyph(g: GraphicsContext, mode: Mode): GraphicsContext {
  switch (mode) {
    case 'attack':
      return g.poly([-5, 4.5, 0, -5.5, 5, 4.5]).fill(GLYPH_COLOR);
    case 'defense':
      return g.poly([-4.5, -5, 4.5, -5, 4.5, 1, 0, 5.5, -4.5, 1]).fill(GLYPH_COLOR);
  }
}

/**
 * The warehouse bar of a city (`warehouseSegments`): a dark base with a small square per unit of
 * capacity, `color` for a charge held, grey for room. One drawing for the map and the «Supply»
 * layer, so the stock looks the same in both. `x` is the middle of the bar, `top` its top edge.
 */
export function drawWarehouseBar(
  g: Graphics,
  bar: WarehouseBar,
  x: number,
  top: number,
  color: number,
): void {
  if (bar.segments.length === 0) return;
  g.roundRect(
    x - bar.width / 2 - 1,
    top - 1,
    bar.width + 2,
    BAR_SEGMENT.height + 4,
    BAR_BASE.radius,
  ).fill(BAR_BASE.color);
  for (const segment of bar.segments) {
    g.rect(x + segment.x, top + 1, BAR_SEGMENT.width, BAR_SEGMENT.height).fill(
      segment.filled ? color : SEGMENT_EMPTY_BAR,
    );
  }
}

/**
 * Shapes shared by every token, packet and mark. Like `MapView`, identical shapes share one
 * GraphicsContext; `destroy()` releases them all (a Graphics destroyed on its own leaves the
 * context it was given alone).
 */
export class EntityKit {
  readonly contexts: GraphicsContext[] = [];
  /** The baked sprites of the tokens (`bakedShapes.ts`): triangles, shields. */
  readonly sprites: SpriteCache;
  /** A packet of the automatic supply: a square (a charge, ui-style 21). */
  readonly packet: Readonly<Record<PlayerId, GraphicsContext>>;
  /** A one-off transfer: a bigger square with a double outline. */
  readonly packetTransfer: Readonly<Record<PlayerId, GraphicsContext>>;
  /** The squares of the tail behind a packet, nearest first (`PACKET_TAIL`). */
  readonly packetTail: Readonly<Record<PlayerId, readonly GraphicsContext[]>>;
  /** The plate with the level change on a road being built. */
  readonly buildPlate: GraphicsContext;
  readonly textStyle: TextStyle;
  /** The number inside a triangle (a city icon): dark stroke, so it reads on the fill and the plate. */
  readonly insideStyle: TextStyle;
  readonly questionStyle: TextStyle;
  /** "+N / M" beside the shield of an own group in "Defense" (DEC-30): dark stroke, like the number inside. */
  readonly defenseStyle: TextStyle;

  constructor(
    readonly me: PlayerId,
    sprites: SpriteCache,
  ) {
    this.sprites = sprites;
    const square = (g: GraphicsContext, side: number): GraphicsContext =>
      g.rect(-side / 2, -side / 2, side, side);
    const packet = (owner: PlayerId): GraphicsContext =>
      this.context((g) => {
        square(g, PACKET_SIDE).fill(ownerColor(me, owner)).stroke(PACKET_OUTLINE);
        // The opponent's packet has a dark centre: the side is not told by the hue alone.
        if (owner !== me) square(g, PACKET_SIDE * 0.4).fill(BG);
        return g;
      });
    const transfer = (owner: PlayerId): GraphicsContext =>
      this.context((g) => {
        const color = ownerColor(me, owner);
        const { side, ring, ringWidth, outline } = PACKET_TRANSFER;
        square(g, side).fill(color).stroke({ width: outline, color: PAPER });
        if (owner !== me) square(g, side * 0.4).fill(BG);
        // The second outline, apart from the square: a transfer is told from a packet by its shape.
        return square(g, ring).stroke({ width: ringWidth, color });
      });
    const tail = (owner: PlayerId): GraphicsContext[] =>
      PACKET_TAIL.map((step) =>
        this.context((g) =>
          square(g, step.side).fill({ color: ownerColor(me, owner), alpha: step.alpha }),
        ),
      );
    this.packet = { 0: packet(0), 1: packet(1) };
    this.packetTransfer = { 0: transfer(0), 1: transfer(1) };
    this.packetTail = { 0: tail(0), 1: tail(1) };
    this.buildPlate = this.context((g) =>
      g
        .roundRect(
          -BUILD_PLATE.width / 2,
          -BUILD_PLATE.height / 2,
          BUILD_PLATE.width,
          BUILD_PLATE.height,
          BUILD_PLATE.radius,
        )
        .fill(BG)
        .stroke(BUILD_PLATE.stroke),
    );
    this.textStyle = new TextStyle({
      fontFamily: 'system-ui, sans-serif',
      fontSize: COUNT_FONT_SIZE,
      fontWeight: '700',
      fill: GLYPH_COLOR,
    });
    this.insideStyle = new TextStyle({
      fontFamily: 'system-ui, sans-serif',
      fontSize: COUNT_FONT_SIZE + 1,
      fontWeight: '700',
      fill: GLYPH_COLOR,
      stroke: { color: BG, width: 3, join: 'round' },
    });
    this.defenseStyle = new TextStyle({
      fontFamily: 'system-ui, sans-serif',
      fontSize: DEFENSE_LABEL.fontSize,
      fontWeight: '700',
      fill: GLYPH_COLOR,
    });
    this.questionStyle = new TextStyle({
      fontFamily: 'system-ui, sans-serif',
      fontSize: UNIT_QUESTION_FONT_SIZE,
      fontWeight: '700',
      fill: GLYPH_COLOR,
      stroke: { color: BG, width: 3, join: 'round' },
    });
  }

  context(draw: (g: GraphicsContext) => GraphicsContext): GraphicsContext {
    const context = draw(new GraphicsContext());
    this.contexts.push(context);
    return context;
  }

  destroy(): void {
    for (const context of this.contexts) context.destroy();
    this.textStyle.destroy();
    this.insideStyle.destroy();
    this.questionStyle.destroy();
    this.defenseStyle.destroy();
  }
}

/**
 * What a token shows. `counts: null`: numbers are unknown (an enemy seen without numbers).
 * `ghost`: a memory of a hidden place, dashed like an unknown one. `inside`: the number sits in
 * the triangle (the icon of the units in a city, which has no room under it), not in a pill.
 */
export interface TokenSpec {
  owner: PlayerId;
  modes: readonly Mode[];
  counts: { units: number; charged: number } | null;
  /** An own group in "Defense": the bonus it holds and its cap, shown as "+N / M" by the shield (DEC-30). */
  defense?: DefenseBonus | null;
  /**
   * The range of the units where only that is known («3-5», DEC-21, item 4), already written out
   * (`rangeLabel`): shown in the pill under the tip instead of the "?", no charges, `counts` is `null`.
   */
  range?: string | null;
  ghost?: boolean;
  inside?: boolean;
}

function specKey(spec: TokenSpec): string {
  // The charged count is the fill of the triangle, so it belongs to the key, not to the text.
  const counts =
    spec.counts === null ? '-' : `${String(spec.counts.units)}/${String(spec.counts.charged)}`;
  const defense =
    spec.defense == null ? '-' : `${String(spec.defense.bonus)}/${String(spec.defense.cap)}`;
  return `${String(spec.owner)}|${spec.modes.includes('defense') ? 'D' : 'A'}|${counts}|${defense}|${spec.ghost === true ? 'g' : ''}${spec.inside === true ? 'i' : ''}|${spec.range ?? ''}`;
}

/**
 * A unit triangle (9.5): inverted, filled from the tip by the charged share, an outline in the owner's
 * colour (the opponent's double) (dashed with "?" without numbers, and for a ghost), a shield disc for
 * "Defense" and one number (all the units) under the tip. The children are created once; `set` only
 * swaps contexts and visibility, and does nothing when the spec is unchanged. Drawn around the
 * centre of the bounding box of the triangle.
 */
export class Token {
  readonly view = new Container();
  private readonly back: BakedSprite;
  private readonly level: BakedSprite;
  private readonly outline: BakedSprite;
  private readonly shield: BakedSprite;
  private readonly defensePill = new Graphics();
  private readonly defenseText: Text;
  private readonly defenseLabel = new Container({ visible: false });
  private readonly question: Text;
  private readonly label = new Container({ visible: false });
  private readonly pill = new Graphics();
  private readonly count: Text;
  private key = '';
  private counted = false;
  private labelWanted = false;
  /** Side of the triangle now, world units. */
  side: number = UNIT_SIDES[1];

  constructor(
    private readonly kit: EntityKit,
    resolution: number,
  ) {
    // The shapes are baked sprites (U1, #347): the plate with its shadow and the casing of an icon
    // in a city, the charge fill (scaled from the tip), the outline with its rim, the shield badge.
    this.back = kit.sprites.sprite();
    this.level = kit.sprites.sprite();
    this.level.visible = false;
    this.outline = kit.sprites.sprite();
    this.shield = kit.sprites.sprite();
    this.shield.scale.set(SHIELD_BADGE_SCALE);
    this.shield.visible = false;
    this.defenseText = new Text({
      text: '',
      style: kit.defenseStyle,
      anchor: { x: 0, y: 0.5 },
      resolution,
    });
    this.defenseLabel.addChild(this.defensePill, this.defenseText);
    this.question = new Text({
      text: '?',
      style: kit.questionStyle,
      anchor: 0.5,
      resolution,
      visible: false,
    });
    this.count = new Text({ text: '', style: kit.textStyle, anchor: 0.5, resolution });
    this.label.addChild(this.pill, this.count);
    this.view.addChild(
      this.back,
      this.level,
      this.outline,
      this.question,
      this.defenseLabel,
      this.shield,
      this.label,
    );
  }

  labels(): Text[] {
    return [this.count, this.question, this.defenseText];
  }

  /** Scale of the whole token (the minimum size on screen, `symbolScale`). */
  setScale(scale: number): void {
    if (this.view.scale.x !== scale) this.view.scale.set(scale);
  }

  /** The number of units shows only when asked to and the numbers are known. */
  setLabel(show: boolean): void {
    this.labelWanted = show;
    this.label.visible = show && this.counted;
  }

  set(spec: TokenSpec): void {
    const key = specKey(spec);
    if (key === this.key) return;
    this.key = key;
    const { counts, owner } = spec;
    const side = triangleSide(counts === null ? null : counts.units);
    this.side = side;
    const h = triangleHeight(side);
    const range = spec.range ?? null;
    this.counted = counts !== null || range !== null;
    const { me } = this.kit;
    const color = ownerColor(me, owner);

    this.back.set(triangleBackSpec(side, spec.inside === true));
    const level = counts === null ? 0 : chargeLevel(counts.units, counts.charged);
    this.level.visible = level > 0;
    if (level > 0) {
      this.level.set(triangleLevelSpec(side, color));
      this.level.scale.set(level);
      this.level.position.set(0, h / 2);
    }
    // The outline carries the owner's colour, so an empty triangle still tells whose it is; the
    // opponent's second, inner outline tells it without the hue (AGENTS.md 7.4).
    const dashed = counts === null || spec.ghost === true;
    this.outline.set(
      triangleFrontSpec(
        side,
        dashed ? 'dashed' : owner === me ? 'own' : 'enemy',
        color,
        UNIT_INNER_SCALE,
      ),
    );

    this.question.visible = counts === null && range === null;
    // Centre of mass of the triangle, a third of the height above the middle of the box.
    this.question.position.set(0, -h / 6);

    const defended = spec.modes.includes('defense');
    this.shield.visible = defended;
    if (defended) {
      this.shield.set(shieldSpec(color, owner !== me));
      this.shield.position.set(side / 2, -h / 2);
    }

    // "+N / M" by the shield, under it: only an own group carries the numbers (DEC-30, item 5).
    const gathered = defended && spec.defense != null ? spec.defense : null;
    this.defenseLabel.visible = gathered !== null;
    if (gathered !== null) {
      const word = tf('defense.bonus', { bonus: gathered.bonus, cap: gathered.cap });
      if (this.defenseText.text !== word) this.defenseText.text = word;
      const width = this.defenseText.width + 2 * DEFENSE_LABEL.padX;
      const left = DEFENSE_LABEL.tuck;
      this.defensePill
        .clear()
        .roundRect(left, -DEFENSE_LABEL.height / 2, width, DEFENSE_LABEL.height, 4)
        .fill({ color: PLATE_FILL, alpha: 0.95 })
        .stroke({ width: 1.2, color: ownerColor(this.kit.me, owner) });
      this.defenseText.position.set(left + DEFENSE_LABEL.padX, 0);
      // To the right of the shield disc, which overlaps the near end of the pill, and a little lower:
      // the capacity badge and the counters of a city (the grace, #360) sit at the top right.
      this.defenseLabel.position.set(
        side / 2 + this.shield.scale.x * 9,
        -h / 2 + DEFENSE_LABEL.drop,
      );
    }

    const text = counts !== null ? countLabel(counts.units) : range;
    if (text !== null) {
      // A range is wider than a number: always in the pill under the tip.
      const inside = spec.inside === true && counts !== null;
      this.count.style = inside ? this.kit.insideStyle : this.kit.textStyle;
      this.count.text = text;
      this.pill.clear();
      if (inside) {
        // At the centre of mass of the triangle, where the "?" of an unknown group sits too.
        this.label.position.set(0, -h / 6);
        this.count.position.set(0, 0);
      } else {
        const w = this.count.width + 2 * UNIT_LABEL.padX;
        this.pill
          .roundRect(-w / 2, 0, w, UNIT_LABEL.height, 3)
          .fill({ color: UNIT_LABEL.fill, alpha: UNIT_LABEL.alpha });
        this.label.position.set(0, h / 2 + UNIT_LABEL.gap);
        this.count.position.set(0, UNIT_LABEL.height / 2);
      }
    }
    this.label.visible = this.labelWanted && this.counted;
  }
}
