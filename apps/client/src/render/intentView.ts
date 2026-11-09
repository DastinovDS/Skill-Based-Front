import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { RenderFrame, RenderGroup } from '../net/interpolate.ts';
import type { IntentView as WireIntent, MapFile, PlayerId } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import { ringRadius } from './cityLayout.ts';
import { drawCasedArrow, drawWalkedDots, trimPath } from './casedArrow.ts';
import { HatchTile, hairFloor } from './engraving.ts';
import {
  arrivalAngle,
  bonusSpot,
  delayProgress,
  frontLine,
  marchIn,
  ribbonFilled,
  ribbonOutline,
  ribbonShape,
  tailStart,
} from './intentLayout.ts';
import type { MapLayers } from './layers.ts';
import { nodePoint } from './layout.ts';
import { reducedMotion } from './motion.ts';
import { splitOrder, trackOrder } from './orderTrack.ts';
import { chevronHalfWidth, drawBonusChevron } from './bonusChevron.ts';
import { pieceFamily, usePieceFont } from './pieceFont.ts';
import { planShown, planStep, type PlanFill } from './planFill.ts';
import type { OrderDelays } from './source.ts';
import {
  CASED,
  CASING,
  DARK_PLATE,
  FINE_RING,
  INK,
  ownerColor,
  RIBBON_ENGRAVED,
  WARN,
} from './style.ts';
import { easeTravel } from '../theme/tokens.ts';

/** One pill of the bonus of an own planned order. */
interface BonusPill {
  readonly view: Container;
  readonly plate: Graphics;
  readonly text: Text;
  /** What the plate was drawn for; redrawn only when it changes. */
  key: string;
}

/** A charge on its way from the warehouse into the tail of a gathering plan. */
interface Flight {
  readonly group: string;
  readonly from: Point;
  readonly start: number;
}

const flat = (points: readonly Point[]): number[] => points.flatMap((p) => [p.x, p.y]);

/**
 * What the players intend, on the map, in the Engraved style (#851, part 3 of #829; ui-style 53 to
 * 55, mockup `in-game-style-r5.html`, Combined view):
 *
 * - the arrow of every own ordinary order, Cased running (`casedArrow.ts`), along the server's path
 *   from the group to a Fine ring round the target; the part walked as ink dots;
 * - the ribbon of a scheduled order of either side (the intent `origin -> target`, an arc that
 *   bulges up, following the server's path of an own order): a dark plate under the owner's hatch,
 *   an ink outline; own: the prepared share solid behind a burin front, a dot at the tail; the
 *   enemy's: a second contour inside, a ring in a ring at the tail, and an arc round its target
 *   facing the way it comes (amber with chevrons marching in over an own city);
 * - the fill of a gathering plan, Eased steps: a tween between the server's bonuses, the charge
 *   flying in from the warehouse, and a pill with a chevron slot per asked bonus.
 *
 * Everything is redrawn every frame (a few shapes per order): the burin points run, the fill eases,
 * own groups move. "Less motion" stops the running marks and makes the fill jump.
 */
export class IntentView {
  private readonly lines = new Graphics({ label: 'order-arrows' });
  private readonly ribbons = new Graphics({ label: 'order-ribbons' });
  private readonly rings = new Graphics({ label: 'order-rings' });
  private readonly flights = new Graphics({ label: 'plan-flights' });
  /** The pills of the bonus of own planned orders, a pool; drawn at one unit a screen px. */
  private readonly bonusLayer = new Container({ label: 'plan-bonus' });
  private readonly bonusPills: BonusPill[] = [];
  private readonly bonusStyle = new TextStyle({
    fontFamily: pieceFamily(),
    fontSize: RIBBON_ENGRAVED.pill.fontSize,
    fontWeight: '600',
    fill: INK,
  });
  /** The owner hatches of the ribbons, in zoom buckets. */
  private readonly ownHatch = new HatchTile(RIBBON_ENGRAVED.own);
  private readonly enemyHatch = new HatchTile(RIBBON_ENGRAVED.enemy);
  private bonusUsed = 0;
  private resolution = 1;
  private deviceResolution = 1;
  private cameraScale = 1;
  /** The chain of nodes of each own ordinary order, kept while the order lives (`orderTrack.ts`). */
  private readonly chains = new Map<string, number[]>();
  /** The eased fill of each gathering plan, by group. */
  private readonly fills = new Map<string, PlanFill>();
  private flightsLive: Flight[] = [];
  /** Where the tail of each gathering plan is, this frame (the charges fly there). */
  private readonly tailOf = new Map<string, Point>();
  /** The charges in the warehouses of the latest view, by node (a gathered one left the first empty place). */
  private stock: readonly { readonly warehouse: number | null }[] = [];
  private delays: OrderDelays | null = null;
  private tickHz = 10;
  /** Where a charge of a city's warehouse sits (`CityView.warehouseSlot`); `null`: not known. */
  private slotOf: (node: number, index: number) => Point | null = () => null;

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    private readonly me: PlayerId,
    private readonly radiusOf: (node: number) => number,
  ) {
    // Order arrows go under the tokens of the groups they belong to; ribbons of intents on top.
    layers.layer.groups.addChildAt(this.lines, 0);
    layers.layer.intents.addChild(this.ribbons, this.rings, this.flights, this.bonusLayer);
    usePieceFont([this.bonusStyle]);
    this.ownHatch.update(1, 1);
    this.enemyHatch.update(1, 1);
  }

  /** Texture pixels per text unit for what is drawn at one unit a CSS px (the bonus pills). */
  setScreenResolution(resolution: number): void {
    this.resolution = resolution;
    for (const pill of this.bonusPills) pill.text.resolution = resolution;
  }

  /** The device pixel ratio: hairlines keep one device pixel, hatches their screen pitch. */
  setDeviceResolution(resolution: number): void {
    this.deviceResolution = resolution;
    this.ownHatch.update(this.cameraScale, resolution);
    this.enemyHatch.update(this.cameraScale, resolution);
  }

  /** Camera scale (CSS px per world unit): the ribbon keeps its narrow tail readable. */
  setCameraScale(scale: number): void {
    this.cameraScale = scale;
    this.ownHatch.update(scale, this.deviceResolution);
    this.enemyHatch.update(scale, this.deviceResolution);
  }

  /** `ruleset_public.orders` delays; without them the ribbons are drawn locked. */
  setDelays(delays: OrderDelays | null): void {
    this.delays = delays;
  }

  /** Ticks per second: the marks run with the render tick, so a frozen scene holds still. */
  setTickHz(tickHz: number): void {
    this.tickHz = tickHz;
  }

  /** Where the warehouse of a city keeps its charge `index` (a gathered charge flies from there). */
  setWarehouseSlots(slotOf: (node: number, index: number) => Point | null): void {
    this.slotOf = slotOf;
  }

  update(frame: RenderFrame, spots: ReadonlyMap<string, Point>): void {
    const { intents, nodes } = frame.base.view;
    // Own groups with a planned order: the server's path shapes the curve of their ribbon.
    const pool = frame.groups.filter((g) => g.group.order?.planned === true);
    const reduced = reducedMotion();
    const clock = frame.tick / this.tickHz;
    const seconds = reduced ? 0 : clock;
    const hair = hairFloor(this.cameraScale, this.deviceResolution);
    this.stock = nodes;
    this.drawOrders(frame.groups, spots, seconds, hair);
    this.ribbons.clear();
    this.rings.clear();
    this.flights.clear();
    this.bonusUsed = 0;
    const gathering = new Set<string>();
    for (const intent of intents) {
      if (intent.target === null) continue;
      const progress =
        this.delays === null
          ? null
          : delayProgress(intent.created_tick, frame.tick, this.delays.planned);
      const id = this.drawRibbon(
        intent,
        pool,
        progress,
        clock,
        reduced,
        hair,
        nodes[intent.target]?.owner,
      );
      if (id !== null) gathering.add(id);
      // The sign of "Defense" is the city's own (`DefenseView`, #349).
    }
    for (const id of this.fills.keys()) if (!gathering.has(id)) this.fills.delete(id);
    this.drawFlights(clock, reduced);
    for (let i = this.bonusUsed; i < this.bonusPills.length; i++) {
      const pill = this.bonusPills[i];
      if (pill !== undefined) pill.view.visible = false;
    }
  }

  destroy(): void {
    this.lines.destroy();
    this.ribbons.destroy();
    this.rings.destroy();
    this.flights.destroy();
    this.bonusLayer.destroy({ children: true });
    this.bonusStyle.destroy();
    this.ownHatch.destroy();
    this.enemyHatch.destroy();
  }

  /**
   * The ribbon of a scheduled order, own or the opponent's. Returns the group id of an own plan
   * that gathers its bonus (its fill tween is kept), else `null`.
   */
  private drawRibbon(
    intent: WireIntent,
    pool: RenderGroup[],
    progress: number | null,
    clock: number,
    reduced: boolean,
    hair: number,
    targetOwner: PlayerId | null | undefined,
  ): string | null {
    const origin = nodePoint(this.map, intent.origin);
    const target = intent.target === null ? undefined : nodePoint(this.map, intent.target);
    if (origin === undefined || target === undefined || intent.target === null) return null;
    const index = pool.findIndex(
      (g) => (g.owner ?? this.me) === intent.owner && g.group.order?.dest === intent.target,
    );
    const item = index < 0 ? undefined : pool[index];
    if (item !== undefined) pool.splice(index, 1);
    const via = (item?.group.order?.path ?? [])
      .filter((id) => id !== intent.origin && id !== intent.target)
      .map((id) => nodePoint(this.map, id))
      .filter((p): p is Point => p !== undefined);
    const own = intent.owner === this.me;
    const radius = this.radiusOf(intent.origin);
    const ring = ringRadius(this.radiusOf(intent.target));
    const E = RIBBON_ENGRAVED;
    const endGap = own
      ? ring + CASED.endGap
      : ring + FINE_RING.r2 + E.attack.width / 2 + E.attack.foeGap;
    const shape = ribbonShape(
      origin,
      target,
      via,
      tailStart(origin, target, radius),
      endGap,
      this.cameraScale,
    );
    if (shape === null) return null;
    const { axis, ribbon, bend, body } = shape;
    const color = ownerColor(this.me, intent.owner);
    // Economy v2 (DEC-41, item 10): an own plan that gathers its bonus fills as the bonus grows
    // (the server's `bonus` of the requested `plan`), eased step by step; economy v1 by its delay.
    const order = item?.group.order;
    const gatheringOn = own && order?.gathering === true && item !== undefined;
    let fill: number | null = progress;
    if (gatheringOn) {
      const fillOf = this.planFill(item.group.id, order.bonus, intent.origin, clock, reduced);
      fill = order.plan > 0 ? Math.min(1, fillOf / order.plan) : 0;
    }
    const prepared = own ? (fill ?? 1) : 0;
    const g = this.ribbons;
    const poly = flat(ribbon.outline);
    const tile = own ? this.ownHatch : this.enemyHatch;
    const hatch = own ? E.own : E.enemy;

    g.poly(poly).stroke({ width: E.casing, color: CASING, join: 'round' });
    g.poly(poly).fill({ color: DARK_PLATE, alpha: E.plateAlpha });
    g.poly(poly).fill({
      texture: tile.texture,
      textureSpace: 'global',
      matrix: tile.matrix(hatch.angle),
      color,
      alpha: hatch.alpha,
    });
    if (prepared > 0) {
      const filled = ribbonFilled(ribbon.outline, axis, prepared);
      if (filled.length >= 3) g.poly(flat(filled)).fill({ color });
    }
    if (own && prepared > 0 && prepared < 1) this.drawFront(axis, prepared, body, bend, hair);
    g.poly(poly).stroke({ width: Math.max(E.outline, hair), color: INK, join: 'round' });
    if (!own) {
      const inner = ribbonOutline(axis, body * E.inner.share);
      if (inner !== null)
        g.poly(flat(inner.outline)).stroke({
          width: Math.max(E.inner.width, hair),
          color: INK,
          alpha: E.inner.alpha,
          join: 'round',
        });
    }
    const start = axis[0];
    if (start !== undefined) {
      const T = E.tail;
      g.circle(start.x, start.y, own ? T.own : T.enemy)
        .fill(CASING)
        .stroke({ width: T.ink, color: INK });
      if (!own) g.circle(start.x, start.y, T.inner).stroke({ width: T.innerInk, color: INK });
    }
    if (own) {
      // The bonus of the plan (DEC-29) is the server's number and only the owner's view has it.
      const bonus = order?.bonus ?? 0;
      if (bonus > 0 || gatheringOn) {
        const spot = bonusSpot(axis, bend, body, E.pill.height / 2 / this.cameraScale);
        if (spot !== null)
          this.placeBonus(this.bonusUsed++, spot, bonus, gatheringOn ? order.plan : null);
      }
    } else {
      this.drawTarget(
        target,
        ring,
        arrivalAngle(axis),
        targetOwner === this.me,
        clock,
        reduced,
        hair,
      );
    }
    if (gatheringOn) this.tailOf.set(item.group.id, start ?? origin);
    return gatheringOn ? item.group.id : null;
  }

  /** The bonus shown for the plan of `group` now; a new server value starts a step (and a flight). */
  private planFill(
    group: string,
    value: number,
    origin: number,
    clock: number,
    reduced: boolean,
  ): number {
    const { fill, gained } = planStep(this.fills.get(group) ?? null, value, clock, reduced);
    this.fills.set(group, fill);
    if (gained > 0 && !reduced) {
      // The charges left the warehouse: they fly from the first empty places of its row.
      for (let k = 0; k < gained; k++) {
        const stock = this.stock[origin]?.warehouse ?? 0;
        const from = this.slotOf(origin, stock + k);
        if (from !== null) this.flightsLive.push({ group, from, start: clock });
      }
    }
    return planShown(fill, clock);
  }

  /** The burin front across the fill: a casing and an ink line, a small ink lozenge on the outer edge. */
  private drawFront(
    axis: readonly Point[],
    share: number,
    body: number,
    bend: number,
    hair: number,
  ): void {
    const front = frontLine(axis, share, body);
    if (front === null) return;
    const F = RIBBON_ENGRAVED.front;
    const g = this.ribbons;
    const [a, b] = front;
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: F.casing, color: CASING, cap: 'round' });
    g.moveTo(a.x, a.y)
      .lineTo(b.x, b.y)
      .stroke({ width: Math.max(F.ink, hair), color: INK, cap: 'round' });
    // `frontLine` puts first the side `bend > 0` pushes to: the outer side of the arc.
    const outer = bend > 0 ? a : b;
    const h = (F.lozenge * Math.SQRT2) / 2;
    g.poly([
      outer.x,
      outer.y - h,
      outer.x + h,
      outer.y,
      outer.x,
      outer.y + h,
      outer.x - h,
      outer.y,
    ]).fill(INK);
  }

  /**
   * The target of an enemy order (Fine rings 'att'): an arc at `R + r2` facing the way the ribbon
   * comes in, a tick at each end; over an own city amber, with three chevrons marching in.
   */
  private drawTarget(
    at: Point,
    ring: number,
    toward: number,
    warn: boolean,
    clock: number,
    reduced: boolean,
    hair: number,
  ): void {
    const A = RIBBON_ENGRAVED.attack;
    const g = this.rings;
    const color = warn ? WARN : ownerColor(this.me, this.me === 0 ? 1 : 0);
    const r = ring + FINE_RING.r2;
    const a0 = toward - A.span;
    const a1 = toward + A.span;
    const arc = (): void => {
      g.moveTo(at.x + r * Math.cos(a0), at.y + r * Math.sin(a0)).arc(at.x, at.y, r, a0, a1);
    };
    arc();
    g.stroke({ width: A.width + FINE_RING.casing, color: CASING, cap: 'butt' });
    arc();
    g.stroke({ width: Math.max(A.width, hair), color, cap: 'butt' });
    const ticks = (pad: number): void => {
      for (const e of [a0, a1]) {
        const c = Math.cos(e);
        const s = Math.sin(e);
        g.moveTo(at.x + c * (r - A.tick - pad), at.y + s * (r - A.tick - pad)).lineTo(
          at.x + c * (r + A.tick + pad),
          at.y + s * (r + A.tick + pad),
        );
      }
    };
    ticks(0.8);
    g.stroke({ width: A.tickWidth + A.tickCasing, color: CASING, cap: 'butt' });
    ticks(0);
    g.stroke({ width: Math.max(A.tickWidth, hair), color, cap: 'butt' });
    if (!warn) return;
    const M = RIBBON_ENGRAVED.march;
    const c = Math.cos(toward);
    const s = Math.sin(toward);
    for (const { d, alpha } of marchIn(r, clock, reduced)) {
      if (alpha <= 0) continue;
      // A barbed point turned to the city: `tip` towards the centre.
      const x = at.x + c * d;
      const y = at.y + s * d;
      const point = [
        x - c * M.tip,
        y - s * M.tip,
        x + c * M.back - s * M.side,
        y + s * M.back + c * M.side,
        x + c * M.notch,
        y + s * M.notch,
        x + c * M.back + s * M.side,
        y + s * M.back - c * M.side,
      ];
      g.poly(point)
        .stroke({ width: M.casing, color: CASING, alpha, join: 'round' })
        .fill({ color: WARN, alpha });
    }
  }

  /** The charges flying from the warehouse into the tail of their plan (0.5 s each, an arc up). */
  private drawFlights(clock: number, reduced: boolean): void {
    const E = RIBBON_ENGRAVED;
    const span = E.flightMs / 1000;
    this.flightsLive = this.flightsLive.filter(
      (f) => !reduced && clock - f.start >= 0 && clock - f.start < span && this.tailOf.has(f.group),
    );
    const g = this.flights;
    for (const f of this.flightsLive) {
      const to = this.tailOf.get(f.group);
      if (to === undefined) continue;
      const q = easeTravel((clock - f.start) / span);
      const x = f.from.x + (to.x - f.from.x) * q;
      const y = f.from.y + (to.y - f.from.y) * q - Math.sin(q * Math.PI) * E.flightLift;
      const o = E.charge.outer / Math.SQRT2;
      const i = E.charge.inner / Math.SQRT2;
      g.poly([x, y - o, x + o, y, x, y + o, x - o, y]).fill(CASING);
      g.poly([x, y - i, x + i, y, x, y + i, x - i, y]).fill(ownerColor(this.me, this.me));
    }
    this.tailOf.clear();
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
   * The pill beside an own planned ribbon at `spot` (world units, from `bonusSpot`), drawn at one
   * unit a screen px on a thin Engraved panel. A gathering plan (economy v2, `plan` its asked bonus)
   * shows a chevron slot per asked bonus, solid when gathered (Eased steps with slots, 54e); else
   * the chevron and "+N", N the server's bonus (DEC-29).
   */
  private placeBonus(index: number, spot: Point, bonus: number, plan: number | null): void {
    const pill = this.bonusPill(index);
    const P = RIBBON_ENGRAVED.pill;
    const slots = plan === null ? 0 : Math.min(Math.max(plan, 1), P.slots);
    const label = plan === null ? `+${String(bonus)}` : '';
    if (pill.text.text !== label) pill.text.text = label;
    pill.text.visible = plan === null;
    const half = chevronHalfWidth(P.chevron);
    const width =
      plan === null
        ? P.pad * 2 + half * 2 + P.gap + pill.text.width
        : P.pad * 2 + (slots - 1) * P.slot + half * 2;
    const gathered = Math.min(bonus, slots);
    const key = `${label}|${String(slots)}:${String(gathered)}|${String(Math.round(width))}`;
    if (pill.key !== key) {
      pill.key = key;
      // Told in the label for the tests too: the slots of a gathering plan, or the number.
      pill.view.label =
        plan === null
          ? 'plan-bonus-pill:number'
          : `plan-bonus-pill:slots:${String(gathered)}/${String(slots)}`;
      const g = pill.plate.clear();
      const left = -width / 2;
      g.rect(left, -P.height / 2, width, P.height).fill({ color: DARK_PLATE, alpha: P.plateAlpha });
      g.rect(left + 0.5, -P.height / 2 + 0.5, width - 1, P.height - 1).stroke({
        width: 1,
        color: INK,
        alpha: P.rimAlpha,
      });
      const first = left + P.pad + half;
      if (plan === null) {
        drawBonusChevron(g, first, 0.5, P.chevron);
        pill.text.position.set(first + half + P.gap, 0);
      } else {
        for (let j = 0; j < slots; j++)
          drawBonusChevron(g, first + j * P.slot, 0.5, P.chevron, j >= gathered);
      }
    }
    pill.view.scale.set(1 / this.cameraScale);
    pill.view.position.set(spot.x, spot.y);
    pill.view.visible = true;
  }

  /**
   * The arrow of every own ordinary order: from where the order began to its target, along the
   * server's path, Cased running; the walked part of the current road as ink dots, the roads behind
   * gone; a Fine ring in the own colour round the target. A planned order is the ribbon's job.
   */
  private drawOrders(
    groups: readonly RenderGroup[],
    points: ReadonlyMap<string, Point>,
    seconds: number,
    hair: number,
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
      // The arrow leaves the ring of the city it began in.
      const first = places[0];
      const second = places[1];
      if (first === undefined || second === undefined) continue;
      const lead = ringRadius(this.radiusOf(tracked.chain[0] ?? start)) + CASED.startGap;
      const gap = Math.hypot(second.x - first.x, second.y - first.y) || 1;
      places[0] = {
        x: first.x + ((second.x - first.x) / gap) * lead,
        y: first.y + ((second.y - first.y) / gap) * lead,
      };
      const { walked, ahead } = splitOrder(places, tracked.segment, unit);
      drawWalkedDots(g, walked, hair);
      const target = places[places.length - 1];
      const ring = ringRadius(this.radiusOf(order.dest));
      const arrow = trimPath(ahead, 0, ring + CASED.endGap);
      drawCasedArrow(g, arrow, { color, seconds, hair, zoom: this.cameraScale });
      if (target !== undefined) {
        const r = ring + FINE_RING.r1;
        g.circle(target.x, target.y, r).stroke({
          width: CASED.target.width + FINE_RING.casing,
          color: CASING,
          alpha: CASED.target.alpha,
        });
        g.circle(target.x, target.y, r).stroke({
          width: Math.max(CASED.target.width, hair),
          color,
          alpha: CASED.target.alpha,
        });
      }
    }
    for (const id of this.chains.keys()) {
      if (!live.has(id)) this.chains.delete(id);
    }
  }
}
