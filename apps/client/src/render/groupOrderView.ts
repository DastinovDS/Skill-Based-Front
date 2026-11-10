import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { t } from '../i18n/index.ts';
import type { RenderFrame } from '../net/interpolate.ts';
import type { MapFile, PlayerId } from '../protocol.gen.ts';
import { CP_MARK } from '../theme/cpMark.ts';
import { helmetOutline } from '../units/helmet.ts';
import { badgeScale } from './alertLayout.ts';
import type { Point } from './camera.ts';
import { ringRadius } from './cityLayout.ts';
import {
  groupOrders,
  sealLozenges,
  secondsUntil,
  waitShare,
  waitingDeparture,
} from './groupOrderLayout.ts';
import type { OverlayState } from './interaction.ts';
import type { MapLayers } from './layers.ts';
import { nodePoint, type TokenSpot } from './layout.ts';
import { helmetWidth } from './shapes.ts';
import { BG, CASING, DARK_PLATE, GROUP_ORDER, INK, YOU } from './style.ts';

/** Whole seconds as the travel time reads them ("5 s", #432). */
const seconds = (n: number): string => `${String(n)} ${t('unit.s')}`;

/**
 * The marks of the group order and of the recruit rally point (DEC-48, #896; the owner's choice of
 * the mockup `group-order.html`, item K8), drawn from the server's numbers only:
 *
 * - **B1 One seal**: over the target of a group order an hourglass disc on a leader, the seconds to
 *   the common arrival (`OrderView.arrive_tick`) on its left, a lozenge per member under it, filled
 *   for those on the way (a rally: for those that merged); before the click (the preview of the
 *   overlay) the same seal dashed, without the seconds (the server times it), the price on its right;
 * - **C3 Hourglass**: beside a member that waits in its node for its departure (`depart_tick`) the
 *   hourglass disc, its sand running down, the seconds after it, on the side away from its road;
 * - **E3 Muster ring**: round the rally point of an own city a broken ring of the own colour with the
 *   recruit helmet on a disc on top, and a cut chevron on the city's ring towards the point; while
 *   the point is picked, the same ring faint at the node under the pointer.
 *
 * A few shapes, redrawn every frame (the sand runs with the render tick, so a frozen scene holds
 * still); the texts come from a small pool.
 */
export class GroupOrderView {
  private readonly root = new Container({ label: 'group-orders' });
  private readonly marks = new Graphics({ label: 'group-order-marks' });
  private readonly labels = new Container({ label: 'group-order-labels' });
  private readonly texts: Text[] = [];
  private textsUsed = 0;
  private readonly style = new TextStyle({
    fontFamily: 'system-ui, sans-serif',
    fontSize: GROUP_ORDER.arrival.fontSize,
    fontWeight: '600',
    fill: INK,
    stroke: { color: BG, width: 3, join: 'round' },
  });
  /** The most members each group order showed: a rally's merged members leave its snapshot. */
  private readonly totals = new Map<string, number>();
  /** The tick each waiting member was first seen waiting: where its sand starts. */
  private readonly since = new Map<string, number>();
  private cameraScale = 1;
  private resolution = 1;

  /** The tick each group order was first seen with its arrival: where the sand of its seal starts. */
  private readonly sealSince = new Map<string, number>();

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    /** The viewing player: own cities have rally points, own orders have seals. */
    private readonly me: PlayerId,
    private readonly radiusOf: (node: number) => number,
  ) {
    this.root.addChild(this.marks, this.labels);
    layers.layer.intents.addChild(this.root);
  }

  setCameraScale(scale: number): void {
    this.cameraScale = scale;
  }

  setLabelResolution(resolution: number): void {
    this.resolution = resolution;
    for (const text of this.texts) text.resolution = resolution;
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.style.destroy();
  }

  update(
    frame: RenderFrame,
    overlay: OverlayState,
    spots: ReadonlyMap<string, TokenSpot>,
    tickHz: number,
  ): void {
    const g = this.marks;
    g.clear();
    this.textsUsed = 0;
    const s = badgeScale(this.cameraScale);
    const view = frame.base.view;
    const own = (node: number): boolean => view.nodes[node]?.owner === this.me;
    this.drawMusters(g, frame, overlay, s);
    this.drawWaits(g, frame, spots, tickHz, s);
    // B1 over the target of each group order the server has timed.
    const live = new Set<string>();
    for (const mark of groupOrders(view.groups)) {
      live.add(mark.id);
      const total = Math.max(this.totals.get(mark.id) ?? 0, mark.members.length);
      this.totals.set(mark.id, total);
      if (mark.arrive === null) continue;
      const since = this.sealSince.get(mark.id) ?? frame.tick;
      this.sealSince.set(mark.id, since);
      this.drawSeal(g, mark.dest, s, {
        lozenges: sealLozenges(mark, total, own(mark.dest)),
        share: waitShare(mark.arrive, since, frame.tick),
        seconds: secondsUntil(mark.arrive, frame.tick, tickHz),
        price: null,
        dashed: false,
      });
    }
    for (const id of this.totals.keys()) if (!live.has(id)) this.totals.delete(id);
    for (const id of this.sealSince.keys()) if (!live.has(id)) this.sealSince.delete(id);
    // B1 before the click: the seal of the order the pointer would give, with its price.
    const preview = overlay.group ?? null;
    if (preview !== null) {
      const count = overlay.picks?.length ?? preview.from.length;
      this.drawSeal(g, preview.to, s, {
        lozenges: Array.from({ length: count }, () => false),
        share: 1,
        seconds: null,
        price: preview.price,
        dashed: true,
      });
    }
    for (let i = this.textsUsed; i < this.texts.length; i++) {
      const text = this.texts[i];
      if (text !== undefined) text.visible = false;
    }
  }

  // --- B1 -----------------------------------------------------------------------------------------

  private drawSeal(
    g: Graphics,
    node: number,
    s: number,
    seal: {
      readonly lozenges: readonly boolean[];
      readonly share: number;
      readonly seconds: number | null;
      readonly price: string | null;
      readonly dashed: boolean;
    },
  ): void {
    const at = nodePoint(this.map, node);
    if (at === undefined) return;
    const A = GROUP_ORDER.arrival;
    const R = ringRadius(this.radiusOf(node));
    const cy = at.y - R - A.lift * s;
    // The leader from the disc down to the ring, a small lozenge at its foot.
    const top = cy + A.disc * s;
    const foot = at.y - R - 3 * s;
    if (foot > top) {
      g.moveTo(at.x, top)
        .lineTo(at.x, foot)
        .stroke({ width: 2.6 * s, color: CASING, alpha: 0.9 });
      g.moveTo(at.x, top)
        .lineTo(at.x, foot)
        .stroke({ width: 0.9 * s, color: INK, alpha: 0.6 });
      this.lozenge(g, { x: at.x, y: foot }, 4 * s, true, INK);
    }
    this.disc(g, { x: at.x, y: cy }, A.disc * s, seal.dashed);
    this.hourglass(g, { x: at.x, y: cy }, A.hourglass * s, seal.share);
    const n = seal.lozenges.length;
    seal.lozenges.forEach((filled, j) => {
      const x = at.x + (j - (n - 1) / 2) * A.lozengeGap * s;
      this.lozenge(g, { x, y: cy + A.lozengeY * s }, A.lozenge * s, filled, YOU);
    });
    if (seal.seconds !== null) {
      const text = this.text(seconds(seal.seconds), s, 1);
      text.position.set(at.x - (A.disc + 10) * s, cy);
    }
    if (seal.price !== null) this.priceTag(g, { x: at.x + (A.disc + 8) * s, y: cy }, seal.price, s);
  }

  /** The price before the click: the number and the CP mark on a thin plate, left edge at `at.x`. */
  private priceTag(g: Graphics, at: Point, price: string, s: number): void {
    const P = GROUP_ORDER.arrival.price;
    const text = this.text(price, s, 0);
    const mark = P.mark * s;
    const width = text.width + mark + (P.padding * 2 + P.gap) * s;
    const height = P.height * s;
    g.rect(at.x, at.y - height / 2, width, height)
      .fill({ color: DARK_PLATE, alpha: 0.94 })
      .stroke({ width: 1 * s, color: INK, alpha: 0.6 });
    text.position.set(at.x + P.padding * s, at.y);
    this.cpMark(g, { x: at.x + P.padding * s + text.width + P.gap * s, y: at.y - mark / 2 }, mark);
  }

  /** The CP mark (`theme/cpMark.ts`) in a square of side `size` with its top left at `at`. */
  private cpMark(g: Graphics, at: Point, size: number): void {
    const { box, shapes, casing, ink } = CP_MARK;
    const k = size / box.width;
    const place = (shape: readonly number[]): number[] =>
      shape.map((v, i) => (i % 2 === 0 ? at.x + (v - box.x) * k : at.y + (v - box.y) * k));
    for (const shape of shapes) {
      g.poly(place(shape)).stroke({ width: casing.width * k, color: casing.color, join: 'miter' });
    }
    for (const shape of shapes) g.poly(place(shape)).fill(ink);
  }

  // --- C3 -----------------------------------------------------------------------------------------

  /** The hourglass beside each own group that waits in its node for its departure tick. */
  private drawWaits(
    g: Graphics,
    frame: RenderFrame,
    spots: ReadonlyMap<string, TokenSpot>,
    tickHz: number,
    s: number,
  ): void {
    const W = GROUP_ORDER.wait;
    const waiting = new Set<string>();
    for (const { group } of frame.groups) {
      const depart = waitingDeparture(group, frame.tick);
      const spot = spots.get(group.id);
      if (depart === null || spot === undefined || group.location.kind !== 'node') continue;
      waiting.add(group.id);
      const since = this.since.get(group.id) ?? frame.tick;
      this.since.set(group.id, since);
      // On the side away from its first road, so the line never runs under it.
      const from = nodePoint(this.map, group.location.node);
      const next = nodePoint(this.map, group.order?.path[0] ?? group.location.node);
      const side = from !== undefined && next !== undefined && next.x > from.x ? -1 : 1;
      const w = helmetWidth(spot.side, spot.inside === true) * spot.scale;
      const at = {
        x: spot.x + side * (w * 0.62 + (W.disc + W.gap) * s),
        y: spot.y - w * 0.5 - W.disc * s * 0.4,
      };
      this.disc(g, at, W.disc * s, false);
      this.hourglass(g, at, W.hourglass * s, waitShare(depart, since, frame.tick));
      const text = this.text(
        seconds(secondsUntil(depart, frame.tick, tickHz)),
        s,
        side > 0 ? 0 : 1,
      );
      text.position.set(at.x + side * (W.disc + 5) * s, at.y);
    }
    for (const id of this.since.keys()) if (!waiting.has(id)) this.since.delete(id);
  }

  // --- E3 -----------------------------------------------------------------------------------------

  /** The muster ring at each rally point of an own city, the chevron on the city ring towards it. */
  private drawMusters(g: Graphics, frame: RenderFrame, overlay: OverlayState, s: number): void {
    const view = frame.base.view;
    const points = new Set<number>();
    for (const node of view.nodes) {
      if (node.owner !== this.me || node.rally_point === null) continue;
      points.add(node.rally_point);
      this.chevron(g, node.id, node.rally_point, 1);
    }
    for (const point of points) this.muster(g, point, s, 1);
    // The pick of a point (item K7): the ring faint at the node under the pointer.
    const from = overlay.rallyFrom ?? null;
    const hover = overlay.hover?.node ?? null;
    if (from !== null && hover !== null && hover !== from && !points.has(hover)) {
      const alpha = GROUP_ORDER.muster.pickAlpha;
      this.muster(g, hover, s, alpha);
      this.chevron(g, from, hover, alpha);
    }
  }

  private muster(g: Graphics, node: number, s: number, alpha: number): void {
    const at = nodePoint(this.map, node);
    if (at === undefined) return;
    const M = GROUP_ORDER.muster;
    const r = ringRadius(this.radiusOf(node)) + M.gap;
    for (let j = 0; j < M.arcs; j++) {
      const a0 = -Math.PI / 2 + Math.PI / M.arcs + (j * 2 * Math.PI) / M.arcs - M.arc / 2;
      const arc = (): Graphics =>
        g
          .moveTo(at.x + r * Math.cos(a0), at.y + r * Math.sin(a0))
          .arc(at.x, at.y, r, a0, a0 + M.arc);
      arc().stroke({ width: M.casing, color: CASING, alpha, cap: 'butt' });
      arc().stroke({ width: M.width, color: YOU, alpha, cap: 'butt' });
    }
    // The recruit helmet on a disc on top of the ring, a plus beside it: new units come here.
    const top = { x: at.x, y: at.y - r };
    this.disc(g, top, M.disc * s, false, alpha);
    // One outline of a fixed width (the outlines are cached by width), scaled here.
    const outline = helmetOutline('own', M.helmet, 0);
    const poly = outline.map((v, i) => (i % 2 === 0 ? top.x + v * s : top.y + (v + 0.5) * s));
    g.poly(poly)
      .fill({ color: YOU, alpha })
      .stroke({ width: 0.8 * s, color: INK, alpha });
    const px = top.x + M.disc * s * 0.8;
    const py = top.y - M.disc * s * 0.7;
    const d = 2.6 * s;
    for (const [width, color] of [
      [2.6 * s, CASING],
      [1.2 * s, INK],
    ] as const) {
      g.moveTo(px - d, py)
        .lineTo(px + d, py)
        .moveTo(px, py - d)
        .lineTo(px, py + d);
      g.stroke({ width, color, alpha, cap: 'square' });
    }
  }

  /** The cut chevron on the ring of `city`, pointing at `point` (the way its new units leave). */
  private chevron(g: Graphics, city: number, point: number, alpha: number): void {
    const from = nodePoint(this.map, city);
    const to = nodePoint(this.map, point);
    if (from === undefined || to === undefined) return;
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    if (len === 0) return;
    const ux = (to.x - from.x) / len;
    const uy = (to.y - from.y) / len;
    const C = GROUP_ORDER.muster.chevron;
    const base = ringRadius(this.radiusOf(city)) + C.gap;
    const tip = { x: from.x + ux * (base + C.length), y: from.y + uy * (base + C.length) };
    const back = { x: from.x + ux * base, y: from.y + uy * base };
    const half = C.width;
    const poly = [
      tip.x,
      tip.y,
      back.x - uy * half,
      back.y + ux * half,
      back.x + ux * 3,
      back.y + uy * 3,
      back.x + uy * half,
      back.y - ux * half,
    ];
    g.poly(poly)
      .stroke({ width: 3, color: CASING, alpha, join: 'miter' })
      .fill({ color: YOU, alpha })
      .stroke({ width: 1, color: INK, alpha, join: 'miter' });
  }

  // --- Shared shapes ----------------------------------------------------------------------------

  /** The disc of the travel time (#627): a casing, a dark plate, a paper rim (dashed: a preview). */
  private disc(g: Graphics, at: Point, r: number, dashed: boolean, alpha = 1): void {
    const D = GROUP_ORDER.disc;
    const k = r / GROUP_ORDER.arrival.disc;
    g.circle(at.x, at.y, r + D.casing * k).fill({ color: CASING, alpha });
    g.circle(at.x, at.y, r).fill({ color: DARK_PLATE, alpha: D.fillAlpha * alpha });
    const rim = r - 0.5 * k;
    if (!dashed) {
      g.circle(at.x, at.y, rim).stroke({ width: D.rim * k, color: INK, alpha: D.rimAlpha * alpha });
      return;
    }
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      g.moveTo(at.x + rim * Math.cos(a0), at.y + rim * Math.sin(a0)).arc(
        at.x,
        at.y,
        rim,
        a0,
        a0 + (Math.PI * 2) / n / 1.8,
      );
    }
    g.stroke({ width: D.rim * k, color: INK, alpha: D.rimAlpha * alpha });
  }

  /** An engraved hourglass `size` tall: two triangles, the sand in the own colour (`share` on top). */
  private hourglass(g: Graphics, at: Point, size: number, share: number): void {
    const k = size / 16;
    const P = (x: number, y: number): [number, number] => [at.x + x * k, at.y + y * k];
    const top = [...P(-5, -7), ...P(5, -7), ...P(0, 0)];
    const bottom = [...P(0, 0), ...P(5, 7), ...P(-5, 7)];
    g.poly(top).fill(DARK_PLATE);
    g.poly(bottom).fill(DARK_PLATE);
    const sh = Math.min(1, Math.max(0, share));
    if (sh > 0) g.poly([...P(-5 * sh, -7 * sh), ...P(5 * sh, -7 * sh), ...P(0, 0)]).fill(YOU);
    if (sh < 1)
      g.poly([...P(-5 * sh, 7 * sh), ...P(5 * sh, 7 * sh), ...P(5, 7), ...P(-5, 7)]).fill(YOU);
    g.poly(top).stroke({ width: 1.2 * k, color: INK, join: 'round' });
    g.poly(bottom).stroke({ width: 1.2 * k, color: INK, join: 'round' });
    g.moveTo(...P(-6.5, -7.6))
      .lineTo(...P(6.5, -7.6))
      .moveTo(...P(-6.5, 7.6))
      .lineTo(...P(6.5, 7.6))
      .stroke({ width: 1.8 * k, color: INK });
  }

  /** A lozenge of side `side` (a turned square) on a casing, filled with `fill` or hollow. */
  private lozenge(g: Graphics, at: Point, side: number, filled: boolean, fill: number): void {
    const h = (side * Math.SQRT2) / 2;
    const shape = (half: number): number[] => [
      at.x,
      at.y - half,
      at.x + half,
      at.y,
      at.x,
      at.y + half,
      at.x - half,
      at.y,
    ];
    g.poly(shape(h + 1.7)).fill(CASING);
    if (filled) g.poly(shape(h)).fill(fill);
    g.poly(shape(h - 0.3)).stroke({ width: 0.9, color: INK, join: 'miter' });
  }

  /** A text of the pool, scaled with the badges; `align`: 0 its left edge at the point, 1 its right. */
  private text(value: string, s: number, align: 0 | 1): Text {
    let text = this.texts[this.textsUsed];
    if (text === undefined) {
      text = new Text({ text: '', style: this.style, resolution: this.resolution });
      this.labels.addChild(text);
      this.texts.push(text);
    }
    this.textsUsed += 1;
    if (text.text !== value) text.text = value;
    text.anchor.set(align, 0.5);
    text.scale.set(s);
    text.visible = true;
    return text;
  }
}
