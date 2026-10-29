import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { tf, getLocale } from '../i18n/index.ts';
import { formatSeconds } from '../hud/format.ts';
import type { RenderFrame } from '../net/interpolate.ts';
import type { MapFile, PlayerId, SnapshotMsg } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import type { SupplyOverlay } from './interaction.ts';
import { borderPoint } from './fogLayout.ts';
import { EDGE_PROGRESS, edgeEnds, edgePoint, nodePoint } from './layout.ts';
import type { MapLayers } from './layers.ts';
import { reducedMotion } from './motion.ts';
import {
  bulkheadLine,
  circleHatch,
  flowBand,
  flowDashes,
  flowPhase,
  headPoly,
  labelPose,
  pipeBore,
  pipeInside,
  pipeSpan,
} from './pipeLayout.ts';
import {
  BG,
  ENEMY,
  PAPER,
  SELECT_COLOR,
  SELECT_WIDTH,
  SUPPLY_BULKHEAD,
  SUPPLY_CUT,
  SUPPLY_FLOW_LABEL,
  SUPPLY_GAUGE,
  SUPPLY_MARKER,
  SUPPLY_PACKET,
  SUPPLY_PIPE,
  SUPPLY_PRESENCE,
  WARN,
  YOU,
} from './style.ts';
import {
  edgeIndex,
  lanePoint,
  supplyScene,
  type EdgeIndex,
  type SupplyFlow,
  type SupplyScene,
} from './supplyLayout.ts';

const TARGET = { dash: 6, gap: 5, ring: 7 } as const;
const STARVE_MARK = '✂';

const polar = (centre: Point, radius: number, degrees: number): Point => {
  const rad = (degrees * Math.PI) / 180;
  return { x: centre.x + radius * Math.cos(rad), y: centre.y + radius * Math.sin(rad) };
};

/** One run of flowing dashes of a pipe: the part of a pipe a flow fills. */
interface FlowRun {
  readonly from: Point;
  readonly to: Point;
  readonly width: number;
}

/**
 * The «Supply» map layer (DEC-28, item 8; Tab or F2): a flat, minimal picture of the supply on a
 * layer of its own, drawn as pipes (#429, variant B of `docs/design/mockups/supply-terrain.html`).
 * While it is on the scene hides the terrain, the groups, the intents, the fog and the effects;
 * this view draws what the supply is about and nothing else:
 *
 * - an own road (both ends own) as a pipe: its level is the bore (three widths, never a hue); a
 *   pipe with a flow is filled, its dashes run in the direction of the flow (opposite flows use
 *   opposite halves), a valve cap marks the destination and the volume is a number lying along it;
 *   the road layer hides those roads (`MapView`), the buffer roads keep theirs and get a
 *   bulkhead at the border point: supply stops there;
 * - the warehouses of own cities as a gauge (a bar and «stock/capacity») under the city;
 * - the front markers as a ring round the city with a badge carrying the number;
 * - the own packets gliding along their pipes: a circle growing with the charges, a transfer a square;
 * - own cities cut off from the capital: hatched, with a dashed ring and the time to the next
 *   starvation;
 * - the enemy as presence only: a hollow triangle where it is seen now, without a number.
 *
 * While a transfer is being picked, the source is ringed and the cities a click would pick get
 * dashed rings. The snapshot part is redrawn only when the snapshot or the overlay changes; the
 * flowing dashes when their phase moves (never with "less motion"), the packets every frame.
 * Nothing is computed that the server did not send.
 */
export class SupplyView {
  private readonly root = new Container({ label: 'supply-map' });
  /**
   * The pipes lie on the road layer, under the cities and their names (a pipe never covers a
   * caption), and show in the «Supply» mode only; everything else is on the `supply` layer.
   */
  private readonly pipeRoot = new Container({ label: 'supply-pipes' });
  private readonly pipes = new Graphics();
  private readonly flowing = new Graphics();
  private readonly plates = new Graphics();
  private readonly dots = new Graphics();
  private readonly texts = new Container({ label: 'supply-texts' });
  private readonly pool: Text[] = [];
  private readonly style: TextStyle;
  private readonly flagStyle: TextStyle;
  private readonly pipeStyle: TextStyle;
  private readonly gaugeStyle: TextStyle;
  private readonly index: EdgeIndex;
  private base: SnapshotMsg | null = null;
  private overlay: SupplyOverlay | null = null;
  private runs: readonly FlowRun[] = [];
  private phase = Number.NaN;
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
    const font = 'system-ui, sans-serif';
    this.style = new TextStyle({
      fontFamily: font,
      fontSize: SUPPLY_FLOW_LABEL.fontSize,
      fontWeight: '700',
      fill: PAPER,
    });
    this.flagStyle = new TextStyle({
      fontFamily: font,
      fontSize: SUPPLY_MARKER.font,
      fontWeight: '800',
      fill: PAPER,
    });
    // The number along a pipe and the figure of a gauge carry a dark halo: they lie on the map.
    this.pipeStyle = new TextStyle({
      fontFamily: font,
      fontSize: SUPPLY_PIPE.labelFont,
      fontWeight: '700',
      fill: PAPER,
      stroke: { color: BG, width: 3, join: 'round' },
    });
    this.gaugeStyle = new TextStyle({
      fontFamily: font,
      fontSize: SUPPLY_GAUGE.font,
      fontWeight: '700',
      fill: PAPER,
      stroke: { color: BG, width: 2.5, join: 'round' },
    });
    this.pipeRoot.addChild(this.pipes);
    this.pipeRoot.visible = false;
    layers.layer.roads.addChild(this.pipeRoot);
    this.root.addChild(this.flowing, this.plates, this.dots, this.texts);
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
    if (this.pipeRoot.visible !== on) this.pipeRoot.visible = on;
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
      this.drawStatic(supplyScene(frame.base.view, this.me, this.index, this.map.edges), supply);
    }
    this.drawFlowing(frame);
    this.drawPackets(frame);
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.pipeRoot.destroy({ children: true });
    this.pool.length = 0;
    this.style.destroy();
    this.flagStyle.destroy();
    this.pipeStyle.destroy();
    this.gaugeStyle.destroy();
  }

  private clear(): void {
    this.pipes.clear();
    this.flowing.clear();
    this.plates.clear();
    this.dots.clear();
    this.runs = [];
    this.phase = Number.NaN;
    this.used = 0;
    for (const text of this.pool) text.visible = false;
  }

  private point(node: number): Point | undefined {
    return nodePoint(this.map, node);
  }

  /**
   * The next text of the pool, set and placed. `anchorX`: 0.5 centres it on `at`, 0 starts it
   * there; `rotation` turns it about `at` (radians).
   */
  private text(
    content: string,
    at: Point,
    style: TextStyle = this.style,
    anchorX = 0.5,
    rotation = 0,
  ): Text {
    let text = this.pool[this.used];
    if (text === undefined) {
      text = new Text({ text: '', style, anchor: 0.5, resolution: this.resolution });
      this.texts.addChild(text);
      this.pool.push(text);
    }
    this.used++;
    if (text.style !== style) text.style = style;
    if (text.text !== content) text.text = content;
    text.anchor.set(anchorX, 0.5);
    text.rotation = rotation;
    text.position.set(at.x, at.y);
    text.visible = true;
    return text;
  }

  private drawStatic(scene: SupplyScene, supply: SupplyOverlay): void {
    this.clear();
    this.drawPipes(scene);
    this.drawFlows(scene);
    this.drawBulkheads(scene);
    this.drawGauges(scene);
    this.drawMarkers(scene);
    this.drawCut(scene);
    this.drawPresence(scene);
    this.drawPick(supply);
  }

  /** Where the pipe of a road lies: from the rim of one city to the rim of the other. */
  private span(a: number, b: number): ReturnType<typeof pipeSpan> {
    const pa = this.point(a);
    const pb = this.point(b);
    if (pa === undefined || pb === undefined) return null;
    return pipeSpan(
      pa,
      pb,
      this.radiusOf(a) + SUPPLY_PIPE.inset,
      this.radiusOf(b) + SUPPLY_PIPE.inset,
    );
  }

  /** The pipes: a dark casing, the wall and the inside (dark idle, blue with a flow in it). */
  private drawPipes(scene: SupplyScene): void {
    const g = this.pipes;
    const active = new Set(scene.flows.map((f) => f.edge));
    for (const pipe of scene.pipes) {
      // From city to city: the cities and their rims are drawn over the ends of the pipe.
      const a = this.point(pipe.a);
      const b = this.point(pipe.b);
      if (a === undefined || b === undefined) continue;
      const span = { start: a, end: b };
      const bore = pipeBore(pipe.level);
      g.moveTo(span.start.x, span.start.y)
        .lineTo(span.end.x, span.end.y)
        .stroke({
          width: bore + 2 * SUPPLY_PIPE.casing,
          color: BG,
          alpha: SUPPLY_PIPE.casingAlpha,
        });
      g.moveTo(span.start.x, span.start.y)
        .lineTo(span.end.x, span.end.y)
        .stroke({ width: bore, color: SUPPLY_PIPE.wallColor });
      g.moveTo(span.start.x, span.start.y)
        .lineTo(span.end.x, span.end.y)
        .stroke({
          width: pipeInside(bore),
          color: active.has(pipe.edge) ? SUPPLY_PIPE.activeColor : SUPPLY_PIPE.idleColor,
        });
    }
  }

  /** The flows: the fill of the pipe, the valve cap at the destination and the number along it. */
  private drawFlows(scene: SupplyScene): void {
    const fill = this.pipes;
    const g = this.plates;
    const runs: FlowRun[] = [];
    const byEdge = new Map<number, SupplyFlow[]>();
    for (const flow of scene.flows) {
      const list = byEdge.get(flow.edge);
      if (list === undefined) byEdge.set(flow.edge, [flow]);
      else list.push(flow);
    }
    for (const [edge, flows] of byEdge) {
      const bore = pipeBore(scene.levels.get(edge) ?? 1);
      // Both directions in use: each fills one half of the pipe.
      const directions = new Set(flows.map((f) => f.from));
      const both = directions.size > 1;
      const band = flowBand(bore, both);
      flows.forEach((flow, slot) => {
        const span = this.span(flow.from, flow.to);
        const a = this.point(flow.from);
        const b = this.point(flow.to);
        if (span === null || a === undefined || b === undefined) return;
        const from = lanePoint(span.start, span.end, 0, band.lane);
        const to = lanePoint(span.start, span.end, 1, band.lane);
        // The fill lies on the pipe under the cities, the dashes and the valve over their rims.
        const whole = [lanePoint(a, b, 0, band.lane), lanePoint(a, b, 1, band.lane)] as const;
        fill
          .moveTo(whole[0].x, whole[0].y)
          .lineTo(whole[1].x, whole[1].y)
          .stroke({ width: band.width, color: YOU, alpha: SUPPLY_PIPE.fillAlpha });
        runs.push({ from, to, width: both ? 1.8 : 2.4 });
        if (span.length < SUPPLY_PIPE.minFlow) return;
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        const ux = (b.x - a.x) / length;
        const uy = (b.y - a.y) / length;
        // The valve cap: a light head with a blue one in it, its tip at the rim of the destination.
        const { outer, inner } = SUPPLY_PIPE.valve;
        g.poly(
          headPoly(to, ux, uy, outer.length, Math.max(outer.minWidth, bore - 1)).flatMap((p) => [
            p.x,
            p.y,
          ]),
        ).fill(PAPER);
        const behind = { x: to.x - ux * 2, y: to.y - uy * 2 };
        g.poly(
          headPoly(behind, ux, uy, inner.length, Math.max(inner.minWidth, bore - 5)).flatMap(
            (p) => [p.x, p.y],
          ),
        ).fill(YOU);
      });
      // The volumes lie along the pipe; the numbers of one road sit apart along it, in the order
      // of its own direction (`a` to `b`) whichever way each flow goes, so they never overlap.
      const road = this.map.edges[edge];
      const ends = road === undefined ? null : this.span(road.a, road.b);
      const pa = road === undefined ? undefined : this.point(road.a);
      const pb = road === undefined ? undefined : this.point(road.b);
      if (road === undefined || ends === null || pa === undefined || pb === undefined) continue;
      if (ends.length < SUPPLY_PIPE.minFlow) continue;
      const middle = this.radiusOf(road.a) + SUPPLY_PIPE.inset + ends.length / 2;
      flows.forEach((flow, slot) => {
        const shift = (slot - (flows.length - 1) / 2) * SUPPLY_PIPE.labelGap;
        const pose = labelPose(pa, pb, middle + shift, bore);
        this.text(
          `${flow.transfer ? '~' : ''}${String(flow.charges)}`,
          pose,
          this.pipeStyle,
          0.5,
          pose.rotation,
        );
      });
    }
    this.runs = runs;
  }

  /** A bulkhead at the border point of a road between an own city and a place that is not own. */
  private drawBulkheads(scene: SupplyScene): void {
    const g = this.pipes;
    for (const { edge, a, b } of scene.bulkheads) {
      const at = borderPoint(this.map, edge);
      const pa = this.point(a);
      const pb = this.point(b);
      if (at === undefined || pa === undefined || pb === undefined) continue;
      const [p, q] = bulkheadLine(pa, pb, at, SUPPLY_BULKHEAD.half);
      g.moveTo(p.x, p.y)
        .lineTo(q.x, q.y)
        .stroke({ width: SUPPLY_BULKHEAD.casing, color: BG, alpha: 0.9 });
      g.moveTo(p.x, p.y)
        .lineTo(q.x, q.y)
        .stroke({ width: SUPPLY_BULKHEAD.width, color: SUPPLY_BULKHEAD.color, alpha: 0.9 });
    }
  }

  /** The warehouse of an own city: a gauge (the filled share of the capacity) and «stock/capacity». */
  private drawGauges(scene: SupplyScene): void {
    const g = this.plates;
    const { width, gap, height, bar, radius, restAlpha } = SUPPLY_GAUGE;
    for (const { node, stock, cap } of scene.stocks) {
      const at = this.point(node);
      if (at === undefined || cap <= 0) continue;
      const x = at.x - width / 2;
      const y = at.y + this.radiusOf(node) + gap;
      const inner = width - 2;
      const filled = (inner * Math.min(cap, Math.max(0, stock))) / cap;
      g.roundRect(x - 1, y - 1, width + 2, height, radius).fill({ color: BG, alpha: 0.85 });
      g.rect(x + 1, y + 1, inner, bar).fill({ color: PAPER, alpha: restAlpha });
      if (filled > 0) g.rect(x + 1, y + 1, filled, bar).fill(YOU);
      this.text(
        `${String(stock)}/${String(cap)}`,
        { x: x + width + 4, y: y + 3.5 },
        this.gaugeStyle,
        0,
      );
    }
  }

  /** A front marker: a ring round the city and a badge with its number (told by the number, not the hue). */
  private drawMarkers(scene: SupplyScene): void {
    const g = this.plates;
    const { ring, ringWidth, badge } = SUPPLY_MARKER;
    for (const { marker, node } of scene.markers) {
      const city = this.point(node);
      if (city === undefined) continue;
      const r = this.radiusOf(node) + ring;
      g.circle(city.x, city.y, r).stroke({ width: ringWidth + 2, color: BG, alpha: 0.9 });
      g.circle(city.x, city.y, r).stroke({ width: ringWidth, color: YOU });
      const top = { x: city.x, y: city.y - this.radiusOf(node) - badge.lift };
      g.circle(top.x, top.y, badge.radius).fill(BG).stroke({ width: 2, color: YOU });
      this.text(String(marker + 1), top, this.flagStyle);
    }
  }

  private drawCut(scene: SupplyScene): void {
    const g = this.plates;
    for (const { node, ticks } of scene.cut) {
      const at = this.point(node);
      if (at === undefined) continue;
      const radius = this.radiusOf(node) + SUPPLY_CUT.gap;
      for (const [p, q] of circleHatch(at, radius, SUPPLY_CUT.hatchPeriod)) {
        g.moveTo(p.x, p.y).lineTo(q.x, q.y);
      }
      g.stroke({ width: SUPPLY_CUT.hatchWidth, color: WARN, alpha: SUPPLY_CUT.hatchAlpha });
      this.dashedRing(at, radius, SUPPLY_CUT.dash, SUPPLY_CUT.gapDash);
      g.stroke({ width: SUPPLY_CUT.width, color: WARN });
      // The cut and the time to the next starvation (the number is the server's `starve_in`).
      const seconds = formatSeconds(ticks, this.tickHz, getLocale());
      const text = `${STARVE_MARK} ${tf('starve.pill', { seconds })}`;
      // The time sits above the city: below it are the gauge and the caption of the city, whose
      // distance in world units changes with the zoom; above a marker's badge takes the place.
      const marked = scene.markers.some((m) => m.node === node);
      const lift =
        radius + SUPPLY_FLOW_LABEL.height / 2 + 2 + (marked ? SUPPLY_MARKER.badge.radius * 2 : 0);
      const spot = { x: at.x, y: at.y - lift };
      const label = this.text(text, spot);
      const width = label.width + 2 * SUPPLY_FLOW_LABEL.padX;
      const { height: plate, radius: corner } = SUPPLY_FLOW_LABEL;
      g.roundRect(spot.x - width / 2, spot.y - plate / 2, width, plate, corner)
        .fill({ color: BG, alpha: 0.94 })
        .stroke({ width: 1.5, color: WARN });
    }
  }

  /** A ring cut into dashes, added to the plates path (the caller strokes it). */
  private dashedRing(at: Point, radius: number, dash: number, gap: number): void {
    const g = this.plates;
    const steps = Math.max(8, Math.round((2 * Math.PI * radius) / (dash + gap)));
    for (let i = 0; i < steps; i++) {
      const a0 = (i / steps) * 2 * Math.PI;
      const a1 = a0 + (dash / (dash + gap)) * ((2 * Math.PI) / steps);
      g.moveTo(at.x + radius * Math.cos(a0), at.y + radius * Math.sin(a0));
      g.arc(at.x, at.y, radius, a0, a1);
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
      this.dashedRing(at, this.radiusOf(node) + TARGET.ring, TARGET.dash, TARGET.gap);
      g.stroke({ width: 2, color: SELECT_COLOR, alpha: 0.9 });
    }
  }

  /**
   * The dashes of the flows run along their pipes. Redrawn only when the phase moves: a frozen
   * scene, a paused match and "less motion" (a constant phase) cost nothing.
   */
  private drawFlowing(frame: RenderFrame): void {
    const phase = flowPhase(frame.tick, this.tickHz, reducedMotion());
    if (phase === this.phase) return;
    this.phase = phase;
    const g = this.flowing.clear();
    for (const run of this.runs) {
      for (const [p, q] of flowDashes(run.from, run.to, SUPPLY_PIPE.dash, SUPPLY_PIPE.gap, phase)) {
        g.moveTo(p.x, p.y).lineTo(q.x, q.y);
      }
      g.stroke({ width: run.width, color: PAPER, alpha: 0.95 });
    }
  }

  /** Every frame: the own packets on their pipes: a circle growing with its charges, a transfer a square. */
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
      if (packet.transfer) {
        const side = SUPPLY_PACKET.transferSide;
        g.roundRect(at.x - side / 2, at.y - side / 2, side, side, 2)
          .fill(PAPER)
          .stroke({ width: 1.5, color: BG });
      } else {
        g.circle(at.x, at.y, SUPPLY_PACKET.radius + SUPPLY_PACKET.perCharge * packet.charges)
          .fill(PAPER)
          .stroke({ width: SUPPLY_PACKET.outline, color: BG });
      }
    }
  }
}
