import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { t } from '../i18n/index.ts';
import { formatSeconds } from '../hud/format.ts';
import { getLocale } from '../i18n/index.ts';
import type { NodeView, PlayerId } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import { arcFill, BEACON, beaconPulse, PILL, pillScale } from './alertLayout.ts';
import type { MapLayers } from './layers.ts';
import { nodePoint } from './layout.ts';
import { reducedMotion } from './motion.ts';
import type { CapacityTicks } from './source.ts';
import { BG, NEUTRAL_STROKE, PAPER, WARN, YOU } from './style.ts';
import type { MapFile } from '../protocol.gen.ts';

/** The minus sign (U+2212) in front of the lost unit. */
const MINUS = '−';
const MAX_PILLS = 12;

interface Pill {
  readonly root: Container;
  readonly arc: Graphics;
  readonly mark: Text;
  readonly label: Text;
}

/**
 * What the map says about overcrowding and about the start (ui-style 12, U4): a pill beside each
 * own city that holds more units than its capacity (an arc that fills until a unit is lost, a `!`
 * and "−1 2.4 s"; grey with the grace time during the grace after a capture), and the pulsing
 * ring around the own capital in the first three seconds of a match. Redrawn every frame (a few
 * shapes); the numbers are the server's.
 */
export class AlertView {
  private readonly root = new Container({ label: 'alerts' });
  private readonly beacon = new Graphics();
  private readonly pills: Pill[] = [];
  private readonly style: TextStyle;
  private readonly markStyle: TextStyle;
  private resolution = 1;
  private cameraScale = 1;

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    private readonly me: PlayerId,
    private readonly radiusOf: (node: number) => number,
  ) {
    this.style = new TextStyle({
      fontFamily: 'system-ui, sans-serif',
      fontSize: 11,
      fontWeight: '700',
      fill: PAPER,
    });
    this.markStyle = new TextStyle({
      fontFamily: 'system-ui, sans-serif',
      fontSize: 11,
      fontWeight: '800',
      fill: BG,
    });
    this.root.addChild(this.beacon);
    layers.layer.effects.addChild(this.root);
  }

  setLabelResolution(resolution: number): void {
    this.resolution = resolution;
    for (const pill of this.pills) {
      pill.mark.resolution = resolution;
      pill.label.resolution = resolution;
    }
  }

  setCameraScale(scale: number): void {
    this.cameraScale = scale;
  }

  /**
   * `nodes` of the snapshot on screen, the `ruleset_public.capacity` numbers (without them no
   * pill), the city to ring (or `null`), and the time for the pulse.
   */
  update(
    nodes: readonly NodeView[],
    tickHz: number,
    capacity: CapacityTicks | null,
    beaconNode: number | null,
    nowMs: number,
  ): void {
    this.drawBeacon(beaconNode, nowMs);
    let used = 0;
    if (capacity !== null) {
      for (const node of nodes) {
        if (node.owner !== this.me) continue;
        if (node.attrition_in === null && node.grace_left === null) continue;
        if (used >= MAX_PILLS) break;
        this.place(this.pill(used), node, tickHz, capacity);
        used++;
      }
    }
    for (let i = used; i < this.pills.length; i++) {
      const pill = this.pills[i];
      if (pill !== undefined) pill.root.visible = false;
    }
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.pills.length = 0;
  }

  private drawBeacon(node: number | null, nowMs: number): void {
    const g = this.beacon;
    g.clear();
    const at = node === null ? undefined : nodePoint(this.map, node);
    if (node === null || at === undefined) return;
    const base = this.radiusOf(node) + BEACON.gap;
    const radius = base * (1 + BEACON.grow * beaconPulse(nowMs, reducedMotion()));
    g.circle(at.x, at.y, radius).stroke({ width: BEACON.width, color: YOU });
    g.circle(at.x, at.y, radius + BEACON.width + 1).stroke({
      width: BEACON.outerWidth,
      color: PAPER,
      alpha: 0.9,
    });
  }

  private pill(index: number): Pill {
    const existing = this.pills[index];
    if (existing !== undefined) return existing;
    const root = new Container({ label: 'overflow-pill' });
    const arc = new Graphics();
    const mark = new Text({
      text: '!',
      style: this.markStyle,
      anchor: 0.5,
      resolution: this.resolution,
    });
    const label = new Text({
      text: '',
      style: this.style,
      anchor: { x: 0, y: 0.5 },
      resolution: this.resolution,
    });
    root.addChild(arc, mark, label);
    this.root.addChild(root);
    const pill = { root, arc, mark, label };
    this.pills.push(pill);
    return pill;
  }

  private place(pill: Pill, node: NodeView, tickHz: number, capacity: CapacityTicks): void {
    const at: Point | undefined = nodePoint(this.map, node.id);
    if (at === undefined) return;
    const graceOnly = node.attrition_in === null;
    const ticks = node.attrition_in ?? node.grace_left ?? 0;
    const color = graceOnly ? NEUTRAL_STROKE : WARN;
    const seconds = `${formatSeconds(ticks, tickHz, getLocale())} ${t('unit.s')}`;
    pill.label.text = graceOnly ? seconds : `${MINUS}1 ${seconds}`;
    pill.label.position.set(PILL.arcRadius * 2 + 8, 0);
    pill.mark.position.set(PILL.arcRadius + 4, 0.5);
    const fill = graceOnly ? 0 : arcFill(ticks, capacity.attritionTicks);
    const g = pill.arc;
    g.clear();
    g.roundRect(0, -PILL.height / 2, PILL.width, PILL.height, PILL.radius)
      .fill({ color: BG, alpha: 0.92 })
      .stroke({ width: 1.5, color });
    const cx = PILL.arcRadius + 4;
    // The track of the countdown, then the part that has run; the `!` disc sits in the middle.
    g.circle(cx, 0, PILL.arcRadius).stroke({ width: PILL.arcWidth, color, alpha: 0.3 });
    if (fill > 0) {
      const start = -Math.PI / 2;
      g.moveTo(cx + PILL.arcRadius * Math.cos(start), PILL.arcRadius * Math.sin(start));
      g.arc(cx, 0, PILL.arcRadius, start, start + 2 * Math.PI * fill);
      g.stroke({ width: PILL.arcWidth, color });
    }
    g.circle(cx, 0, PILL.arcRadius - PILL.arcWidth + 1).fill(color);
    pill.root.scale.set(pillScale(this.cameraScale));
    // Right of the city, above its warehouse bar.
    pill.root.position.set(at.x + this.radiusOf(node.id) + PILL.gap, at.y - this.radiusOf(node.id));
    pill.root.visible = true;
  }
}
