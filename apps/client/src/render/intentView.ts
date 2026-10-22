import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { RenderFrame, RenderGroup } from '../net/interpolate.ts';
import type { IntentView as WireIntent, MapFile, PlayerId } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import {
  chevrons,
  dashAlong,
  delayProgress,
  departPulse,
  orderBend,
  pathBend,
  ribbonAxis,
  ribbonBody,
  ribbonFilled,
  ribbonOutline,
  roundRectPoints,
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

/** One pill of the bonus of an own planned order. */
interface BonusPill {
  readonly view: Container;
  readonly plate: Graphics;
  readonly text: Text;
  /** What the plate was drawn for: the number, forecast or not, the width; redrawn only when it changes. */
  key: string;
}

function around(distance: number, degrees: number): Point {
  const rad = (degrees * Math.PI) / 180;
  return { x: distance * Math.cos(rad), y: distance * Math.sin(rad) };
}

/** Radius of the delay arc around the disc of "Defense" (the disc has radius 9, 9.7). */
const ARC_RADIUS = 9 + DEFENSE_ARC.gap + DEFENSE_ARC.width / 2;
/** The pill "◇ +N" at the head of an own planned ribbon (screen px): the diamond, the padding, the height. */
const BONUS_PILL = { diamond: 5, gap: 4, padX: 7, height: 20, rise: 24, back: 8 } as const;
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
 * arrows drawn the same way from the intent (`origin -> target`, an arc to the left of the way, or
 * along the server's path of an own order, ending in the centre of the target city: the client
 * finds no route), filling from the start to the tip while the delay runs and pulsing once when it
 * ends, the ring around the target of an enemy intent
 * (`--warn` over an own city: it is coming for you), the shield disc of "Defense" with its delay
 * arc, and the thin order lines with running chevrons of own ordinary orders. Everything is
 * redrawn every frame (a few shapes): the fill and the dashes run, the positions of own groups
 * move. "Less motion" stops the running dashes and chevrons and the pulse.
 */
export class IntentView {
  private readonly lines = new Graphics();
  private readonly ribbons = new Graphics();
  private readonly rings = new Graphics();
  private readonly arcs = new Graphics();
  private readonly icons = new Container({ label: 'intent-icons' });
  private readonly iconPool: Container[] = [];
  /** The pills of the bonus of own planned orders, a pool; drawn at one unit a screen px. */
  private readonly bonusLayer = new Container({ label: 'plan-bonus' });
  private readonly bonusPills: BonusPill[] = [];
  private readonly bonusStyle = new TextStyle({
    fontFamily: 'system-ui, sans-serif',
    fontSize: 12,
    fontWeight: '700',
    fill: PAPER,
  });
  private bonusUsed = 0;
  private resolution = 1;
  private cameraScale = 1;
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
    layers.layer.intents.addChild(this.ribbons, this.rings, this.icons, this.arcs, this.bonusLayer);
  }

  /** Texture pixels per text unit for what is drawn at one unit a CSS px (the bonus pills). */
  setScreenResolution(resolution: number): void {
    this.resolution = resolution;
    for (const pill of this.bonusPills) pill.text.resolution = resolution;
  }

  /** Camera scale (CSS px per world unit): the ribbon keeps its narrow tail readable. */
  setCameraScale(scale: number): void {
    this.cameraScale = scale;
  }

  /** `ruleset_public.orders` delays; without them the ribbons are drawn locked and no arc is drawn. */
  setDelays(delays: OrderDelays | null): void {
    this.delays = delays;
  }

  /** Ticks per second: the dashes run with the render tick, so a frozen scene holds still. */
  setTickHz(tickHz: number): void {
    this.tickHz = tickHz;
  }

  update(frame: RenderFrame, spots: ReadonlyMap<string, Point>): void {
    const { intents, nodes } = frame.base.view;
    // Own groups with a planned order: the server's path shapes the curve of their ribbon.
    const pool = frame.groups.filter((g) => g.group.order?.planned === true);
    const seconds = reducedMotion() ? 0 : frame.tick / this.tickHz;
    this.drawOrders(frame.groups, spots, seconds * CHEVRON.runSpeed);
    const run = seconds * RIBBON.runSpeed;
    this.ribbons.clear();
    this.rings.clear();
    this.arcs.clear();
    this.bonusUsed = 0;
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
        const since =
          this.delays === null ? -1 : frame.tick - (intent.created_tick + this.delays.planned);
        this.drawRibbon(intent, pool, progress, since, run);
        if (intent.owner !== this.me) {
          const warn = nodes[intent.target]?.owner === this.me;
          this.drawTargetRing(target, intent.target, warn);
        }
      } else if (intent.kind !== 'planned_move') {
        // Defense has no delay since DEC-30: its bonus grows, the disc has no arc (#318).
        this.placeIcon(icons++, intent, from, null);
      }
    }
    // Hide the icons left over from the previous frame.
    for (let i = icons; i < this.iconPool.length; i++) {
      const icon = this.iconPool[i];
      if (icon !== undefined) icon.visible = false;
    }
    for (let i = this.bonusUsed; i < this.bonusPills.length; i++) {
      const pill = this.bonusPills[i];
      if (pill !== undefined) pill.view.visible = false;
    }
  }

  destroy(): void {
    this.lines.destroy();
    this.ribbons.destroy();
    this.rings.destroy();
    this.arcs.destroy();
    this.icons.destroy({ children: true });
    this.bonusLayer.destroy({ children: true });
    this.bonusStyle.destroy();
  }

  /**
   * The ribbon of a planned order, own or the opponent's: one smooth curve from the rim of the
   * start city to the centre of the target. It bends toward the server's path when the order is an
   * own one with a clearly bent path (never a kink at each city of the path); otherwise (a
   * neighbour, the opponent's, whose path nobody sends) it is an arc to the left of the way, so it
   * never lies straight over the road. The ribbon is opaque underneath. While the delay runs
   * (`progress` < 1) the part it has filled is bright and the rest faint; `since` ticks after the
   * end of the delay it pulses once and stays locked, with a stronger contour.
   */
  private drawRibbon(
    intent: WireIntent,
    pool: RenderGroup[],
    progress: number | null,
    since: number,
    run: number,
  ): void {
    const origin = nodePoint(this.map, intent.origin);
    const target = intent.target === null ? undefined : nodePoint(this.map, intent.target);
    if (origin === undefined || target === undefined) return;
    const index = pool.findIndex(
      (g) => (g.owner ?? this.me) === intent.owner && g.group.order?.dest === intent.target,
    );
    const item = index < 0 ? undefined : pool[index];
    if (item !== undefined) pool.splice(index, 1);
    const via = (item?.group.order?.path ?? [])
      .filter((id) => id !== intent.origin && id !== intent.target)
      .map((id) => nodePoint(this.map, id))
      .filter((p): p is Point => p !== undefined);
    // One arc, as for a path of several nodes: it follows the server's path when that bends
    // clearly, else it bends to the left of the way, so it never lies straight over the road.
    const bend = orderBend(
      pathBend(origin, target, via, RIBBON.maxBend),
      RIBBON.minBend,
      RIBBON.arcBend,
    );
    const axis = ribbonAxis(
      [origin, target],
      this.radiusOf(intent.origin) + RIBBON.startGap,
      0,
      bend,
    );
    const ribbon = ribbonOutline(axis, ribbonBody(this.cameraScale));
    if (ribbon === null) return;
    const g = this.ribbons;
    const color = ownerColor(this.me, intent.owner);
    const own = intent.owner === this.me;
    // The bonus of the plan (DEC-29) is the server's number and only the owner's view has it
    // (the opponent's intent has no size and no bonus): "◇ +N" at the head, dashed while a forecast.
    const bonus = own ? (item?.group.order?.bonus ?? 0) : 0;
    if (bonus > 0) {
      this.placeBonus(this.bonusUsed++, ribbon, bonus, progress === null || progress < 1, color);
    }
    const poly = flat(ribbon.outline);
    // The tail dot (own) or the hollow diamond (opponent) repeat the side without colour.
    g.poly(poly).stroke({
      width: RIBBON.casing.width,
      color: BG,
      alpha: RIBBON.casing.alpha,
      join: 'round',
    });
    // Opaque dark under the tint: the road below does not show through the ribbon.
    g.poly(poly).fill(RIBBON.underlay);
    const left = progress === null || progress < 1;
    // The pulse after the delay: one swell, then the order stays locked (stronger contour).
    const pulse = departPulse(since, RIBBON.pulseTicks, reducedMotion());
    const fillAlpha = RIBBON.fillAlpha + RIBBON.locked.fillBoost * pulse.lock;
    if (progress === null || !left) {
      g.poly(poly).fill({ color, alpha: fillAlpha });
    } else {
      // The delay runs: the whole arrow is outlined faintly and fills from the start to the tip.
      g.poly(poly).fill({ color, alpha: RIBBON.idleAlpha });
      const filled = ribbonFilled(ribbon.outline, axis, progress);
      if (filled.length >= 3) g.poly(flat(filled)).fill({ color, alpha: fillAlpha });
    }
    if (pulse.swell > 0) {
      g.poly(poly).fill({ color: PAPER, alpha: RIBBON.flashAlpha * pulse.swell });
    }
    const width =
      RIBBON.contour.width +
      (RIBBON.locked.width - RIBBON.contour.width) * pulse.lock +
      RIBBON.pulseWidth * pulse.swell;
    const alpha = RIBBON.contour.alpha + (RIBBON.locked.alpha - RIBBON.contour.alpha) * pulse.lock;
    const style = { width, color, alpha };
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

  private bonusPill(index: number): BonusPill {
    let pill = this.bonusPills[index];
    if (pill === undefined) {
      const view = this.bonusLayer.addChild(new Container({ label: 'plan-bonus-pill' }));
      const plate = view.addChild(new Graphics());
      const text = view.addChild(
        new Text({
          text: '',
          style: this.bonusStyle,
          anchor: { x: 0, y: 0.5 },
          resolution: this.resolution,
        }),
      );
      pill = { view, plate, text, key: '' };
      this.bonusPills.push(pill);
    }
    return pill;
  }

  /**
   * The pill "◇ +N" over the head of an own planned ribbon, N the server's bonus of the order
   * (`OrderView.bonus`). Before the group leaves it is a forecast (the cap is taken at the
   * departure): the outline is dashed, then it turns solid. Drawn at one unit a screen px.
   */
  private placeBonus(
    index: number,
    ribbon: { tip: Point; body: readonly Point[] },
    bonus: number,
    forecast: boolean,
    color: number,
  ): void {
    const pill = this.bonusPill(index);
    const label = `+${String(bonus)}`;
    if (pill.text.text !== label) pill.text.text = label;
    const { diamond, gap, padX, height } = BONUS_PILL;
    const width = padX * 2 + diamond * 2 + gap + pill.text.width;
    const key = `${label}|${forecast ? 'f' : 's'}|${String(Math.round(width))}|${String(color)}`;
    if (pill.key !== key) {
      pill.key = key;
      // Forecast or locked: the dashed or the solid outline, told in the label for the tests too.
      pill.view.label = forecast ? 'plan-bonus-pill:forecast' : 'plan-bonus-pill:locked';
      const g = pill.plate.clear();
      const left = -width / 2;
      g.roundRect(left, -height / 2, width, height, height / 2).fill({
        color: PLATE_FILL,
        alpha: 0.96,
      });
      if (forecast) {
        for (const dash of dashAlong(
          roundRectPoints(width, height, height / 2),
          3.5,
          2.5,
          0,
          true,
        )) {
          const [first, ...rest] = dash;
          if (first === undefined) continue;
          g.moveTo(first.x, first.y);
          for (const p of rest) g.lineTo(p.x, p.y);
        }
        g.stroke({ width: 1.6, color, cap: 'round' });
      } else {
        g.roundRect(left, -height / 2, width, height, height / 2).stroke({ width: 1.8, color });
      }
      const cx = left + padX + diamond;
      g.poly([cx - diamond, 0, cx, -diamond, cx + diamond, 0, cx, diamond]).stroke({
        width: 1.6,
        color: PAPER,
        join: 'round',
      });
      pill.text.position.set(left + padX + diamond * 2 + gap, 0);
    }
    const base = ribbon.body[ribbon.body.length - 1] ?? ribbon.tip;
    const length = Math.hypot(ribbon.tip.x - base.x, ribbon.tip.y - base.y) || 1;
    const ux = (ribbon.tip.x - base.x) / length;
    const uy = (ribbon.tip.y - base.y) / length;
    const k = 1 / this.cameraScale;
    pill.view.scale.set(k);
    pill.view.position.set(
      ribbon.tip.x - ux * BONUS_PILL.back * k,
      ribbon.tip.y + (-uy * BONUS_PILL.back - BONUS_PILL.rise) * k,
    );
    pill.view.visible = true;
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
  private drawOrders(
    groups: readonly RenderGroup[],
    points: ReadonlyMap<string, Point>,
    run: number,
  ): void {
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
      this.drawAhead(ahead, color, order.dest, run);
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
  private drawAhead(ahead: readonly Point[], color: number, dest: number, run: number): void {
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
      run,
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
