import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { tf, getLocale } from '../i18n/index.ts';
import { formatSeconds } from '../hud/format.ts';
import type { RenderFrame } from '../net/interpolate.ts';
import type { MapFile, PlayerId, SnapshotMsg } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import type { SupplyOverlay } from './interaction.ts';
import { warehouseSegments } from './cityLayout.ts';
import type { MapLayers } from './layers.ts';
import {
  EDGE_PROGRESS,
  arrowGeometry,
  dashSegments,
  edgeEnds,
  edgePoint,
  nodePoint,
} from './layout.ts';
import { drawWarehouseBar } from './shapes.ts';
import {
  ARROW_OUTLINE,
  BG,
  ENEMY,
  PAPER,
  SELECT_COLOR,
  SELECT_WIDTH,
  SUPPLY_CUT,
  SUPPLY_FLOW,
  SUPPLY_FLOW_LABEL,
  SUPPLY_MARKER,
  SUPPLY_PACKET_RADIUS,
  SUPPLY_PRESENCE,
  SUPPLY_STOCK,
  SUPPLY_TRANSFER,
  WARN,
  YOU,
} from './style.ts';
import {
  edgeIndex,
  lanePoint,
  supplyScene,
  type EdgeIndex,
  type SupplyScene,
} from './supplyLayout.ts';

const TARGET = { dash: 6, gap: 5, ring: 7 } as const;
const STARVE_MARK = '✂';

const polar = (centre: Point, radius: number, degrees: number): Point => {
  const rad = (degrees * Math.PI) / 180;
  return { x: centre.x + radius * Math.cos(rad), y: centre.y + radius * Math.sin(rad) };
};

/**
 * The «Supply» map layer (DEC-28, item 8; Tab or F2): a flat, minimal picture of the supply on a
 * layer of its own. While it is on the scene hides the terrain, the groups, the intents, the fog
 * and the effects; this view draws what the supply is about and nothing else:
 *
 * - the warehouses of own cities as the squares of the normal map (filled: a charge held, grey:
 *   room), under the city;
 * - the front markers as flags with their number on the city;
 * - the own packets: a dot (a square for a transfer) gliding along its road, and one arrow per
 *   road and direction with the number of charges on it (solid: the automatics, dashed and wider:
 *   a transfer), so the flows to one city may come by different roads;
 * - own cities cut off from the capital: a dashed ring and the time to the next starvation;
 * - the enemy as presence only: a hollow triangle where it is seen now, without a number.
 *
 * The level of a road is its thickness on the road layer (`MapView`). While a transfer is being
 * picked, the source is ringed and the cities a click would pick get dashed rings.
 *
 * The snapshot part is redrawn only when the snapshot or the overlay changes; the packet dots every
 * frame. Nothing is computed that the server did not send.
 */
export class SupplyView {
  private readonly root = new Container({ label: 'supply-map' });
  private readonly arrows = new Graphics();
  private readonly plates = new Graphics();
  private readonly dots = new Graphics();
  private readonly texts = new Container({ label: 'supply-texts' });
  private readonly pool: Text[] = [];
  private readonly style: TextStyle;
  private readonly flagStyle: TextStyle;
  private readonly index: EdgeIndex;
  private base: SnapshotMsg | null = null;
  private overlay: SupplyOverlay | null = null;
  private used = 0;
  private tickHz = 10;
  private resolution = 1;

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    private readonly me: PlayerId,
    private readonly radiusOf: (node: number) => number,
  ) {
    this.index = edgeIndex(map);
    this.style = new TextStyle({
      fontFamily: 'system-ui, sans-serif',
      fontSize: SUPPLY_FLOW_LABEL.fontSize,
      fontWeight: '700',
      fill: PAPER,
    });
    this.flagStyle = new TextStyle({
      fontFamily: 'system-ui, sans-serif',
      fontSize: SUPPLY_MARKER.font,
      fontWeight: '800',
      fill: PAPER,
    });
    this.root.addChild(this.arrows, this.plates, this.dots, this.texts);
    this.root.visible = false;
    layers.layer.supply.addChild(this.root);
  }

  setTickHz(tickHz: number): void {
    if (tickHz === this.tickHz) return;
    this.tickHz = tickHz;
    // The next update rebuilds the timers.
    this.base = null;
  }

  setLabelResolution(resolution: number): void {
    this.resolution = resolution;
    for (const text of this.pool) text.resolution = resolution;
  }

  /** `supply`: the overlay of the mode (`null`: the normal map, the layer is hidden). */
  update(frame: RenderFrame | null, supply: SupplyOverlay | null): void {
    const on = supply !== null && frame !== null;
    if (this.root.visible !== on) this.root.visible = on;
    if (!on) {
      if (this.base !== null) {
        this.base = null;
        this.overlay = null;
        this.clear();
      }
      return;
    }
    if (frame.base !== this.base || supply !== this.overlay) {
      this.base = frame.base;
      this.overlay = supply;
      this.drawStatic(supplyScene(frame.base.view, this.me, this.index), supply);
    }
    this.drawPackets(frame);
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.pool.length = 0;
    this.style.destroy();
    this.flagStyle.destroy();
  }

  private clear(): void {
    this.arrows.clear();
    this.plates.clear();
    this.dots.clear();
    this.used = 0;
    for (const text of this.pool) text.visible = false;
  }

  private point(node: number): Point | undefined {
    return nodePoint(this.map, node);
  }

  /** The next text of the pool, set and placed (anchor 0.5). */
  private text(content: string, at: Point, style: TextStyle = this.style): Text {
    let text = this.pool[this.used];
    if (text === undefined) {
      text = new Text({ text: '', style, anchor: 0.5, resolution: this.resolution });
      this.texts.addChild(text);
      this.pool.push(text);
    }
    this.used++;
    if (text.style !== style) text.style = style;
    if (text.text !== content) text.text = content;
    text.position.set(at.x, at.y);
    text.visible = true;
    return text;
  }

  private plate(at: Point, width: number): void {
    const { height, radius } = SUPPLY_FLOW_LABEL;
    this.plates
      .roundRect(at.x - width / 2, at.y - height / 2, width, height, radius)
      .fill({ color: BG, alpha: 0.92 })
      .stroke({ width: 1.5, color: YOU });
  }

  private drawStatic(scene: SupplyScene, supply: SupplyOverlay): void {
    this.clear();
    this.drawFlows(scene);
    this.drawStocks(scene);
    this.drawMarkers(scene);
    this.drawCut(scene);
    this.drawPresence(scene);
    this.drawPick(supply);
  }

  private drawFlows(scene: SupplyScene): void {
    const g = this.arrows;
    for (const flow of scene.flows) {
      const a = this.point(flow.from);
      const b = this.point(flow.to);
      if (a === undefined || b === undefined) continue;
      const lane = SUPPLY_FLOW.lane;
      const arrow = arrowGeometry(
        lanePoint(a, b, 0, lane),
        lanePoint(a, b, 1, lane),
        this.radiusOf(flow.from) + 3,
        this.radiusOf(flow.to) + 3,
        SUPPLY_FLOW.head.length,
        SUPPLY_FLOW.head.width,
      );
      if (arrow === null) continue;
      const width = flow.transfer ? SUPPLY_TRANSFER.width : SUPPLY_FLOW.width;
      for (const pass of [
        { width: width + ARROW_OUTLINE.width - 3, color: BG, alpha: ARROW_OUTLINE.alpha },
        { width, color: YOU, alpha: SUPPLY_FLOW.alpha },
      ]) {
        if (flow.transfer) {
          for (const [s, e] of dashSegments(
            arrow.start,
            arrow.end,
            SUPPLY_TRANSFER.dash,
            SUPPLY_TRANSFER.gap,
          )) {
            g.moveTo(s.x, s.y).lineTo(e.x, e.y);
          }
        } else {
          g.moveTo(arrow.start.x, arrow.start.y).lineTo(arrow.end.x, arrow.end.y);
        }
        g.stroke({ width: pass.width, color: pass.color, alpha: pass.alpha, cap: 'round' });
        g.poly([arrow.head[0], arrow.head[1], arrow.head[2]]).fill({
          color: pass.color,
          alpha: pass.alpha,
        });
      }
      // The volume: a number on a small plate in the middle of the arrow.
      const mid = { x: (arrow.start.x + arrow.end.x) / 2, y: (arrow.start.y + arrow.end.y) / 2 };
      const label = this.text(String(flow.charges), mid);
      this.plate(mid, Math.max(SUPPLY_FLOW_LABEL.height, label.width + 2 * SUPPLY_FLOW_LABEL.padX));
    }
  }

  private drawStocks(scene: SupplyScene): void {
    for (const { node, stock, cap } of scene.stocks) {
      const at = this.point(node);
      if (at === undefined || cap <= 0) continue;
      // The same bar as on the normal map (`drawWarehouseBar`): a square per unit of capacity.
      drawWarehouseBar(
        this.plates,
        warehouseSegments(stock, cap),
        at.x,
        at.y + this.radiusOf(node) + SUPPLY_STOCK.gap,
        YOU,
      );
    }
  }

  private drawMarkers(scene: SupplyScene): void {
    const g = this.plates;
    const { pole, flag, angle, gap } = SUPPLY_MARKER;
    for (const { marker, node } of scene.markers) {
      const city = this.point(node);
      if (city === undefined) continue;
      const foot = polar(city, this.radiusOf(node) + gap, angle);
      const top = { x: foot.x, y: foot.y - pole };
      g.moveTo(foot.x, foot.y).lineTo(top.x, top.y).stroke({ width: 4, color: BG, cap: 'round' });
      g.moveTo(foot.x, foot.y)
        .lineTo(top.x, top.y)
        .stroke({ width: 2, color: PAPER, cap: 'round' });
      // The flag carries the number of the marker: told by the number, not only by the colour.
      g.rect(top.x, top.y, flag.width, flag.height).fill(YOU).stroke({ width: 1.5, color: PAPER });
      this.text(
        String(marker + 1),
        { x: top.x + flag.width / 2, y: top.y + flag.height / 2 },
        this.flagStyle,
      );
    }
  }

  private drawCut(scene: SupplyScene): void {
    const g = this.plates;
    for (const { node, ticks } of scene.cut) {
      const at = this.point(node);
      if (at === undefined) continue;
      const radius = this.radiusOf(node) + SUPPLY_CUT.gap;
      const dashes = Math.max(10, Math.round((2 * Math.PI * radius) / SUPPLY_CUT.dash));
      for (let i = 0; i < dashes; i++) {
        const from = (2 * Math.PI * i) / dashes;
        g.moveTo(at.x + radius * Math.cos(from), at.y + radius * Math.sin(from)).arc(
          at.x,
          at.y,
          radius,
          from,
          from + Math.PI / dashes,
        );
      }
      g.stroke({ width: SUPPLY_CUT.width, color: WARN });
      // The cut and the time to the next starvation (the number is the server's `starve_in`).
      const seconds = formatSeconds(ticks, this.tickHz, getLocale());
      const text = `${STARVE_MARK} ${tf('starve.pill', { seconds })}`;
      const spot = { x: at.x, y: at.y + radius + 16 };
      const label = this.text(text, spot);
      const width = label.width + 2 * SUPPLY_FLOW_LABEL.padX;
      const { height, radius: corner } = SUPPLY_FLOW_LABEL;
      g.roundRect(spot.x - width / 2, spot.y - height / 2, width, height, corner)
        .fill({ color: BG, alpha: 0.94 })
        .stroke({ width: 1.5, color: WARN });
    }
  }

  private drawPresence(scene: SupplyScene): void {
    const g = this.plates;
    const { side, width, angle, gap } = SUPPLY_PRESENCE;
    const h = (side * Math.sqrt(3)) / 2;
    for (const mark of scene.presence) {
      let at: Point | undefined;
      if (mark.kind === 'node') {
        const city = this.point(mark.id);
        at = city && polar(city, this.radiusOf(mark.id) + gap, angle);
      } else {
        const ends = edgeEnds(this.map, mark.id);
        at = ends && edgePoint(ends.a, ends.b, true, 500);
      }
      if (at === undefined) continue;
      // A hollow inverted triangle (the sign of a unit) in the enemy colour: "he is here".
      g.poly([at.x - side / 2, at.y - h / 2, at.x + side / 2, at.y - h / 2, at.x, at.y + h / 2])
        .fill({ color: BG, alpha: 0.9 })
        .stroke({ width, color: ENEMY, join: 'round' });
    }
  }

  private drawPick(supply: SupplyOverlay): void {
    const g = this.plates;
    if (supply.source === null) return;
    const source = this.point(supply.source);
    if (source !== undefined) {
      const r = this.radiusOf(supply.source) + TARGET.ring;
      g.circle(source.x, source.y, r + SELECT_WIDTH).stroke({ width: 2, color: BG });
      g.circle(source.x, source.y, r).stroke({ width: SELECT_WIDTH, color: SELECT_COLOR });
    }
    for (const node of supply.targets) {
      const at = this.point(node);
      if (at === undefined) continue;
      const r = this.radiusOf(node) + TARGET.ring;
      const steps = Math.max(8, Math.round((2 * Math.PI * r) / (TARGET.dash + TARGET.gap)));
      for (let i = 0; i < steps; i++) {
        const a0 = (i / steps) * 2 * Math.PI;
        const a1 = a0 + (TARGET.dash / (TARGET.dash + TARGET.gap)) * ((2 * Math.PI) / steps);
        g.moveTo(at.x + r * Math.cos(a0), at.y + r * Math.sin(a0));
        g.arc(at.x, at.y, r, a0, a1);
      }
      g.stroke({ width: 2, color: SELECT_COLOR, alpha: 0.9 });
    }
  }

  /** Every frame: the own packets on their roads (a dot, or a square for a transfer). */
  private drawPackets(frame: RenderFrame): void {
    const g = this.dots;
    g.clear();
    const r = SUPPLY_PACKET_RADIUS;
    for (const { packet, owner, progress } of frame.packets) {
      if (owner !== undefined && owner !== this.me) continue;
      const ends = edgeEnds(this.map, packet.edge);
      const edge = this.map.edges[packet.edge];
      if (ends === undefined || edge === undefined) continue;
      const fromIsA = edge.a === packet.from_node;
      const from = fromIsA ? ends.a : ends.b;
      const to = fromIsA ? ends.b : ends.a;
      const at = lanePoint(
        from,
        to,
        Math.min(1, Math.max(0, progress / EDGE_PROGRESS)),
        SUPPLY_FLOW.lane,
      );
      if (packet.transfer) g.rect(at.x - r, at.y - r, 2 * r, 2 * r);
      else g.circle(at.x, at.y, r);
      g.fill(PAPER).stroke({ width: 1.5, color: BG });
    }
  }
}
