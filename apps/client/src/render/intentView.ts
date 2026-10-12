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

  private drawOrders(groups: readonly RenderGroup[], points: ReadonlyMap<string, Point>): void {
    const g = this.lines;
    g.clear();
    for (const { group, owner } of groups) {
      const order = group.order;
      const from = points.get(group.id);
      // A planned order is the ribbon's job.
      if (order === null || order.planned || from === undefined) continue;
      const color = ownerColor(this.me, owner ?? this.me);
      const path: Point[] = [from];
      for (const id of order.path) {
        const step = nodePoint(this.map, id);
        if (step !== undefined) path.push(step);
      }
      const [first, ...rest] = path;
      if (first === undefined) continue;
      const trace = (): void => {
        g.moveTo(first.x, first.y);
        for (const p of rest) g.lineTo(p.x, p.y);
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
      for (const { at, dir } of chevrons(path, CHEVRON.spacing, CHEVRON.first, CHEVRON.endMargin)) {
        const s = CHEVRON.size;
        g.moveTo(at.x - dir.x * s - dir.y * s, at.y - dir.y * s + dir.x * s)
          .lineTo(at.x + dir.x * (s * 0.6), at.y + dir.y * (s * 0.6))
          .lineTo(at.x - dir.x * s + dir.y * s, at.y - dir.y * s - dir.x * s);
      }
      g.stroke({ width: CHEVRON.width, color: PAPER, alpha: 1, cap: 'round', join: 'round' });
      const dest = nodePoint(this.map, order.dest);
      if (dest !== undefined) {
        g.circle(dest.x, dest.y, this.radiusOf(order.dest) + 5).stroke({
          width: 2,
          color,
          alpha: ORDER_LINE.alpha,
        });
      }
    }
  }
}
