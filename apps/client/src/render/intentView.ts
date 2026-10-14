import { Container, Graphics } from 'pixi.js';
import type { RenderFrame, RenderGroup } from '../net/interpolate.ts';
import type { IntentView as WireIntent, MapFile, PlayerId } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import {
  chevrons,
  dashAlong,
  delayProgress,
  polylinePrefix,
  ribbonAxis,
  ribbonBody,
  ribbonOutline,
} from './intentLayout.ts';
import type { MapLayers } from './layers.ts';
import { nodePoint } from './layout.ts';
import { reducedMotion } from './motion.ts';
import { splitOrder, trackOrder } from './orderTrack.ts';
import type { EntityKit } from './shapes.ts';
import type { OrderDelays } from './source.ts';
import {
  BG,
  CHEVRON,
  DEFENSE_ARC,
  INTENT_ICON_ANGLE,
  INTENT_ICON_DISTANCE,
  INTENT_TARGET_RING,
  ORDER_LINE,
  ownerColor,
  PAPER,
  PLATE_FILL,
  RIBBON,
  WARN,
} from './style.ts';

function around(distance: number, degrees: number): Point {
  const rad = (degrees * Math.PI) / 180;
  return { x: distance * Math.cos(rad), y: distance * Math.sin(rad) };
}

/** Radius of the delay arc around the disc of "Defense" (the disc has radius 9, 9.7). */
const ARC_RADIUS = 9 + DEFENSE_ARC.gap + DEFENSE_ARC.width / 2;
/** A ring is drawn as this many corners. */
const RING_CORNERS = 40;

function ring(at: Point, radius: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < RING_CORNERS; i++) {
    const a = (i / RING_CORNERS) * Math.PI * 2;
    out.push({ x: at.x + radius * Math.cos(a), y: at.y + radius * Math.sin(a) });
  }
  return out;
}

const flat = (points: readonly Point[]): number[] => points.flatMap((p) => [p.x, p.y]);

/**
 * What the players intend, on the map (ui-style 9.7): planned orders of both sides as ribbon
 * arrows (own along the server's `order.path`, the opponent's in one arc `origin -> target`: the
 * client finds no route), a light stripe growing from the tail while the delay runs, the ring
 * around the target of an enemy intent (`--warn` over an own city: it is coming for you), the
 * shield disc of "Defense" with its delay arc, and the thin order lines with chevrons of own
 * ordinary orders. Everything is redrawn every frame (a few shapes): the positions of own groups
 * move and the stripe and the dashes run. "Less motion" stops the running dashes only.
 */
export class IntentView {
  private readonly lines = new Graphics();
  private readonly ribbons = new Graphics();
  private readonly rings = new Graphics();
  private readonly arcs = new Graphics();
  private readonly icons = new Container({ label: 'intent-icons' });
  private readonly iconPool: Container[] = [];
  private cameraScale = 1;
  /** The drawn axis of each ribbon by intent id, for the tooltip's hit test. */
  private readonly axes = new Map<string, readonly Point[]>();
  /** The chain of nodes of each own ordinary order, kept while the order lives (`orderTrack.ts`). */
  private readonly chains = new Map<string, number[]>();
  private delays: OrderDelays | null = null;
  private tickHz = 10;

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    private readonly me: PlayerId,
    private readonly kit: EntityKit,
    private readonly radiusOf: (node: number) => number,
  ) {
    // Order lines go under the tokens of the groups they belong to; arrows of intents on top.
    layers.layer.groups.addChildAt(this.lines, 0);
    layers.layer.intents.addChild(this.ribbons, this.rings, this.icons, this.arcs);
  }

  /** Camera scale (CSS px per world unit): the ribbon keeps its narrow tail readable. */
  setCameraScale(scale: number): void {
    this.cameraScale = scale;
  }

  /** `ruleset_public.orders` delays; without them no stripe and no arc are drawn. */
  setDelays(delays: OrderDelays | null): void {
    this.delays = delays;
  }

  /** Ticks per second: the dashes run with the render tick, so a frozen scene holds still. */
  setTickHz(tickHz: number): void {
    this.tickHz = tickHz;
  }

  update(frame: RenderFrame, spots: ReadonlyMap<string, Point>): void {
    this.drawOrders(frame.groups, spots);
    const { intents, nodes } = frame.base.view;
    // Own groups with a planned order, matched to the intent that announces it.
    const pool = frame.groups.filter((g) => g.group.order?.planned === true);
    const run = reducedMotion() ? 0 : (frame.tick / this.tickHz) * RIBBON.runSpeed;
    this.ribbons.clear();
    this.rings.clear();
    this.arcs.clear();
    this.axes.clear();
    let icons = 0;
    for (const intent of intents) {
      const from = nodePoint(this.map, intent.origin);
      if (from === undefined) continue;
      const target = intent.target === null ? undefined : nodePoint(this.map, intent.target);
      if (intent.kind === 'planned_move' && intent.target !== null && target !== undefined) {
        const progress =
          this.delays === null
            ? null
            : delayProgress(intent.created_tick, frame.tick, this.delays.planned);
        this.drawRibbon(intent, pool, spots, progress, run);
        if (intent.owner !== this.me) {
          const warn = nodes[intent.target]?.owner === this.me;
          this.drawTargetRing(target, intent.target, warn);
        }
      } else if (intent.kind !== 'planned_move') {
        const progress =
          this.delays === null
            ? null
            : delayProgress(intent.created_tick, frame.tick, this.delays.defense);
        this.placeIcon(icons++, intent, from, progress);
      }
    }
    // Hide the icons left over from the previous frame.
    for (let i = icons; i < this.iconPool.length; i++) {
      const icon = this.iconPool[i];
      if (icon !== undefined) icon.visible = false;
    }
  }

  /** The axes of the ribbons on screen, by intent id: what a pointer can rest on. */
  ribbonAxes(): ReadonlyMap<string, readonly Point[]> {
    return this.axes;
  }

  destroy(): void {
    this.lines.destroy();
    this.ribbons.destroy();
    this.rings.destroy();
    this.arcs.destroy();
    this.icons.destroy({ children: true });
  }

  /** The points the axis of an intent runs through, and how far it leaves the first one. */
  private route(
    intent: WireIntent,
    pool: RenderGroup[],
    spots: ReadonlyMap<string, Point>,
  ): { nodes: Point[]; startGap: number } | null {
    const origin = nodePoint(this.map, intent.origin);
    const target = intent.target === null ? undefined : nodePoint(this.map, intent.target);
    if (origin === undefined || target === undefined) return null;
    const gap = this.radiusOf(intent.origin) + RIBBON.startGap;
    // Own order: along the server's path, from where the group is now.
    const index = pool.findIndex(
      (g) => (g.owner ?? this.me) === intent.owner && g.group.order?.dest === intent.target,
    );
    const item = index < 0 ? undefined : pool[index];
    if (item?.group.order != null) {
      pool.splice(index, 1);
      const steps = item.group.order.path
        .map((id) => nodePoint(this.map, id))
        .filter((p): p is Point => p !== undefined);
      const at = item.location.kind === 'node' ? origin : spots.get(item.group.id);
      if (at !== undefined && steps.length > 0) {
        return { nodes: [at, ...steps], startGap: item.location.kind === 'node' ? gap : 0 };
      }
    }
    return { nodes: [origin, target], startGap: gap };
  }

  private drawRibbon(
    intent: WireIntent,
    pool: RenderGroup[],
    spots: ReadonlyMap<string, Point>,
    progress: number | null,
    run: number,
  ): void {
    const route = this.route(intent, pool, spots);
    if (route === null) return;
    const last = intent.target ?? intent.origin;
    const axis = ribbonAxis(
      route.nodes,
      route.startGap,
      this.radiusOf(last) + RIBBON.endGap,
      RIBBON.bend,
    );
    const ribbon = ribbonOutline(axis, ribbonBody(this.cameraScale));
    if (ribbon === null) return;
    this.axes.set(intent.id, axis);
    const g = this.ribbons;
    const color = ownerColor(this.me, intent.owner);
    const own = intent.owner === this.me;
    const poly = flat(ribbon.outline);
    // The tail dot (own) or the hollow diamond (opponent) repeat the side without colour.
    g.poly(poly).stroke({
      width: RIBBON.casing.width,
      color: BG,
      alpha: RIBBON.casing.alpha,
      join: 'round',
    });
    g.poly(poly).fill({ color, alpha: RIBBON.fillAlpha });
    const left = progress === null || progress < 1;
    const style = { width: RIBBON.contour.width, color, alpha: RIBBON.contour.alpha };
    // Own: solid until the group leaves, then dashes that run. The opponent's: dashed throughout.
    if (own && left) {
      g.poly(poly).stroke({ ...style, join: 'round' });
    } else {
      const offset = left ? 0 : -run;
      for (const dash of dashAlong(ribbon.outline, RIBBON.dash, RIBBON.gap, offset, true)) {
        const [first, ...rest] = dash;
        if (first === undefined) continue;
        g.moveTo(first.x, first.y);
        for (const p of rest) g.lineTo(p.x, p.y);
      }
      g.stroke({ ...style, cap: 'round', join: 'round' });
    }
    if (progress !== null && progress > 0 && progress < 1) {
      // The light stripe: how much of the delay has run, from the tail along the axis.
      const stripe = polylinePrefix(ribbon.body, progress);
      const [first, ...rest] = stripe;
      if (first !== undefined && rest.length > 0) {
        g.moveTo(first.x, first.y);
        for (const p of rest) g.lineTo(p.x, p.y);
        g.stroke({
          width: RIBBON.stripe.width,
          color: PAPER,
          alpha: RIBBON.stripe.alpha,
          cap: 'round',
          join: 'round',
        });
      }
    }
    const start = axis[0];
    if (start === undefined) return;
    if (own) {
      g.circle(start.x, start.y, 4).fill(color).stroke({ width: 1.5, color: PLATE_FILL });
    } else {
      g.poly([
        start.x,
        start.y - 5.5,
        start.x + 5.5,
        start.y,
        start.x,
        start.y + 5.5,
        start.x - 5.5,
        start.y,
      ])
        .fill(PLATE_FILL)
        .stroke({ width: 2, color });
    }
  }

  /** The dotted ring around the target of an enemy intent; two rings and `--warn` over my city. */
  private drawTargetRing(at: Point, node: number, warn: boolean): void {
    const g = this.rings;
    const radius = this.radiusOf(node) + INTENT_TARGET_RING.gap;
    const color = warn ? WARN : ownerColor(this.me, this.me === 0 ? 1 : 0);
    const draw = (r: number, width: number): void => {
      for (const dash of dashAlong(
        ring(at, r),
        INTENT_TARGET_RING.dash,
        INTENT_TARGET_RING.gap2,
        0,
        true,
      )) {
        const [first, ...rest] = dash;
        if (first === undefined) continue;
        g.moveTo(first.x, first.y);
        for (const p of rest) g.lineTo(p.x, p.y);
      }
      g.stroke({ width, color, alpha: INTENT_TARGET_RING.alpha, cap: 'round' });
    };
    draw(radius, warn ? INTENT_TARGET_RING.width + 1 : INTENT_TARGET_RING.width);
    // A second, outer ring: "it is coming for you" reads without colour.
    if (warn) draw(radius + 5, INTENT_TARGET_RING.width - 0.5);
  }

  private placeIcon(index: number, intent: WireIntent, at: Point, progress: number | null): void {
    let icon = this.iconPool[index];
    if (icon === undefined) {
      icon = this.icons.addChild(new Container());
      icon.addChild(new Graphics(this.kit.iconDisc[0]));
      // The only intent without a destination is "Defense" (DEC-08).
      icon.addChild(new Graphics(this.kit.glyph.defense));
      this.iconPool.push(icon);
    }
    const [disc] = icon.children as [Graphics, Graphics];
    disc.context = this.kit.iconDisc[intent.owner];
    const radius = this.radiusOf(intent.origin);
    const offset = around(radius + INTENT_ICON_DISTANCE, INTENT_ICON_ANGLE);
    const x = at.x + offset.x;
    const y = at.y + offset.y;
    icon.position.set(x, y);
    icon.visible = true;
    if (progress !== null && progress < 1) {
      // The delay of the shield: an arc that grows round the disc from the top.
      const start = -Math.PI / 2;
      this.arcs
        .arc(x, y, ARC_RADIUS, start, start + Math.max(0.05, progress) * Math.PI * 2)
        .stroke({
          width: DEFENSE_ARC.width,
          color: ownerColor(this.me, intent.owner),
          cap: 'round',
        });
    }
  }

  /**
   * The arrow of every own ordinary order: from where the order began to its target, along the
   * server's path, drawn once and left in place while the group walks it. The walked part of the
   * current road fades, the roads behind are gone. A planned order is the ribbon's job.
   */
  private drawOrders(groups: readonly RenderGroup[], points: ReadonlyMap<string, Point>): void {
    const g = this.lines;
    g.clear();
    const live = new Set<string>();
    for (const { group, owner, location } of groups) {
      const order = group.order;
      const unit = points.get(group.id);
      if (order === null || order.planned || unit === undefined) continue;
      const color = ownerColor(this.me, owner ?? this.me);
      const start = location.kind === 'node' ? location.node : location.from_node;
      const tracked = trackOrder(this.chains.get(group.id) ?? null, order.path, start);
      this.chains.set(group.id, tracked.chain);
      live.add(group.id);
      const places = tracked.chain
        .map((id) => nodePoint(this.map, id))
        .filter((p): p is Point => p !== undefined);
      if (places.length !== tracked.chain.length || places.length < 2) continue;
      // The arrow leaves the circle of the city it began in.
      const first = places[0];
      const second = places[1];
      if (first === undefined || second === undefined) continue;
      const lead = this.radiusOf(tracked.chain[0] ?? start) + RIBBON.startGap;
      const gap = Math.hypot(second.x - first.x, second.y - first.y) || 1;
      places[0] = {
        x: first.x + ((second.x - first.x) / gap) * lead,
        y: first.y + ((second.y - first.y) / gap) * lead,
      };
      const { walked, ahead } = splitOrder(places, tracked.segment, unit);
      this.drawWalked(walked, color);
      this.drawAhead(ahead, color, order.dest);
    }
    for (const id of this.chains.keys()) {
      if (!live.has(id)) this.chains.delete(id);
    }
  }

  /** The walked part of the road under the group: a faint line, what is left of the arrow. */
  private drawWalked(walked: readonly Point[], color: number): void {
    const [first, ...rest] = walked;
    if (first === undefined || rest.length === 0) return;
    const g = this.lines;
    g.moveTo(first.x, first.y);
    for (const p of rest) g.lineTo(p.x, p.y);
    g.stroke({ width: ORDER_LINE.width, color, alpha: ORDER_LINE.walkedAlpha, cap: 'round' });
  }

  /** From the group to the target: casing, line, chevrons, the ring round the target, the head. */
  private drawAhead(ahead: readonly Point[], color: number, dest: number): void {
    const [first, ...rest] = ahead;
    if (first === undefined || rest.length === 0) return;
    const g = this.lines;
    const target = rest[rest.length - 1] ?? first;
    const before = rest[rest.length - 2] ?? first;
    const radius = this.radiusOf(dest) + ORDER_LINE.ringGap;
    // The line stops at the ring of the target, the head sits on it.
    const length = Math.hypot(target.x - before.x, target.y - before.y) || 1;
    const dir = { x: (target.x - before.x) / length, y: (target.y - before.y) / length };
    const end = { x: target.x - dir.x * radius, y: target.y - dir.y * radius };
    const body = [first, ...rest.slice(0, -1), end];
    const trace = (): void => {
      g.moveTo(first.x, first.y);
      for (const p of body.slice(1)) g.lineTo(p.x, p.y);
    };
    trace();
    g.stroke({
      width: ORDER_LINE.casing.width,
      color: BG,
      alpha: ORDER_LINE.casing.alpha,
      cap: 'round',
      join: 'round',
    });
    trace();
    g.stroke({
      width: ORDER_LINE.width,
      color,
      alpha: ORDER_LINE.alpha,
      cap: 'round',
      join: 'round',
    });
    for (const { at, dir: d } of chevrons(
      body,
      CHEVRON.spacing,
      CHEVRON.first,
      CHEVRON.endMargin,
    )) {
      const s = CHEVRON.size;
      g.moveTo(at.x - d.x * s - d.y * s, at.y - d.y * s + d.x * s)
        .lineTo(at.x + d.x * (s * 0.6), at.y + d.y * (s * 0.6))
        .lineTo(at.x - d.x * s + d.y * s, at.y - d.y * s - d.x * s);
    }
    g.stroke({ width: CHEVRON.width, color: PAPER, alpha: 1, cap: 'round', join: 'round' });
    // The arrowhead: a filled triangle whose tip touches the ring of the target.
    const h = ORDER_LINE.head;
    const base = { x: end.x - dir.x * h.length, y: end.y - dir.y * h.length };
    g.poly([
      end.x,
      end.y,
      base.x - dir.y * h.half,
      base.y + dir.x * h.half,
      base.x + dir.y * h.half,
      base.y - dir.x * h.half,
    ])
      .fill({ color, alpha: ORDER_LINE.alpha })
      .stroke({ width: 1.5, color: BG, alpha: ORDER_LINE.casing.alpha, join: 'round' });
    g.circle(target.x, target.y, radius).stroke({ width: 2, color, alpha: ORDER_LINE.alpha });
  }
}
