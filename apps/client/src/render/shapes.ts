import { Container, Graphics, GraphicsContext, Text, TextStyle } from 'pixi.js';
import type { Mode, PlayerId } from '../protocol.gen.ts';
import {
  MAX_PIPS,
  TOKEN_COMPACT,
  TOKEN_FULL,
  TOKEN_TOP_ROW_Y,
  countLabel,
  pipLayout,
} from './layout.ts';
import {
  COUNT_FONT_SIZE,
  FIGHT_COLOR,
  GLYPH_COLOR,
  HEADING_ARROW,
  PIP_RADIUS,
  PIP_STROKE,
  PLATE_FILL,
  PLATE_INNER_INSET,
  PLATE_INNER_RING,
  PLATE_OUTLINE_WIDTH,
  PLATE_RADIUS,
  ownerColor,
} from './style.ts';

const MODES = ['attack', 'defense'] as const;

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

/**
 * Shapes shared by every token, packet and mark. Like `MapView`, identical shapes share one
 * GraphicsContext; `destroy()` releases them all (a Graphics destroyed on its own leaves the
 * context it was given alone).
 */
export class EntityKit {
  readonly contexts: GraphicsContext[] = [];
  readonly plateFull: Readonly<Record<PlayerId, GraphicsContext>>;
  readonly plateCompact: Readonly<Record<PlayerId, GraphicsContext>>;
  readonly pipFilled: Readonly<Record<PlayerId, GraphicsContext>>;
  readonly pipEmpty: GraphicsContext;
  readonly glyph: Readonly<Record<Mode, GraphicsContext>>;
  readonly hammer: GraphicsContext;
  readonly heading: GraphicsContext;
  readonly swords: GraphicsContext;
  readonly iconDisc: Readonly<Record<PlayerId, GraphicsContext>>;
  readonly textStyle: TextStyle;

  constructor(me: PlayerId) {
    const plate = (owner: PlayerId, size: { width: number; height: number }): GraphicsContext =>
      this.context((g) => {
        const { width: w, height: h } = size;
        g.roundRect(-w / 2, -h / 2, w, h, PLATE_RADIUS)
          .fill(PLATE_FILL)
          .stroke({ width: PLATE_OUTLINE_WIDTH, color: ownerColor(me, owner) });
        if (owner !== me) {
          const inset = PLATE_INNER_INSET;
          g.roundRect(-w / 2 + inset, -h / 2 + inset, w - 2 * inset, h - 2 * inset, 2).stroke(
            PLATE_INNER_RING,
          );
        }
        return g;
      });
    this.plateFull = { 0: plate(0, TOKEN_FULL), 1: plate(1, TOKEN_FULL) };
    this.plateCompact = { 0: plate(0, TOKEN_COMPACT), 1: plate(1, TOKEN_COMPACT) };
    const filled = (owner: PlayerId): GraphicsContext =>
      this.context((g) =>
        g.circle(0, 0, PIP_RADIUS).fill(ownerColor(me, owner)).stroke(PIP_STROKE),
      );
    this.pipFilled = { 0: filled(0), 1: filled(1) };
    this.pipEmpty = this.context((g) =>
      g.circle(0, 0, PIP_RADIUS).fill(PLATE_FILL).stroke(PIP_STROKE),
    );
    this.glyph = {
      attack: this.context((g) => drawModeGlyph(g, 'attack')),
      defense: this.context((g) => drawModeGlyph(g, 'defense')),
    };
    this.hammer = this.context(drawHammer);
    this.heading = this.context((g) =>
      g.poly([5, 0, -3.5, -4.5, -3.5, 4.5]).fill(HEADING_ARROW.fill).stroke(HEADING_ARROW.stroke),
    );
    this.swords = this.context((g) =>
      g
        .moveTo(-9, -9)
        .lineTo(9, 9)
        .moveTo(9, -9)
        .lineTo(-9, 9)
        .stroke({ width: 7, color: PLATE_FILL })
        .moveTo(-9, -9)
        .lineTo(9, 9)
        .moveTo(9, -9)
        .lineTo(-9, 9)
        .stroke({ width: 3.5, color: FIGHT_COLOR }),
    );
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
  }

  context(draw: (g: GraphicsContext) => GraphicsContext): GraphicsContext {
    const context = draw(new GraphicsContext());
    this.contexts.push(context);
    return context;
  }

  destroy(): void {
    for (const context of this.contexts) context.destroy();
    this.textStyle.destroy();
  }
}

/** What a token shows. `counts: null`: numbers are unknown (an enemy seen without numbers). */
export interface TokenSpec {
  owner: PlayerId;
  modes: readonly Mode[];
  counts: { units: number; charged: number } | null;
}

function specKey(spec: TokenSpec): string {
  const counts = spec.counts === null ? '-' : countLabel(spec.counts.units, spec.counts.charged);
  return `${String(spec.owner)}|${spec.modes.join(',')}|${counts}`;
}

/**
 * A plate with mode glyphs and, when the numbers are known, "charged/units" and one dot per unit.
 * The children are created once; `set` only swaps contexts, positions and visibility, and does
 * nothing when the spec is unchanged.
 */
export class Token {
  readonly view = new Container();
  private readonly plate: Graphics;
  private readonly glyphs: Graphics[];
  private readonly count: Text;
  private readonly pips: Graphics[];
  private key = '';

  constructor(
    private readonly kit: EntityKit,
    resolution: number,
  ) {
    // Every Graphics starts on a shared context: one that owned its own would leak on
    // `destroy({ children: true })`.
    this.plate = this.view.addChild(new Graphics(kit.plateFull[0]));
    this.glyphs = MODES.map(() => this.view.addChild(new Graphics(kit.glyph.attack)));
    this.count = this.view.addChild(
      new Text({ text: '', style: kit.textStyle, anchor: { x: 1, y: 0.5 }, resolution }),
    );
    this.pips = Array.from({ length: MAX_PIPS }, () =>
      this.view.addChild(new Graphics(kit.pipEmpty)),
    );
  }

  get text(): Text {
    return this.count;
  }

  set(spec: TokenSpec): void {
    const key = specKey(spec);
    if (key === this.key) return;
    this.key = key;
    const { counts } = spec;
    const full = counts !== null;
    this.plate.context = (full ? this.kit.plateFull : this.kit.plateCompact)[spec.owner];

    const n = spec.modes.length;
    this.glyphs.forEach((glyph, i) => {
      const mode = spec.modes[i];
      glyph.visible = mode !== undefined;
      if (mode === undefined) return;
      glyph.context = this.kit.glyph[mode];
      if (full) {
        glyph.scale.set(n > 1 ? 0.75 : 1);
        glyph.position.set(n > 1 ? -21 + i * 8 : -19, TOKEN_TOP_ROW_Y);
      } else {
        glyph.scale.set(0.8);
        glyph.position.set((i - (n - 1) / 2) * 11, 0);
      }
    });

    this.count.visible = full;
    const layout = full ? pipLayout(counts.units, counts.charged) : { pips: [], scaled: false };
    if (full) {
      this.count.text = countLabel(counts.units, counts.charged);
      this.count.position.set(TOKEN_FULL.width / 2 - 5, TOKEN_TOP_ROW_Y);
    }
    this.pips.forEach((pip, i) => {
      const at = layout.pips[i];
      pip.visible = at !== undefined;
      if (at === undefined) return;
      pip.context = at.filled ? this.kit.pipFilled[spec.owner] : this.kit.pipEmpty;
      pip.position.set(at.x, at.y);
    });
  }
}
