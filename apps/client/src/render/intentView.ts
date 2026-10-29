import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { RenderFrame, RenderGroup } from '../net/interpolate.ts';
import type { IntentView as WireIntent, MapFile, PlayerId } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import {
  bonusSpot,
  chevrons,
  dashAlong,
  delayProgress,
  departPulse,
  frontLine,
  orderBend,
  pathBend,
  polylineLength,
  ribbonAxis,
  ribbonBody,
  ribbonFilled,
  ribbonOutline,
  ribbonSlice,
  ringDashes,
  ringOpacity,
  roundRectPoints,
  sheenPhase,
  sheenSpan,
  signRim,
  tailStart,
} from './intentLayout.ts';
import type { MapLayers } from './layers.ts';
import { nodePoint } from './layout.ts';
import { reducedMotion } from './motion.ts';
import { splitOrder, trackOrder } from './orderTrack.ts';
import { lighten } from './fightFx.ts';
import type { OrderDelays } from './source.ts';
import { BG, CHEVRON, ORDER_LINE, ownerColor, PAPER, PLATE_FILL, RIBBON, WARN } from './style.ts';

/** One pill of the bonus of an own planned order. */
interface BonusPill {
  readonly view: Container;
  readonly plate: Graphics;
  readonly text: Text;
  /** What the plate was drawn for: the number, forecast or not, the width; redrawn only when it changes. */
  key: string;
}

/** The pill "◇ +N" beside an own planned ribbon (screen px): the diamond, the padding, the height. */
const BONUS_PILL = { diamond: 5, gap: 4, padX: 7, height: 20 } as const;
const flat = (points: readonly Point[]): number[] => points.flatMap((p) => [p.x, p.y]);

/**
 * What the players intend, on the map (ui-style 9.7): planned orders of both sides as ribbon
 * arrows drawn the same way from the intent (`origin -> target`, an arc to the left of the way, or
 * along the server's path of an own order, ending in the centre of the target city: the client
 * finds no route), filling from the start to the tip while the delay runs and pulsing once when it
 * ends, the ring around the target of an enemy intent
 * (`--warn` over an own city: it is coming for you), and the thin order lines with running chevrons of own ordinary orders. Everything is
 * redrawn every frame (a few shapes): the fill and the dashes run, the positions of own groups
 * move. "Less motion" stops the running dashes and chevrons and the pulse.
 */
export class IntentView {
  private readonly lines = new Graphics();
  private readonly ribbons = new Graphics();
  private readonly rings = new Graphics();
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
    private readonly radiusOf: (node: number) => number,
  ) {
    // Order lines go under the tokens of the groups they belong to; arrows of intents on top.
    layers.layer.groups.addChildAt(this.lines, 0);
    layers.layer.intents.addChild(this.ribbons, this.rings, this.bonusLayer);
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
    this.ribbons.clear();
    this.rings.clear();
    this.bonusUsed = 0;
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
        this.drawRibbon(intent, pool, progress, since, seconds, nodes[intent.target]?.owner);
      }
      // The sign of "Defense" is the city's own (`DefenseView`, #349).
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
    this.bonusLayer.destroy({ children: true });
    this.bonusStyle.destroy();
  }

  /**
   * The ribbon of a planned order, own or the opponent's (ODb "Low relief", #519): one smooth arc
   * from the tail beside the start city to the head at the target, always bulging toward the top of
   * the screen (it never runs over a caption), drawn as one closed outline. The own head stops just
   * outside the capacity ring of the target; the opponent's on the dashed ring round it. The arc
   * follows the server's path of an own order only when that path also bulges up. While the delay
   * runs (`progress` < 1) the filled part is bright, the rest a faint tint, with a paper line at
   * the front; `since` ticks after the end of the delay it pulses once, then the ribbon is one flat
   * tone with a soft band that runs along it. Layers, bottom to top: shadow, underlay, tint and
   * fill, pulse, outline (own: casing and a line; the opponent's: a double line).
   */
  private drawRibbon(
    intent: WireIntent,
    pool: RenderGroup[],
    progress: number | null,
    since: number,
    seconds: number,
    targetOwner: PlayerId | null | undefined,
  ): void {
    const origin = nodePoint(this.map, intent.origin);
    const target = intent.target === null ? undefined : nodePoint(this.map, intent.target);
    if (origin === undefined || target === undefined || intent.target === null) return;
    const index = pool.findIndex(
      (g) => (g.owner ?? this.me) === intent.owner && g.group.order?.dest === intent.target,
    );
    const item = index < 0 ? undefined : pool[index];
    if (item !== undefined) pool.splice(index, 1);
    const via = (item?.group.order?.path ?? [])
      .filter((id) => id !== intent.origin && id !== intent.target)
      .map((id) => nodePoint(this.map, id))
      .filter((p): p is Point => p !== undefined);
    const bend = orderBend(
      target.x - origin.x,
      pathBend(origin, target, via, RIBBON.maxBend),
      RIBBON.minBend,
      RIBBON.arcBend,
    );
    const own = intent.owner === this.me;
    const radius = this.radiusOf(intent.origin);
    const targetRadius = this.radiusOf(intent.target);
    const axis = ribbonAxis(
      [origin, target],
      tailStart(origin, target, radius),
      own ? signRim(targetRadius) + RIBBON.ownEndGap : targetRadius + RIBBON.foeEndGap,
      bend,
    );
    const body = ribbonBody(this.cameraScale);
    const ribbon = ribbonOutline(axis, body);
    if (ribbon === null) return;
    const color = ownerColor(this.me, intent.owner);
    const prep = progress !== null && progress < 1;
    const pulse = departPulse(since, RIBBON.pulseTicks, reducedMotion());
    const g = this.ribbons;
    const poly = flat(ribbon.outline);

    // The cast shadow: the same outline moved a little down and to the right.
    const { shadow } = RIBBON;
    g.poly(ribbon.outline.flatMap((p) => [p.x + shadow.dx, p.y + shadow.dy])).fill({
      color: BG,
      alpha: shadow.alpha,
    });
    // Opaque dark under the tint: the road below does not show through the ribbon.
    g.poly(poly).fill(RIBBON.underlay);
    if (prep) {
      // The delay runs: the whole arrow is a faint tint and fills from the tail to the head.
      g.poly(poly).fill({ color, alpha: RIBBON.tintAlpha });
      const filled = ribbonFilled(ribbon.outline, axis, progress);
      if (filled.length >= 3) g.poly(flat(filled)).fill({ color, alpha: RIBBON.prepAlpha });
      const front = frontLine(axis, progress, body);
      if (front !== null) {
        g.moveTo(front[0].x, front[0].y).lineTo(front[1].x, front[1].y);
        g.stroke({ width: RIBBON.front.width, color: PAPER, cap: 'round' });
      }
    } else {
      g.poly(poly).fill({ color, alpha: RIBBON.fillAlpha });
      if (!reducedMotion()) {
        // The soft band that runs along the ribbon after the departure.
        const span = sheenSpan(polylineLength(axis), sheenPhase(seconds));
        const band = span === null ? [] : ribbonSlice(ribbon.outline, axis, span.from, span.to, body);
        if (band.length >= 3) g.poly(flat(band)).fill({ color: PAPER, alpha: RIBBON.sheen.alpha });
      }
    }
    if (pulse.swell > 0) {
      g.poly(poly).fill({ color: PAPER, alpha: RIBBON.flashAlpha * pulse.swell });
    }
    if (own) {
      const { outline } = RIBBON;
      g.poly(poly).stroke({
        width: outline.casingWidth,
        color: BG,
        alpha: outline.casingAlpha,
        join: 'round',
      });
      g.poly(poly).stroke({
        width: outline.width + RIBBON.pulseWidth * pulse.swell,
        color: lighten(color, outline.lighten),
        join: 'round',
      });
    } else {
      // Two thin lines: a wide stroke in the colour with a narrower plate stroke on top.
      g.poly(poly).stroke({ width: RIBBON.foe.width, color, join: 'round' });
      g.poly(poly).stroke({ width: RIBBON.foe.inner, color: PLATE_FILL, join: 'round' });
    }
    const start = axis[0];
    if (start === undefined) return;
    const { tail } = RIBBON;
    if (own) {
      // The dot says the order is own.
      g.circle(start.x, start.y, tail.dot)
        .fill(color)
        .stroke({ width: tail.dotRing, color: PLATE_FILL });
      // The bonus of the plan (DEC-29) is the server's number and only the owner's view has it
      // (the opponent's intent has no size and no bonus): "◇ +N" beside the arc, dashed while a forecast.
      const bonus = item?.group.order?.bonus ?? 0;
      const spot =
        bonus > 0 ? bonusSpot(axis, bend, body, BONUS_PILL.height / 2 / this.cameraScale) : null;
      if (spot !== null)
        this.placeBonus(this.bonusUsed++, spot, bonus, progress === null || prep, color);
    } else {
      // The opponent's tail is a ring in a ring; the head stops on the dashed ring round the target.
      g.circle(start.x, start.y, tail.ring)
        .fill(PLATE_FILL)
        .stroke({ width: tail.ringWidth, color });
      g.circle(start.x, start.y, tail.inner).stroke({ width: tail.innerWidth, color: PAPER });
      this.drawTargetRing(target, targetRadius, targetOwner === this.me, seconds);
    }
  }

  /**
   * The ring round the target of an opponent's order: dashed, open at the bottom for the caption of
   * the city; `--warn` and pulsing over my city (it is coming for you), the opponent's red otherwise.
   */
  private drawTargetRing(at: Point, radius: number, warn: boolean, seconds: number): void {
    const g = this.rings;
    const color = warn ? WARN : ownerColor(this.me, this.me === 0 ? 1 : 0);
    const alpha = warn ? ringOpacity(seconds, reducedMotion()) : 1;
    const ring = RIBBON.ring;
    const dashes = ringDashes(at, radius + ring.gap);
    const lay = (): void => {
      for (const dash of dashes) {
        const [first, ...rest] = dash;
        if (first === undefined) continue;
        g.moveTo(first.x, first.y);
        for (const p of rest) g.lineTo(p.x, p.y);
      }
    };
    lay();
    g.stroke({ width: ring.casingWidth, color: BG, alpha: ring.casingAlpha, cap: 'round' });
    lay();
    g.stroke({ width: ring.width, color, alpha, cap: 'round' });
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
   * The pill "◇ +N" beside an own planned ribbon, at `spot` (world units, from `bonusSpot`), N the
   * server's bonus of the order (`OrderView.bonus`). Before the group leaves it is a forecast (the
   * cap is taken at the departure): the outline is dashed, then it turns solid. Drawn at one unit
   * a screen px.
   */
  private placeBonus(
    index: number,
    spot: Point,
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
    pill.view.scale.set(1 / this.cameraScale);
    pill.view.position.set(spot.x, spot.y);
    pill.view.visible = true;
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
