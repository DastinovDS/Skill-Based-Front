import { HELMET_SCALE, helmet } from '../units/helmet.ts';
import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { t } from '../i18n/index.ts';
import type { RenderFrame } from '../net/interpolate.ts';
import type { MapFile, PlayerId, SnapshotMsg, View } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import type { BakedSprite, SpriteCache } from './bake.ts';
import { starveMarkSpec } from './bakedShapes.ts';
import {
  CANAL,
  canalHachures,
  canalHead,
  canalPhase,
  canalRails,
  canalSpan,
  turnedSquare,
  type CanalSpan,
} from './canalLayout.ts';
import { ringRadius } from './cityLayout.ts';
import {
  downhillRoads,
  levelNodes,
  packetRoads,
  pocketNodes,
  roadKey,
  starvingNodes,
} from './flowLayout.ts';
import { starvePoint } from './flowView.ts';
import { EDGE_PROGRESS, edgeEnds, edgePoint, nodePoint } from './layout.ts';
import type { MapLayers } from './layers.ts';
import { reducedMotion } from './motion.ts';
import { pieceFamily, usePieceFont } from './pieceFont.ts';
import { circleHatch } from './pipeLayout.ts';
import { BG, CASING, CUT, ENEMY, FLOW_LAYER, INK, SUPPLY_PRESENCE, YOU } from './style.ts';
import { edgeIndex, lanePoint, presenceOf, type EdgeIndex } from './supplyLayout.ts';

/** A plate on the map (a label of the supply view): dark, a thin ivory rule inside. */
const PLATE = { fill: 0x0e0c09, alpha: 0.94, rule: 0.8, ruleAlpha: 0.55 } as const;

/** A downhill road as a canal: where it lies, and whether an own packet is on it now. */
interface Canal {
  readonly span: CanalSpan;
  readonly busy: boolean;
}

const polar = (centre: Point, radius: number, degrees: number): Point => {
  const rad = (degrees * Math.PI) / 180;
  return { x: centre.x + radius * Math.cos(rad), y: centre.y + radius * Math.sin(rad) };
};

/**
 * The «Supply» map layer (DEC-43; Tab or F2): the "Canal" of #858 (#829, ui-style 54f). The map keeps
 * its picture (`MapView` darkens the own land and crosshatches the nodes ahead of the level, the
 * cities keep their warehouse lozenges), and this view draws every downhill road as a canal from ring
 * to ring, its hachures running downhill while an own packet is on it, a ring round each node of the
 * level, the own packets as engraved squares riding the canals, the starving sign, a pocket and the
 * enemy's presence. While it is on the scene hides the terrain, the groups, the intents, the fog and
 * the effects; this view draws what the supply is about and nothing else.
 *
 * The snapshot part is redrawn only when the snapshot changes; the running hachures when their phase
 * moves (never with "less motion"), the packets every frame.
 *
 * Nothing is computed that the server did not send.
 */
export class SupplyView {
  private readonly root = new Container({ label: 'supply-map' });
  /**
   * The canals lie on the road layer, under the cities and their names (a canal never covers a
   * caption), and show in the «Supply» mode only; everything else is on the `supply` layer.
   */
  private readonly pipeRoot = new Container({ label: 'supply-pipes' });
  private readonly pipes = new Graphics();
  /** The running hachures of the canals with a packet on them: redrawn when their phase moves. */
  private readonly canalRun = new Graphics({ label: 'canal-run' });
  private canals: readonly Canal[] = [];
  private readonly plates = new Graphics();
  private readonly dots = new Graphics();
  private readonly bangs: BakedSprite[] = [];
  private usedBangs = 0;
  /** The starving marks: baked sprites, one pool. */
  private readonly marks = new Container({ label: 'supply-marks' });
  private readonly texts = new Container({ label: 'supply-texts' });
  private readonly pool: Text[] = [];
  private readonly style: TextStyle;
  private readonly index: EdgeIndex;
  private base: SnapshotMsg | null = null;
  private phase = Number.NaN;
  private used = 0;
  private tickHz = 10;
  private resolution = 1;

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    private readonly me: PlayerId,
    private readonly radiusOf: (node: number) => number,
    private readonly sprites: SpriteCache,
  ) {
    this.index = edgeIndex(map);
    this.style = new TextStyle({
      fontFamily: pieceFamily(),
      fontSize: 12.5,
      fontWeight: '600',
      fill: INK,
    });
    usePieceFont([this.style]);
    this.pipeRoot.addChild(this.pipes, this.canalRun);
    this.pipeRoot.visible = false;
    layers.layer.roads.addChild(this.pipeRoot);
    this.root.addChild(this.plates, this.marks, this.dots, this.texts);
    this.root.visible = false;
    layers.layer.supply.addChild(this.root);
  }

  setTickHz(tickHz: number): void {
    if (tickHz === this.tickHz) return;
    this.tickHz = tickHz;
    // The next update rebuilds the picture.
    this.base = null;
  }

  setLabelResolution(resolution: number): void {
    this.resolution = resolution;
    for (const text of this.pool) text.resolution = resolution;
  }

  /** `supply`: the «Supply» mode is on (`false`: the normal map, the layer is hidden). */
  update(frame: RenderFrame | null, supply: boolean): void {
    const on = supply && frame !== null;
    if (this.root.visible !== on) this.root.visible = on;
    if (this.pipeRoot.visible !== on) this.pipeRoot.visible = on;
    if (!on) {
      if (this.base !== null) {
        this.base = null;
        this.clear();
      }
      return;
    }
    if (frame.base !== this.base) {
      this.base = frame.base;
      this.drawStatic(frame.base.view);
    }
    this.drawCanalRun(frame);
    this.drawPackets(frame);
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.pipeRoot.destroy({ children: true });
    this.pool.length = 0;
    this.style.destroy();
  }

  private clear(): void {
    this.pipes.clear();
    this.canalRun.clear();
    this.canals = [];
    this.plates.clear();
    this.dots.clear();
    this.usedBangs = 0;
    for (const bang of this.bangs) bang.visible = false;
    this.phase = Number.NaN;
    this.used = 0;
    for (const text of this.pool) text.visible = false;
  }

  private point(node: number): Point | undefined {
    return nodePoint(this.map, node);
  }

  /** The next text of the pool, set and placed in the middle of `at`. */
  private text(content: string, at: Point): Text {
    let text = this.pool[this.used];
    if (text === undefined) {
      text = new Text({ text: '', style: this.style, anchor: 0.5, resolution: this.resolution });
      this.texts.addChild(text);
      this.pool.push(text);
    }
    this.used++;
    if (text.text !== content) text.text = content;
    text.position.set(at.x, at.y);
    text.visible = true;
    return text;
  }

  private drawStatic(view: View): void {
    this.clear();
    this.drawCanals(view);
    this.drawFlowNodes(view);
    this.drawPresence(view);
  }

  private drawPresence(view: View): void {
    const g = this.plates;
    const { side, width, angle, gap } = SUPPLY_PRESENCE;
    for (const mark of presenceOf(view)) {
      let at: Point | undefined;
      if (mark.kind === 'node') {
        const city = this.point(mark.id);
        at = city && polar(city, this.radiusOf(mark.id) + gap, angle);
      } else {
        const ends = edgeEnds(this.map, mark.id);
        at = ends && edgePoint(ends.a, ends.b, true, 500);
      }
      if (at === undefined) continue;
      // A hollow enemy helmet facing left (the sign of a unit, #784) in the enemy colour: "he is here".
      const helm = helmet('enemy', side * HELMET_SCALE);
      const place = (p: Point): Point => ({ x: at.x - p.x, y: at.y + p.y });
      helm.strap.map(place).forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
      g.stroke({ width, color: ENEMY, cap: 'round', join: 'round' });
      g.poly(helm.dome.map(place).flatMap((p) => [p.x, p.y]))
        .fill({ color: BG, alpha: 0.9 })
        .stroke({ width, color: ENEMY, join: 'round' });
    }
  }

  /**
   * Every downhill road (`flow_down`) as a canal from ring to ring, under the cities: the casing, the
   * hachures (faint and still on an idle road; those of a road with an own packet on it run in
   * `drawCanalRun`), the two ink rails and the cut V at the receiving ring.
   */
  private drawCanals(view: View): void {
    const g = this.pipes;
    const busy = packetRoads(view);
    const canals: Canal[] = [];
    for (const road of downhillRoads(view, this.me, this.index)) {
      const a = this.point(road.from);
      const b = this.point(road.to);
      if (a === undefined || b === undefined) continue;
      const span = canalSpan(a, b, this.radiusOf(road.from), this.radiusOf(road.to));
      if (span === null) continue;
      canals.push({ span, busy: busy.has(roadKey(road.edge, road.from)) });
    }
    const line = (pair: readonly Point[]): void => {
      const [p, q] = pair as [Point, Point];
      g.moveTo(p.x, p.y).lineTo(q.x, q.y);
    };
    for (const { span } of canals) line([span.a, span.b]);
    g.stroke({ width: 2 * (CANAL.half + CANAL.casing), color: CASING, cap: 'butt' });
    for (const canal of canals) {
      if (!canal.busy) for (const pair of canalHachures(canal.span, 0)) line(pair);
    }
    g.stroke({ width: CANAL.hachure, color: YOU, alpha: CANAL.idleAlpha });
    for (const { span } of canals) for (const rail of canalRails(span)) line(rail);
    g.stroke({ width: CANAL.rail, color: INK });
    for (const { span } of canals) {
      const head = canalHead(span);
      const [first, ...rest] = head;
      if (first === undefined) continue;
      g.moveTo(first.x, first.y);
      for (const p of rest) g.lineTo(p.x, p.y);
    }
    g.stroke({ width: CANAL.head.casing, color: CASING, join: 'miter' });
    for (const { span } of canals) {
      const [first, ...rest] = canalHead(span);
      if (first === undefined) continue;
      g.moveTo(first.x, first.y);
      for (const p of rest) g.lineTo(p.x, p.y);
    }
    g.stroke({ width: CANAL.head.ink, color: INK, join: 'miter' });
    this.canals = canals;
  }

  /** The next sprite of the pool of starving marks. */
  private bang(at: Point): void {
    let sprite = this.bangs[this.usedBangs];
    if (sprite === undefined) {
      sprite = this.sprites.sprite(starveMarkSpec());
      this.marks.addChild(sprite);
      this.bangs.push(sprite);
    }
    this.usedBangs++;
    sprite.position.set(at.x, at.y);
    sprite.visible = true;
  }

  /**
   * The nodes under the flow: a ring round each node of the level (the own colour on a casing and an
   * ink ring outside it), the starving sign, the pocket hatch with "no source". The warehouses are the
   * cities' own lozenges; the nodes ahead of the level are crosshatched by `MapView`.
   */
  private drawFlowNodes(view: View): void {
    const g = this.plates;
    const look = CANAL.level;
    for (const node of levelNodes(view, this.me)) {
      const city = this.point(node);
      if (city === undefined) continue;
      const r = ringRadius(this.radiusOf(node)) + look.gap;
      g.circle(city.x, city.y, r).stroke({ width: look.casing, color: CASING });
      g.circle(city.x, city.y, r).stroke({ width: look.width, color: YOU });
      g.circle(city.x, city.y, ringRadius(this.radiusOf(node)) + look.inkGap).stroke({
        width: look.ink,
        color: INK,
      });
    }
    for (const node of starvingNodes(view, this.me)) {
      const city = this.point(node);
      if (city !== undefined) this.bang(starvePoint(city, this.radiusOf(node)));
    }
    for (const node of pocketNodes(view, this.me)) {
      // A pocket: its own component has no factory, so nothing is made for it.
      const city = this.point(node);
      if (city === undefined) continue;
      const { period, width, alpha, grow } = FLOW_LAYER.pocketHatch;
      const r = this.radiusOf(node) + grow;
      for (const [p, q] of circleHatch(city, r, period)) g.moveTo(p.x, p.y).lineTo(q.x, q.y);
      g.stroke({ width, color: INK, alpha });
      this.plate(t('flow.noSource'), { x: city.x, y: city.y - r - FLOW_LAYER.plate.lift - 6 });
    }
  }

  /** A label on a dark plate, over the other marks (the text pool lies on top of the layer). */
  private plate(content: string, spot: Point): number {
    const label = this.text(content, spot);
    const { height, padX, radius } = FLOW_LAYER.plate;
    const width = label.width + 2 * padX;
    const x = spot.x - width / 2;
    const y = spot.y - height / 2;
    this.plates
      .roundRect(x, y, width, height, radius)
      .fill({ color: PLATE.fill, alpha: PLATE.alpha })
      .stroke({ width: 1.6, color: CUT })
      .roundRect(x + 1.5, y + 1.5, width - 3, height - 3, radius - 1)
      .stroke({ width: PLATE.rule, color: INK, alpha: PLATE.ruleAlpha });
    return width;
  }

  /**
   * The hachures of the canals with an own packet on them run downhill: redrawn when their phase
   * moves (a few times a second, never with "less motion" or in a paused scene).
   */
  private drawCanalRun(frame: RenderFrame): void {
    const busy = this.canals.filter((c) => c.busy);
    const phase =
      busy.length === 0 ? 0 : canalPhase(frame.tick / Math.max(1, this.tickHz), reducedMotion());
    if (phase === this.phase) return;
    this.phase = phase;
    const g = this.canalRun.clear();
    if (busy.length === 0) return;
    for (const { span } of busy) {
      for (const [p, q] of canalHachures(span, phase)) g.moveTo(p.x, p.y).lineTo(q.x, q.y);
    }
    g.stroke({ width: CANAL.hachure, color: YOU });
  }

  /** Every frame: the own packets on the canals: a square of the own colour on a dark casing, turned along the road. */
  private drawPackets(frame: RenderFrame): void {
    const g = this.dots;
    g.clear();
    for (const { packet, owner, progress } of frame.packets) {
      if (owner !== undefined && owner !== this.me) continue;
      const ends = edgeEnds(this.map, packet.edge);
      const edge = this.map.edges[packet.edge];
      if (ends === undefined || edge === undefined) continue;
      const fromIsA = edge.a === packet.from_node;
      const from = fromIsA ? ends.a : ends.b;
      const to = fromIsA ? ends.b : ends.a;
      const at = lanePoint(from, to, Math.min(1, Math.max(0, progress / EDGE_PROGRESS)), 0);
      const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
      const dir = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
      const { casing, fill, outline, ink } = CANAL.packet;
      g.poly(turnedSquare(at, dir, casing)).fill(CASING);
      g.poly(turnedSquare(at, dir, fill)).fill(YOU);
      g.poly(turnedSquare(at, dir, outline)).stroke({ width: ink, color: INK, join: 'miter' });
    }
  }
}
