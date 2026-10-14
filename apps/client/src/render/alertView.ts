import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { t, tf } from '../i18n/index.ts';
import { formatSeconds } from '../hud/format.ts';
import { getLocale } from '../i18n/index.ts';
import type { NodeView, PlayerId } from '../protocol.gen.ts';
import { BADGE, badgeScale, BEACON, beaconPulse, OVERFLOW_RING } from './alertLayout.ts';
import { ringRadius } from './cityLayout.ts';
import type { MapLayers } from './layers.ts';
import { nodePoint } from './layout.ts';
import { reducedMotion } from './motion.ts';
import { BG, NEUTRAL_STROKE, PAPER, WARN, YOU } from './style.ts';
import type { MapFile } from '../protocol.gen.ts';

const MAX_WARNINGS = 12;
/** The sign of a starving cut-off city (DEC-19): scissors, the cut. `!` is the sign of overcrowding. */
const STARVE_MARK = '✂';

/** One line of the badges of a city: its sign, its text, and whether it is only a grace. */
interface BadgeRow {
  readonly mark: string | null;
  readonly text: string;
  readonly calm: boolean;
}

interface Warning {
  /** The small countdown badge on the ring: a sign disc and the seconds. */
  readonly badge: Container;
  readonly plate: Graphics;
  readonly mark: Text;
  readonly label: Text;
}

/**
 * What the map says about overcrowding and about the start (ui-style 12, U4; redesigned in UI
 * round 2): an own city that holds more units than its capacity gets an amber ring that pulses
 * and a small badge on it with the seconds until a unit is lost (no frame, no extra segments);
 * during the grace after a capture the ring is calm and grey with the grace time; a cut-off city
 * (DEC-19) gets a dashed ring and a `✂` badge with the time to the next starvation. The beacon is
 * the pulsing ring around the own capital in the first three seconds of a match. Redrawn every
 * frame (a few shapes); the numbers are the server's (`attrition_in`, `grace_left`).
 */
export class AlertView {
  private readonly root = new Container({ label: 'alerts' });
  private readonly beacon = new Graphics();
  /** The rings of all warned cities, redrawn every frame (they pulse). */
  private readonly ring = new Graphics();
  private readonly warnings: Warning[] = [];
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
    this.root.addChild(this.beacon, this.ring);
    layers.layer.effects.addChild(this.root);
  }

  setLabelResolution(resolution: number): void {
    this.resolution = resolution;
    for (const warning of this.warnings) {
      warning.mark.resolution = resolution;
      warning.label.resolution = resolution;
    }
  }

  setCameraScale(scale: number): void {
    this.cameraScale = scale;
  }

  /** `nodes` of the snapshot on screen, the city to ring (or `null`), and the time for the pulse. */
  update(
    nodes: readonly NodeView[],
    tickHz: number,
    beaconNode: number | null,
    nowMs: number,
  ): void {
    this.drawBeacon(beaconNode, nowMs);
    let used = 0;
    const ring = this.ring;
    ring.clear();
    for (const node of nodes) {
      if (node.owner !== this.me) continue;
      const rows = this.rowsOf(node, tickHz);
      if (rows.length === 0) continue;
      this.drawRing(node, nowMs);
      for (const [index, row] of rows.entries()) {
        if (used >= MAX_WARNINGS) break;
        this.place(this.warning(used), node, row, index, nowMs);
        used++;
      }
    }
    for (let i = used; i < this.warnings.length; i++) {
      const warning = this.warnings[i];
      if (warning !== undefined) warning.badge.visible = false;
    }
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.warnings.length = 0;
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

  private warning(index: number): Warning {
    const existing = this.warnings[index];
    if (existing !== undefined) return existing;
    const badge = new Container({ label: 'overflow-badge' });
    const plate = new Graphics();
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
    badge.addChild(plate, mark, label);
    this.root.addChild(badge);
    const warning = { badge, plate, mark, label };
    this.warnings.push(warning);
    return warning;
  }

  /** The badges of a city, top down: overcrowding or its grace, then starvation (DEC-19). */
  private rowsOf(node: NodeView, tickHz: number): BadgeRow[] {
    const rows: BadgeRow[] = [];
    const seconds = (ticks: number): string => formatSeconds(ticks, tickHz, getLocale());
    if (node.attrition_in !== null) {
      rows.push({ mark: '!', text: `${seconds(node.attrition_in)} ${t('unit.s')}`, calm: false });
    } else if (node.grace_left !== null) {
      rows.push({ mark: null, text: `${seconds(node.grace_left)} ${t('unit.s')}`, calm: true });
    }
    if (node.starve_in !== null) {
      rows.push({
        mark: STARVE_MARK,
        text: tf('starve.pill', { seconds: seconds(node.starve_in) }),
        calm: false,
      });
    }
    return rows;
  }

  /**
   * The ring of a warned city, same language for every warning: solid and pulsing for overcrowding,
   * dashed and pulsing for starvation (the cut), thin, grey and calm for the grace after a capture.
   */
  private drawRing(node: NodeView, nowMs: number): void {
    const at = nodePoint(this.map, node.id);
    if (at === undefined) return;
    const calm = node.attrition_in === null && node.starve_in === null;
    const base = ringRadius(this.radiusOf(node.id)) + OVERFLOW_RING.gap;
    const radius = calm
      ? base
      : base * (1 + OVERFLOW_RING.grow * beaconPulse(nowMs, reducedMotion()));
    const g = this.ring;
    const color = calm ? NEUTRAL_STROKE : WARN;
    if (node.attrition_in === null && node.starve_in !== null) {
      const dashes = Math.max(10, Math.round((2 * Math.PI * radius) / 10));
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
      g.stroke({ width: OVERFLOW_RING.width, color });
      return;
    }
    g.circle(at.x, at.y, radius).stroke({
      width: calm ? OVERFLOW_RING.graceWidth : OVERFLOW_RING.width,
      color,
    });
    if (!calm) {
      g.circle(at.x, at.y, radius + OVERFLOW_RING.width + 1).stroke({
        width: OVERFLOW_RING.outerWidth,
        color: BG,
        alpha: 0.8,
      });
    }
  }

  /** The badge of one row on the ring of its city at the upper right, rows stacked downwards. */
  private place(
    warning: Warning,
    node: NodeView,
    row: BadgeRow,
    index: number,
    nowMs: number,
  ): void {
    const at = nodePoint(this.map, node.id);
    if (at === undefined) return;
    const color = row.calm ? NEUTRAL_STROKE : WARN;
    const base = ringRadius(this.radiusOf(node.id)) + OVERFLOW_RING.gap;
    const radius = row.calm
      ? base
      : base * (1 + OVERFLOW_RING.grow * beaconPulse(nowMs, reducedMotion()));
    if (warning.label.text !== row.text) warning.label.text = row.text;
    const marked = row.mark !== null;
    warning.mark.visible = marked;
    if (row.mark !== null && warning.mark.text !== row.mark) warning.mark.text = row.mark;
    const left = BADGE.padX - 3;
    const markWidth = marked ? BADGE.markRadius * 2 + BADGE.gap : 0;
    const width = left + markWidth + warning.label.width + BADGE.padX;
    warning.mark.position.set(left + BADGE.markRadius, 0.5);
    warning.label.position.set(left + markWidth, 0);
    const plate = warning.plate;
    plate.clear();
    plate
      .roundRect(0, -BADGE.height / 2, width, BADGE.height, BADGE.radius)
      .fill({ color: BG, alpha: 0.94 })
      .stroke({ width: 1.5, color });
    if (marked) plate.circle(left + BADGE.markRadius, 0, BADGE.markRadius).fill(color);
    const angle = -Math.PI / 4;
    const scale = badgeScale(this.cameraScale);
    warning.badge.scale.set(scale);
    warning.badge.position.set(
      at.x + (radius + 2) * Math.cos(angle),
      at.y + (radius + 2) * Math.sin(angle) - BADGE.height / 2 + index * (BADGE.height + 3) * scale,
    );
    warning.badge.visible = true;
  }
}
