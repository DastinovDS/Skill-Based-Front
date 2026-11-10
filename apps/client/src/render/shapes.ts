import { Container, Graphics, GraphicsContext, Text, TextStyle, type RenderLayer } from 'pixi.js';
import type { BakedSprite, SpriteCache } from './bake.ts';
import {
  chevronBadgeSpec,
  helmetBackSpec,
  helmetFrontSpec,
  helmetLevelSpec,
} from './bakedShapes.ts';
import type { PlayerId } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import { reducedMotion } from './motion.ts';
import { EaseTween } from './tween.ts';
import { chargeLevel, countLabel, unitSide } from './layout.ts';
import {
  HELMET_SCALE,
  helmet,
  helmetExtent,
  type Helmet,
  type HelmetKind,
} from '../units/helmet.ts';
import { badgeFloor, stackBadges, type BadgeMark } from './badgeLayout.ts';
import { pieceFamily, usePieceFont } from './pieceFont.ts';
import {
  BADGE,
  HELMET_INSIDE,
  CASING,
  COUNT_FONT_SIZE,
  CUT,
  HELMET_ENGRAVED,
  INK,
  GLYPH_COLOR,
  PACKET_ENGRAVED,
  PACKET_SIDE,
  UNIT_LABEL,
  UNIT_SIDES,
  ownerColor,
  sideColours,
  type PlayerColours,
} from './style.ts';

/**
 * Shapes shared by every token, packet and mark. Like `MapView`, identical shapes share one
 * GraphicsContext; `destroy()` releases them all (a Graphics destroyed on its own leaves the
 * context it was given alone).
 */
export class EntityKit {
  readonly contexts: GraphicsContext[] = [];
  /** The baked sprites of the tokens (`bakedShapes.ts`): helmets. */
  readonly sprites: SpriteCache;
  /** A packet of the automatic supply: an engraved square (#858), turned along its road by the view. */
  readonly packet: Readonly<Record<PlayerId, GraphicsContext>>;
  readonly textStyle: TextStyle;
  /** The number inside a helmet: dark stroke, so it reads on the fill and the plate. */
  readonly insideStyle: TextStyle;
  readonly questionStyle: TextStyle;
  /** The tokens whose charge fill is still easing (#508): `advance` steps them, once per frame. */
  private readonly easing = new Set<Token>();

  constructor(
    readonly me: PlayerId,
    sprites: SpriteCache,
    /**
     * Where the badges of the tokens are drawn (#797, `MapLayers.badges`): over the selection and
     * hover outlines; `null` (tests, views without badges): with the token itself.
     */
    readonly badgeLayer: RenderLayer | null = null,
    /** The colours of the players by id (DEC-49); today's look by default. */
    readonly colours: PlayerColours = sideColours(me),
  ) {
    this.sprites = sprites;
    const square = (g: GraphicsContext, side: number): GraphicsContext =>
      g.rect(-side / 2, -side / 2, side, side);
    const packet = (owner: PlayerId): GraphicsContext =>
      this.context((g) => {
        square(g, PACKET_ENGRAVED.casing).fill(CASING);
        square(g, PACKET_SIDE).fill(ownerColor(colours, owner));
        // The opponent's packet has a dark centre: the side is not told by the hue alone.
        if (owner !== me) square(g, PACKET_SIDE * 0.4).fill(CASING);
        return square(g, PACKET_ENGRAVED.outline).stroke({
          width: PACKET_ENGRAVED.ink,
          color: INK,
          join: 'miter',
        });
      });
    this.packet = { 0: packet(0), 1: packet(1) };
    this.textStyle = new TextStyle({
      fontFamily: 'system-ui, sans-serif',
      fontSize: COUNT_FONT_SIZE,
      fontWeight: '700',
      fill: GLYPH_COLOR,
    });
    // The number in the dome and the "?" of the Engraved helmet (#847): EB Garamond, ink on a cut.
    this.insideStyle = new TextStyle({
      fontFamily: pieceFamily(),
      fontSize: HELMET_ENGRAVED.font,
      fontWeight: '600',
      fill: INK,
      stroke: { color: CUT, width: 3, join: 'round' },
    });
    this.questionStyle = new TextStyle({
      fontFamily: pieceFamily(),
      fontSize: HELMET_ENGRAVED.question,
      fontWeight: '600',
      fill: INK,
      stroke: { color: CUT, width: 3, join: 'round' },
    });
    usePieceFont([this.insideStyle, this.questionStyle]);
  }

  /** Registers a token whose fill started to ease. */
  startEasing(token: Token): void {
    this.easing.add(token);
  }

  /**
   * Advances every easing charge fill by `dtMs` of real time (once per frame, from the render
   * loop). A token whose view is gone (swept by its pool) is dropped.
   */
  advance(dtMs: number): void {
    for (const token of this.easing) {
      if (token.view.destroyed || !token.advance(dtMs)) this.easing.delete(token);
    }
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
  }
}

/**
 * What a token shows. `counts: null`: numbers are unknown (an enemy seen without numbers).
 * `ghost`: a memory of a hidden place, dashed like an unknown one. `inside`: the icon of the units
 * in a city (a little smaller, with a thicker casing).
 */
export interface TokenSpec {
  owner: PlayerId;
  counts: { units: number; charged: number } | null;
  /**
   * The range of the units where only that is known («3-5», DEC-21, item 4), already written out
   * (`rangeLabel`): shown in the pill under the helmet instead of the "?", no charges, `counts` is `null`.
   */
  range?: string | null;
  ghost?: boolean;
  inside?: boolean;
  /**
   * The advantage and disadvantage badges at the top right corner (#791): on the map only the
   * terrain mark of a node's defender, which the server computes (`NodeView.terrain_mark`).
   */
  badges?: readonly BadgeMark[];
}

/** Fade and swell of a token that comes or goes, ms, and the size it starts from (#508). */
const PRESENCE_MS = 220;
const ENTER_SCALE = 0.78;
/** The swell on a change of the number of units: size at the start, ms. */
const BUMP_SCALE = 1.14;
const BUMP_MS = 260;

function specKey(spec: TokenSpec): string {
  // The charged count is the fill of the helmet, so it belongs to the key, not to the text.
  const counts =
    spec.counts === null ? '-' : `${String(spec.counts.units)}/${String(spec.counts.charged)}`;
  const badges = (spec.badges ?? []).map((b) => `${b.dir}${String(b.count)}`).join(',');
  return `${String(spec.owner)}|A|${counts}|${spec.ghost === true ? 'g' : ''}${spec.inside === true ? 'i' : ''}|${spec.range ?? ''}|${badges}`;
}

/** Width of the helmet of a token of size step `side` (a city icon is a little smaller). */
export function helmetWidth(side: number, inside: boolean): number {
  return Math.round(side * HELMET_SCALE * (inside ? HELMET_INSIDE : 1) * 100) / 100;
}

/** The helmet a token of `owner` shows: the viewer's faces right, the opponent's left. */
export function helmetKind(me: PlayerId, owner: PlayerId): HelmetKind {
  return owner === me ? 'own' : 'enemy';
}

/**
 * A unit helmet (9.5, #784, variant Full of #775): own Rim facing right, the opponent's Cut facing
 * left (the body is flipped), the strap everywhere, the charge as a level in the dome with a smooth
 * edge (no dividers), dashed with "?" without numbers and for a ghost, the badges at the top right, and one number (all the units) in the middle of the
 * dome. The children are created once; `set` only swaps sprites and visibility, and does nothing
 * when the spec is unchanged.
 */
export class Token {
  readonly view = new Container();
  /** The shape sprites: flipped (`scale.x = -1`) for an opponent's helmet, which faces left. */
  private readonly body = new Container();
  /** The helmet drawn now; `null`: nothing drawn yet. */
  private shape: Helmet | null = null;
  /** How far the drawing reaches above and below the origin (unscaled world units). */
  private extent = { top: 0, bottom: 0 };
  private readonly back: BakedSprite;
  private readonly level: BakedSprite;
  /** The shown height share of the fill: eases toward the one the snapshot gives (#508). */
  private readonly fill = new EaseTween(0);
  private readonly outline: BakedSprite;
  /** The badges at the top right corner (#791), in a layer that keeps them `BADGE.minPx` on screen. */
  private readonly badgeLayer = new Container({ label: 'badges', visible: false });
  private readonly badges: BakedSprite[] = [];
  /** Screen px per unit of the token (`setBadgeFloor`); 0: unknown, no floor. */
  private pxPerUnit = 0;
  private readonly question: Text;
  private readonly label = new Container({ visible: false });
  private readonly pill = new Graphics();
  private readonly count: Text;
  private key = '';
  private counted = false;
  private labelWanted = false;
  /** The size step of the token now (`unitSide`), world units. */
  side: number = UNIT_SIDES[1];
  /** 0 (not there) to 1: a token that comes or goes fades and swells in or out (#508). */
  private readonly presence = new EaseTween(1, PRESENCE_MS);
  /** A short swell when the number of units changes (a merge, a split, a loss). */
  private readonly bump = new EaseTween(1, BUMP_MS);
  private baseScale = 1;
  private units = -1;

  constructor(
    private readonly kit: EntityKit,
    resolution: number,
  ) {
    // The shapes are baked sprites (U1, #347): the back (shadow, casing, strap, plate), the charge
    // fill (a crop of the full dome), the light edge of the dome.
    this.back = kit.sprites.sprite();
    this.level = kit.sprites.sprite();
    this.level.visible = false;
    this.outline = kit.sprites.sprite();
    this.question = new Text({
      text: '?',
      style: kit.questionStyle,
      anchor: 0.5,
      resolution,
      visible: false,
    });
    this.count = new Text({ text: '', style: kit.textStyle, anchor: 0.5, resolution });
    this.label.addChild(this.pill, this.count);
    this.body.addChild(this.back, this.level, this.outline);
    this.view.addChild(this.body, this.question, this.label, this.badgeLayer);
    // The token stays the parent of its badges (transform, fade, visibility); the render layer
    // only draws them above the outlines of the overlay (#797).
    kit.badgeLayer?.attach(this.badgeLayer);
  }

  /**
   * Screen px per unit of the token's drawing (the camera times every scale above it): the badges
   * grow so that they are never under `BADGE.minPx` on screen (ui-style 32, the exception to 22).
   */
  setBadgeFloor(pxPerUnit: number): void {
    if (pxPerUnit === this.pxPerUnit) return;
    this.pxPerUnit = pxPerUnit;
    this.badgeLayer.scale.set(badgeFloor(pxPerUnit));
  }

  /** The keys of the badges drawn now, top to bottom (a test reads them). */
  get badgeKeys(): string[] {
    if (!this.badgeLayer.visible) return [];
    return this.badges.filter((b) => b.visible).map((b) => b.spec?.key ?? '');
  }
  labels(): Text[] {
    return [this.count, this.question];
  }

  /** The top of the drawing above the origin (negative), unscaled world units: what hangs over it goes higher. */
  get top(): number {
    return this.extent.top;
  }

  /** The bottom of the drawing below the origin, unscaled world units: a plate under it goes lower. */
  get bottom(): number {
    return this.extent.bottom;
  }

  /** Scale of the whole token (the minimum size on screen, `symbolScale`). */
  setScale(scale: number): void {
    if (this.baseScale === scale && this.view.scale.x === this.shownScale()) return;
    this.baseScale = scale;
    this.view.scale.set(this.shownScale());
  }

  /** The scale to draw: the size on screen, the entry swell and the unit-count bump. */
  private shownScale(): number {
    return (
      this.baseScale * (ENTER_SCALE + (1 - ENTER_SCALE) * this.presence.value) * this.bump.value
    );
  }

  /** Puts the entry fade and the bump on the view. */
  private showMotion(): void {
    this.view.alpha = this.presence.value;
    this.view.scale.set(this.shownScale());
  }

  /** A token that has just come into being: fades and swells in (not for "less motion"). */
  enter(): void {
    if (reducedMotion()) return;
    this.presence.snap(0);
    this.presence.setTarget(1);
    this.showMotion();
    this.kit.startEasing(this);
  }

  /** Fades the token out; `gone` says when it has finished. */
  leave(): void {
    if (reducedMotion()) this.presence.snap(0);
    else this.presence.setTarget(0);
    this.showMotion();
    if (this.presence.active) this.kit.startEasing(this);
  }

  /** The token is wanted again (it was leaving): fades back in from where it is. */
  revive(): void {
    if (this.presence.target === 1) return;
    this.presence.setTarget(1);
    this.showMotion();
    this.kit.startEasing(this);
  }

  /** Faded out for good: its owner may destroy it. */
  get gone(): boolean {
    return this.presence.target === 0 && this.presence.value === 0;
  }

  /** The number of units shows only when asked to and the numbers are known. */
  setLabel(show: boolean): void {
    this.labelWanted = show;
    this.label.visible = show && this.counted;
  }

  /**
   * Puts the shown fill height on the sprite, hidden when empty: the bottom of the baked dome up to
   * the level (a crop of its frame, #784).
   */
  private showFill(): void {
    const shown = this.fill.value;
    this.level.visible = shown > 0 && this.level.spec !== null;
    const h = this.shape;
    if (h === null) return;
    // The level box ends 1 unit under the dome: the crop counts from there.
    if (shown > 0) this.level.cropBottom(1 + shown * (h.domeBottom - h.domeTop));
  }

  /**
   * Steps the easing fill by `dtMs` (called by `EntityKit.advance`); `false` once it has settled.
   * Only the crop of the baked fill changes: no texture is made.
   */
  advance(dtMs: number): boolean {
    this.fill.step(dtMs);
    this.showFill();
    this.presence.step(dtMs);
    this.bump.step(dtMs);
    this.showMotion();
    return this.fill.active || this.presence.active || this.bump.active;
  }

  set(spec: TokenSpec): void {
    const key = specKey(spec);
    if (key === this.key) return;
    const first = this.key === '';
    this.key = key;
    // A change of the number of units swells the token for a moment (not a new one, not "less motion").
    const units = spec.counts?.units ?? -1;
    if (!first && units !== this.units && units >= 0 && this.units >= 0 && !reducedMotion()) {
      this.bump.snap(BUMP_SCALE);
      this.bump.setTarget(1);
      this.showMotion();
      this.kit.startEasing(this);
    }
    this.units = units;
    const { counts, owner } = spec;
    const side = unitSide(counts === null ? null : counts.units);
    this.side = side;
    const range = spec.range ?? null;
    this.counted = counts !== null || range !== null;
    const color = ownerColor(this.kit.colours, owner);
    const inside = spec.inside === true;
    // A token with unknown numbers and a memory (ghost) are dashed.
    const dashed = counts === null || spec.ghost === true;

    // The fill eases to a new level (#508); a token that is new, unknown or a memory and "less
    // motion" show the level at once.
    const level = counts === null ? 0 : chargeLevel(counts.units, counts.charged);
    const snap = first || counts === null || spec.ghost === true || reducedMotion();

    const shape = this.drawHelmet(spec, side, color, inside, dashed);
    if (snap) this.fill.snap(level);
    else this.fill.setTarget(level);
    this.showFill();
    if (this.fill.active) this.kit.startEasing(this);

    this.drawBadges(spec.badges ?? [], shape.badge);

    const text = counts !== null ? countLabel(counts.units) : range;
    if (text !== null) {
      // The number of units sits in the middle of the dome; a range is wider than a number, so it
      // goes into the pill under the helmet.
      const middle = counts !== null;
      this.count.style = middle ? this.kit.insideStyle : this.kit.textStyle;
      this.count.text = text;
      this.pill.clear();
      if (middle) {
        this.label.position.set(shape.number.x, shape.number.y);
        this.count.position.set(0, 0);
      } else {
        const w = this.count.width + 2 * UNIT_LABEL.padX;
        this.pill
          .roundRect(-w / 2, 0, w, UNIT_LABEL.height, 3)
          .fill({ color: UNIT_LABEL.fill, alpha: UNIT_LABEL.alpha });
        this.label.position.set(0, this.extent.bottom + UNIT_LABEL.gap);
        this.count.position.set(0, UNIT_LABEL.height / 2);
      }
    }
    this.label.visible = this.labelWanted && this.counted;
  }

  /**
   * The chevron badges (#791) stacked down from the top right corner `at` of the helmet: baked
   * sprites with a bounded key (`chevronBadgeSpec`), no filter.
   */
  private drawBadges(marks: readonly BadgeMark[], at: Point): void {
    this.badgeLayer.visible = marks.length > 0;
    this.badgeLayer.position.set(at.x, at.y);
    const places = stackBadges({ x: 0, y: 0 }, marks, BADGE.size);
    marks.forEach((mark, i) => {
      let sprite = this.badges[i];
      if (sprite === undefined) {
        sprite = this.badgeLayer.addChild(this.kit.sprites.sprite());
        this.badges.push(sprite);
      }
      sprite.set(chevronBadgeSpec(mark.dir, mark.count, BADGE.size));
      const place = places[i] ?? { x: 0, y: 0 };
      sprite.position.set(place.x, place.y);
      sprite.visible = true;
    });
    for (let i = marks.length; i < this.badges.length; i++) {
      const sprite = this.badges[i];
      if (sprite !== undefined) sprite.visible = false;
    }
  }

  /**
   * The helmet (#784, variant Full of #775): own Rim facing right, the opponent's Cut facing left
   * (the body is flipped), the strap everywhere, the charge as a level in the dome with a smooth
   * edge (no dividers), the number of units in the middle of the dome. Returns where the number and
   * the badges go.
   */
  private drawHelmet(
    spec: TokenSpec,
    side: number,
    color: number,
    inside: boolean,
    dashed: boolean,
  ): { number: Point; corner: Point; badge: Point } {
    const kind = helmetKind(this.kit.me, spec.owner);
    const width = helmetWidth(side, inside);
    const h = helmet(kind, width);
    this.shape = h;
    const facing = kind === 'own' ? 1 : -1;
    this.body.scale.x = facing;
    const reach = helmetExtent(h);
    this.extent = { top: reach.top, bottom: reach.bottom };
    const { counts } = spec;
    this.back.set(helmetBackSpec(kind, width, color, dashed ? 'dashed' : 'solid', inside));
    if (counts !== null) this.level.set(helmetLevelSpec(kind, width, color));
    this.level.position.set(0, 0);
    this.outline.set(helmetFrontSpec(kind, width, color, dashed ? 'dashed' : 'solid'));
    const middle = { x: h.middle.x * facing, y: h.middle.y };
    this.question.visible = counts === null && (spec.range ?? null) === null;
    this.question.position.set(middle.x, middle.y);
    // The top left corner on screen, whichever way the helmet faces.
    const left = facing === 1 ? reach.left : -reach.right;
    // The top right corner on screen, kept free of the dome for the badges (#776).
    const right = facing === 1 ? reach.right : -reach.left;
    return {
      number: middle,
      corner: { x: left, y: reach.top + 2 },
      badge: { x: right - 2, y: reach.top + 9 },
    };
  }
}
