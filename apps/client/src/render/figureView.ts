import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { RenderEnemy } from '../net/interpolate.ts';
import type { MapFile, PlayerId } from '../protocol.gen.ts';
import { symbolScale, type Point } from './camera.ts';
import {
  cameOutOfFog,
  dissolveAlpha,
  entryMarks,
  FIGURE,
  headCorners,
  heading,
  plateText,
} from './figureLayout.ts';
import { borderPermille, borderPoint } from './fogLayout.ts';
import { edgeEnds, edgePoint, LANE_OFFSET, sideways } from './layout.ts';
import { reducedMotion } from './motion.ts';
import { knownOfFigure } from './rangeLabel.ts';
import { Token, type EntityKit } from './shapes.ts';
import { BG, ENEMY, PAPER, PLATE_FILL } from './style.ts';

/** One enemy figure on a half of a road: its container sits on its lane of the road. */
interface Figure {
  readonly edge: number;
  readonly view: Container;
  readonly token: Token;
  readonly head: Graphics;
  readonly plate: Container;
  readonly plateBack: Graphics;
  readonly plateText: Text;
  /** Which way the head was drawn: `toward_b` of the figure. */
  towardB: boolean | null;
  stamp: number;
}

/** A figure that came out of the fog: its ring and tick on the border point. */
interface Entry {
  readonly edge: number;
  readonly half: 0 | 1;
  /** Render tick the figure was first seen at. */
  readonly tick: number;
}

/**
 * The enemy figures of the roads in sight (DEC-33), EF2 "Pointer" with "Dissolve and marks" (#354,
 * ui-style 27): every figure of the frame is a ▽ token (the level by its outline and its «?»), a solid
 * pointer head in front of it (the nearest node it goes to, `toward_b`) and a plate with the level
 * under it («4 · 3●» exact, «3-5» range, none at presence). The figure fades in over `FIGURE.dissolve`
 * units from the border point, so it never pops out of the haze. A figure first seen near the border
 * point came out of the fog there: one ring spreads from the point and a tick stays on it for 2 s.
 * Leaving into the fog is the memory ghost of the half (`FogView`), which carries a dashed tick on the
 * same point.
 *
 * Everything is drawn from the frame's `RenderEnemy`: position, direction and level are the server's.
 * A new `id` is a new figure; a figure that is gone is destroyed. Pools: the figure objects live as
 * long as the figure, the marks are one Graphics redrawn each frame.
 */
export class FigureView {
  private readonly figures = new Map<string, Figure>();
  private readonly entries: Entry[] = [];
  private readonly marks = new Graphics({ label: 'figure-marks' });
  private readonly style: TextStyle;
  private stamp = 0;
  private started = false;
  /** The marks Graphics holds something now. */
  private marked = false;

  constructor(
    private readonly map: MapFile,
    private readonly layer: Container,
    /** Where the ring and the tick on a border point go (the layer of the enemy figures keeps only figures). */
    marksLayer: Container,
    private readonly kit: EntityKit,
    private readonly enemy: PlayerId,
    private labelResolution: number,
  ) {
    this.style = new TextStyle({
      fontFamily: 'system-ui, sans-serif',
      fontSize: FIGURE.plate.fontSize,
      fontWeight: '700',
      fill: PAPER,
    });
    marksLayer.addChild(this.marks);
  }

  /** Every token of a figure (for the labels' resolution and the swell of a hit). */
  tokens(): Token[] {
    return [...this.figures.values()].map((figure) => figure.token);
  }

  labels(): Text[] {
    return [...this.figures.values()].flatMap((f) => [...f.token.labels(), f.plateText]);
  }

  setLabelResolution(resolution: number): void {
    this.labelResolution = resolution;
    for (const figure of this.figures.values()) figure.plateText.resolution = resolution;
  }

  /** Where each figure is drawn now, by its road (the effects of a fight go over them). */
  spots(): { edge: number; at: Point; token: Token; view: Container }[] {
    return [...this.figures.values()].map((f) => ({
      edge: f.edge,
      at: { x: f.view.x, y: f.view.y },
      token: f.token,
      view: f.view,
    }));
  }

  /** The figures of this frame. `tick` is the render tick, `tickHz` its rate, `cameraScale` the zoom. */
  update(
    enemies: readonly RenderEnemy[],
    tick: number,
    tickHz: number,
    cameraScale: number,
    stamp: number,
  ): void {
    this.stamp = stamp;
    const first = !this.started;
    this.started = true;
    for (const { edge, figure, pos } of enemies) {
      const ends = edgeEnds(this.map, edge);
      if (ends === undefined) continue;
      const border = borderPermille(this.map, edge);
      const length = Math.hypot(ends.b.x - ends.a.x, ends.b.y - ends.a.y);
      const distance = (Math.abs(pos - border) / 1000) * length;
      let entry = this.figures.get(figure.id);
      if (entry === undefined) {
        entry = this.create(edge);
        this.figures.set(figure.id, entry);
        // Not on the first frame (a figure already there when the view started did not just arrive).
        if (!first && cameOutOfFog(distance)) {
          this.entries.push({ edge, half: pos < border ? 0 : 1, tick });
        }
      }
      entry.stamp = stamp;
      const { token } = entry;
      const { counts, range } = knownOfFigure(figure);
      token.set({ owner: this.enemy, modes: [figure.mode], counts, range, inside: false });
      token.setLabel(false);
      const scale = symbolScale(token.side, cameraScale);
      entry.view.scale.set(scale);
      const dir = heading(ends.a, ends.b, figure.toward_b);
      if (entry.towardB !== figure.toward_b) {
        entry.towardB = figure.toward_b;
        this.drawHead(entry.head, dir);
      }
      this.setPlate(entry, plateText(figure));
      entry.view.alpha = dissolveAlpha(distance);
      const at = edgePoint(ends.a, ends.b, true, pos);
      const [from, to] = figure.toward_b ? [ends.a, ends.b] : [ends.b, ends.a];
      const lane = sideways(from, to, at, LANE_OFFSET);
      entry.view.position.set(lane.x, lane.y);
    }
    for (const [id, figure] of this.figures) {
      if (figure.stamp === stamp) continue;
      figure.view.destroy({ children: true });
      this.figures.delete(id);
    }
    this.drawMarks(tick, tickHz);
  }

  destroy(): void {
    this.marks.destroy();
    for (const figure of this.figures.values()) figure.view.destroy({ children: true });
    this.figures.clear();
    this.style.destroy();
  }

  private create(edge: number): Figure {
    const view = new Container({ label: 'enemy-figure' });
    const token = new Token(this.kit, this.labelResolution);
    const head = new Graphics();
    const plate = new Container({ visible: false });
    const plateBack = new Graphics();
    const text = new Text({
      text: '',
      style: this.style,
      anchor: 0.5,
      resolution: this.labelResolution,
    });
    plate.addChild(plateBack, text);
    plate.position.set(0, FIGURE.plate.drop);
    // The head is drawn first so the token covers its base.
    view.addChild(head, token.view, plate);
    this.layer.addChild(view);
    return {
      edge,
      view,
      token,
      head,
      plate,
      plateBack,
      plateText: text,
      towardB: null,
      stamp: this.stamp,
    };
  }

  private drawHead(g: Graphics, dir: Point): void {
    const points = headCorners(dir).flatMap((p) => [p.x, p.y]);
    // A dark casing under the light outline: the head reads on the red of the enemy's territory.
    g.clear()
      .poly(points)
      .stroke({ width: 4, color: BG, join: 'round' })
      .poly(points)
      .fill(ENEMY)
      .stroke({ width: 1.6, color: PAPER, join: 'round' });
  }

  private setPlate(figure: Figure, text: string | null): void {
    figure.plate.visible = text !== null;
    if (text === null || figure.plateText.text === text) return;
    figure.plateText.text = text;
    const { height, padX } = FIGURE.plate;
    const width = figure.plateText.width + 2 * padX;
    figure.plateBack
      .clear()
      .roundRect(-width / 2, -height / 2, width, height, 4)
      .fill({ color: PLATE_FILL, alpha: 0.95 })
      .stroke({ width: 1.4, color: ENEMY });
  }

  /** The ring and the tick of the figures that came out of the fog in the last 2 s, on their border points. */
  private drawMarks(tick: number, tickHz: number): void {
    const g = this.marks;
    // Nothing to draw and nothing drawn: no work every frame.
    if (this.entries.length === 0 && !this.marked) return;
    g.clear();
    this.marked = this.entries.length > 0;
    const reduced = reducedMotion();
    const { tickSeconds, tickHalf } = FIGURE.entry;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (entry === undefined) continue;
      const age = tickHz > 0 ? (tick - entry.tick) / tickHz : tickSeconds;
      if (age >= tickSeconds) {
        this.entries.splice(i, 1);
        continue;
      }
      const at = borderPoint(this.map, entry.edge);
      const ends = edgeEnds(this.map, entry.edge);
      if (at === undefined || ends === undefined) continue;
      const marks = entryMarks(age, reduced);
      const dir = heading(ends.a, ends.b, entry.half === 1);
      // The visible half is the one the figure is in: the chevron points into it.
      const inward = entry.half === 0 ? { x: -dir.x, y: -dir.y } : dir;
      if (marks.ring !== null) {
        g.circle(at.x, at.y, marks.ring.radius).stroke({
          width: 2.4,
          color: ENEMY,
          alpha: marks.ring.alpha,
        });
      }
      if (marks.tick !== null) {
        const nx = -dir.y * tickHalf;
        const ny = dir.x * tickHalf;
        g.moveTo(at.x - nx, at.y - ny)
          .lineTo(at.x + nx, at.y + ny)
          .stroke({ width: 3.4, color: ENEMY, alpha: marks.tick.alpha, cap: 'round' });
        // A small chevron beside the tick, into the visible half.
        const cx = at.x + inward.x * 6;
        const cy = at.y + inward.y * 6;
        const px = -inward.y * 5;
        const py = inward.x * 5;
        g.moveTo(cx - inward.x * 5 + px, cy - inward.y * 5 + py)
          .lineTo(cx, cy)
          .lineTo(cx - inward.x * 5 - px, cy - inward.y * 5 - py)
          .stroke({ width: 2, color: PAPER, alpha: marks.tick.alpha, cap: 'round', join: 'round' });
      }
    }
  }
}
