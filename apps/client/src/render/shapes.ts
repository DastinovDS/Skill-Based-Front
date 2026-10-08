import { Container, Graphics, GraphicsContext, Text, TextStyle } from 'pixi.js';
import type { Mode, PlayerId } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import {
  chargeLevel,
  countLabel,
  dashSegments,
  triangleCorners,
  triangleHeight,
  triangleSide,
} from './layout.ts';
import {
  BG,
  COUNT_FONT_SIZE,
  GLYPH_COLOR,
  PACKET_RADIUS,
  PLATE_FILL,
  PLATE_INNER_RING,
  SHIELD_BADGE_SCALE,
  TRAIL,
  UNIT_DASH,
  UNIT_INNER_OUTLINE,
  UNIT_INNER_SCALE,
  UNIT_LABEL,
  UNIT_OUTLINE,
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

/** A hammer, the mark of a road being built by a city (DEC-16), around (0, 0), about 10 x 10. */
export function drawHammer(g: GraphicsContext): GraphicsContext {
  return g.rect(-1.3, -2, 2.6, 7.5).fill(GLYPH_COLOR).rect(-5, -5.5, 10, 4).fill(GLYPH_COLOR);
}

const flat = (points: readonly Point[]): number[] => points.flatMap((p) => [p.x, p.y]);

/** The shapes of the triangle of one side: base fill, charge fill (per owner), outlines. */
interface TriangleShapes {
  fill: GraphicsContext;
  /** From the tip, scaled by `chargeLevel` (the tip is the origin). */
  level: Readonly<Record<PlayerId, GraphicsContext>>;
  own: GraphicsContext;
  enemy: GraphicsContext;
  dashed: Readonly<Record<PlayerId, GraphicsContext>>;
}

/**
 * Shapes shared by every token, packet and mark. Like `MapView`, identical shapes share one
 * GraphicsContext; `destroy()` releases them all (a Graphics destroyed on its own leaves the
 * context it was given alone).
 */
export class EntityKit {
  readonly contexts: GraphicsContext[] = [];
  readonly triangles: ReadonlyMap<number, TriangleShapes>;
  readonly packet: Readonly<Record<PlayerId, GraphicsContext>>;
  readonly trail: Readonly<Record<PlayerId, GraphicsContext>>;
  readonly glyph: Readonly<Record<Mode, GraphicsContext>>;
  readonly hammer: GraphicsContext;
  readonly iconDisc: Readonly<Record<PlayerId, GraphicsContext>>;
  readonly textStyle: TextStyle;
  readonly questionStyle: TextStyle;

  constructor(readonly me: PlayerId) {
    const triangles = new Map<number, TriangleShapes>();
    for (const side of UNIT_SIDES) {
      const corners = triangleCorners(side);
      const [left, right, tip] = corners;
      const centroid = { x: 0, y: (left.y + right.y + tip.y) / 3 };
      const inner = corners.map((p) => ({
        x: centroid.x + (p.x - centroid.x) * UNIT_INNER_SCALE,
        y: centroid.y + (p.y - centroid.y) * UNIT_INNER_SCALE,
      }));
      const level = (owner: PlayerId): GraphicsContext =>
        this.context((g) => g.poly(flat(triangleCorners(side, true))).fill(ownerColor(me, owner)));
      const dashed = (owner: PlayerId): GraphicsContext =>
        this.context((g) => {
          for (const [from, to] of [
            [left, right],
            [right, tip],
            [tip, left],
          ] as const) {
            for (const [a, b] of dashSegments(from, to, UNIT_DASH.dash, UNIT_DASH.gap)) {
              g.moveTo(a.x, a.y).lineTo(b.x, b.y);
            }
          }
          return g.stroke({
            width: UNIT_OUTLINE.width,
            color: ownerColor(me, owner),
            cap: 'round',
          });
        });
      triangles.set(side, {
        fill: this.context((g) => g.poly(flat(corners)).fill(PLATE_FILL)),
        level: { 0: level(0), 1: level(1) },
        own: this.context((g) => g.poly(flat(corners)).stroke(UNIT_OUTLINE)),
        enemy: this.context((g) =>
          g.poly(flat(corners)).stroke(UNIT_OUTLINE).poly(flat(inner)).stroke(UNIT_INNER_OUTLINE),
        ),
        dashed: { 0: dashed(0), 1: dashed(1) },
      });
    }
    this.triangles = triangles;
    const packet = (owner: PlayerId): GraphicsContext =>
      this.context((g) => {
        g.circle(0, 0, PACKET_RADIUS).fill(ownerColor(me, owner));
        // The opponent's packet has a dark centre: the side is not told by the hue alone.
        if (owner !== me) g.circle(0, 0, PACKET_RADIUS * 0.4).fill(BG);
        return g;
      });
    this.packet = { 0: packet(0), 1: packet(1) };
    const trail = (owner: PlayerId): GraphicsContext =>
      this.context((g) => {
        const step = TRAIL.length / TRAIL.steps;
        for (let i = 0; i < TRAIL.steps; i++) {
          g.rect(i * step, -TRAIL.width / 2, step + 0.5, TRAIL.width).fill({
            color: ownerColor(me, owner),
            alpha: TRAIL.alpha * (1 - i / TRAIL.steps),
          });
        }
        return g;
      });
    this.trail = { 0: trail(0), 1: trail(1) };
    this.glyph = {
      attack: this.context((g) => drawModeGlyph(g, 'attack')),
      defense: this.context((g) => drawModeGlyph(g, 'defense')),
    };
    this.hammer = this.context(drawHammer);
    const disc = (owner: PlayerId): GraphicsContext =>
      this.context((g) => {
        g.circle(0, 0, 9)
          .fill(PLATE_FILL)
          .stroke({ width: 2.5, color: ownerColor(me, owner) });
        if (owner !== me) g.circle(0, 0, 5.5).stroke(PLATE_INNER_RING);
        return g;
      });
    this.iconDisc = { 0: disc(0), 1: disc(1) };
    this.textStyle = new TextStyle({
      fontFamily: 'system-ui, sans-serif',
      fontSize: COUNT_FONT_SIZE,
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
    this.questionStyle.destroy();
  }
}

/**
 * What a token shows. `counts: null`: numbers are unknown (an enemy seen without numbers).
 * `ghost`: a memory of a hidden place, dashed like an unknown one.
 */
export interface TokenSpec {
  owner: PlayerId;
  modes: readonly Mode[];
  counts: { units: number; charged: number } | null;
  ghost?: boolean;
}

function specKey(spec: TokenSpec): string {
  const counts = spec.counts === null ? '-' : countLabel(spec.counts.units, spec.counts.charged);
  return `${String(spec.owner)}|${spec.modes.includes('defense') ? 'D' : 'A'}|${counts}|${spec.ghost === true ? 'g' : ''}`;
}

/**
 * A unit triangle (9.5): inverted, filled from the tip by the charged share, an own white outline
 * or an opponent's double one (dashed with "?" without numbers, and for a ghost), a shield disc for
 * "Defense" and a "charged/units" label under the tip. The children are created once; `set` only
 * swaps contexts and visibility, and does nothing when the spec is unchanged. Drawn around the
 * centre of the bounding box of the triangle.
 */
export class Token {
  readonly view = new Container();
  private readonly fill: Graphics;
  private readonly level: Graphics;
  private readonly outline: Graphics;
  private readonly shield: Container;
  private readonly shieldDisc: Graphics;
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
    // Every Graphics starts on a shared context: one that owned its own would leak on
    // `destroy({ children: true })`.
    const base = kit.triangles.get(UNIT_SIDES[1]);
    if (base === undefined) throw new Error('no triangle shapes');
    this.fill = new Graphics(base.fill);
    this.level = new Graphics(base.level[0]);
    this.outline = new Graphics(base.own);
    this.shieldDisc = new Graphics(kit.iconDisc[0]);
    const glyph = new Graphics(kit.glyph.defense);
    this.shield = new Container({ visible: false });
    this.shield.scale.set(SHIELD_BADGE_SCALE);
    this.shield.addChild(this.shieldDisc, glyph);
    this.question = new Text({
      text: '?',
      style: kit.questionStyle,
      anchor: 0.5,
      resolution,
      visible: false,
    });
    this.count = new Text({ text: '', style: kit.textStyle, anchor: 0.5, resolution });
    this.label.addChild(this.pill, this.count);
    this.view.addChild(this.fill, this.level, this.outline, this.question, this.shield, this.label);
  }

  labels(): Text[] {
    return [this.count, this.question];
  }

  /** Scale of the whole token (the minimum size on screen, `symbolScale`). */
  setScale(scale: number): void {
    if (this.view.scale.x !== scale) this.view.scale.set(scale);
  }

  /** The "charged/units" label shows only when asked to and the numbers are known. */
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
    const shapes = this.kit.triangles.get(side);
    if (shapes === undefined) return;
    const h = triangleHeight(side);
    this.counted = counts !== null;

    this.fill.context = shapes.fill;
    const level = counts === null ? 0 : chargeLevel(counts.units, counts.charged);
    this.level.visible = level > 0;
    if (level > 0) {
      this.level.context = shapes.level[owner];
      this.level.scale.set(level);
      this.level.position.set(0, h / 2);
    }
    const dashed = counts === null || spec.ghost === true;
    this.outline.context = dashed
      ? shapes.dashed[owner]
      : owner === this.kit.me
        ? shapes.own
        : shapes.enemy;

    this.question.visible = counts === null;
    // Centre of mass of the triangle, a third of the height above the middle of the box.
    this.question.position.set(0, -h / 6);

    const defended = spec.modes.includes('defense');
    this.shield.visible = defended;
    if (defended) {
      this.shieldDisc.context = this.kit.iconDisc[owner];
      this.shield.position.set(side / 2, -h / 2);
    }

    if (counts !== null) {
      this.count.text = countLabel(counts.units, counts.charged);
      const w = this.count.width + 2 * UNIT_LABEL.padX;
      this.pill.clear();
      this.pill
        .roundRect(-w / 2, 0, w, UNIT_LABEL.height, 3)
        .fill({ color: UNIT_LABEL.fill, alpha: UNIT_LABEL.alpha });
      this.label.position.set(0, h / 2 + UNIT_LABEL.gap);
      this.count.position.set(0, UNIT_LABEL.height / 2);
    }
    this.label.visible = this.labelWanted && this.counted;
  }
}
