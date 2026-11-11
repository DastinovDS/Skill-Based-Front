import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { EventMsg, MapFile, NodeView, PlayerId, SnapshotMsg } from '../protocol.gen.ts';
import type { CityDevelopment } from './source.ts';
import { cityRadius, vpBadgeAt, showsBarracks } from './cityLayout.ts';
import {
  BUILD_BOOST,
  BUILD_PAY,
  BUILDING,
  CAPITAL_RADIUS,
  CAPTURE,
  NODE_RADIUS,
  PROVINCE,
  RECRUIT_PIPS,
  VP,
  VP_LOZENGE,
  YOU,
  otherPlayer,
  sideColours,
  sideOf,
  type PlayerColours,
} from './style.ts';
import { reducedMotion } from './motion.ts';
import { capacityPulse, type CapacityPulse } from './capacityPulse.ts';
import { EaseTween } from './tween.ts';
import { beaconPulse } from './alertLayout.ts';
import { cityDues, rallyDues } from '../hud/rallyDue.ts';
import { alertAlpha } from './progressLayout.ts';
import { buildProgress, lozengeRow, lozengeRowY, type BuildProgress } from './pieceLayout.ts';
import {
  BUILDING_KINDS,
  iconHalf,
  iconSize,
  layoutBuildings,
  owedRow,
  pipScale,
  queueSeats,
  roadAngles,
  type BuildingKind,
  type BuildingLayout,
  type OwedRow,
} from './buildingLayout.ts';
import type { MapLayers } from './layers.ts';
import type { Point } from './camera.ts';
import type { BakedSprite, SpriteCache } from './bake.ts';
import {
  cityBodySpec,
  cityRingSpec,
  helmetBackSpec,
  helmetFrontSpec,
  helmetLevelSpec,
  provinceBodySpec,
  stockColor,
  vpBadgeSpec,
  type CityKind,
} from './bakedShapes.ts';
import {
  chargeSpec,
  cpMarkGlyph,
  cpMarkSpec,
  doneRingSpec,
  iconBackSpec,
  iconFillSpec,
  iconFrontSpec,
  iconHeadSpec,
  iconSpan,
  owedSpec,
  pipAlertSpec,
  warehouseMarksSpec,
  type IconLook,
} from './pieceShapes.ts';
import { helmet } from '../units/helmet.ts';
import { pieceFamily, usePieceFont } from './pieceFont.ts';
import { PaymentLog, payShow, type Payment, type PayShow } from './buildPay.ts';
import { buildTicksShow, drawBuildTicks } from './buildTicks.ts';

/** A build of a building (barracks, factory) in an own city, as the snapshot gives it. */
interface BuildingBuild {
  /** Charges still to pay (DEC-41, item 7). */
  readonly owed: number;
  /** The charges it costs in all (`ruleset_public`); `null`: not known. */
  readonly price: number | null;
  /** The tick it ends; `null` while charges are owed. */
  readonly doneTick: number | null;
  /** Ticks of its build time (`city_upgrades.barracks_ticks`, `factory.build_ticks`). */
  readonly total: number;
}

/** What a building of a city shows. */
interface BuildingState {
  readonly built: boolean;
  readonly build: BuildingBuild | null;
  /**
   * The view says whether the city has it (`false`/`true`), not `null` ("not adjacent", DEC-31):
   * only a building known to be off turns on with a quiet ink-in (#972).
   */
  readonly known: boolean;
}

/** What a city looks like; the city is redrawn only when this changes. */
interface CityState {
  readonly owner: PlayerId | null;
  /** `null`: the capacity is not known yet (a map without a snapshot). */
  readonly capacity: number | null;
  /** Units of the viewing player standing in the city. */
  readonly garrison: number;
  /** Units of either side seen standing in the city: the body is the dark plate under their helmet. */
  readonly occupied: boolean;
  readonly warehouse: number | null;
  /** Own city: units in the recruit queue (DEC-25); `null` for the rest. */
  readonly queue: number | null;
  /** Ticks of production of the current unit. */
  readonly progress: number;
  /** Ticks per unit (`ruleset_public.recruit.unit_ticks`); `null`: no queue mark. */
  readonly unitTicks: number | null;
  /** The current unit is ready and waits for a place (DEC-25, item 7). */
  readonly waiting: boolean;
  /** A fight is going on in the city: production stands (DEC-25, item 9). */
  readonly paused: boolean;
  /** Slots of the queue a selected city shows (`recruit.queue_max`); 0: the city cannot recruit. */
  readonly queueMax: number;
  /** Places of the warehouse: the warehouse capacity (DEC-26), or the charges only. */
  readonly warehouseCap: number | null;
  /** The barracks (DEC-26) and the factory (DEC-41, item 2). */
  readonly buildings: Readonly<Record<BuildingKind, BuildingState>>;
  /**
   * #930, W4: the queued recruits that will walk to the rally point, by slot: `true` where the CP
   * now do not pay the walk. Empty without a rally point.
   */
  readonly walks: readonly boolean[];
}

function buildingKey(t: BuildingState): string {
  const b = t.build;
  return `${t.built ? 'B' : ''}${t.known ? 'k' : ''}${b === null ? '' : `${String(b.owed)}/${String(b.price)}/${String(b.doneTick)}/${String(b.total)}`}`;
}

function stateKey(s: CityState): string {
  return [
    s.owner,
    s.capacity,
    s.garrison,
    s.occupied,
    s.warehouse,
    s.queue,
    s.progress,
    s.unitTicks,
    s.waiting,
    s.paused,
    s.queueMax,
    s.warehouseCap,
    buildingKey(s.buildings.barracks),
    buildingKey(s.buildings.factory),
    s.walks.map((short) => (short ? 'x' : 'w')).join(''),
  ]
    .map(String)
    .join('|');
}

/** The sprites of one building (barracks, factory) of a city, and its build. */
interface BuildingSlot {
  readonly kind: BuildingKind;
  /** The node of its city. */
  readonly node: number;
  /** At the icon's seat, scaled to its size: the menu's art in its 26-unit box. */
  readonly root: Container;
  readonly back: BakedSprite;
  /** The fill of a build's time, shown from the bottom by a crop. */
  readonly fill: BakedSprite;
  /** The ivory head line of the fill. */
  readonly head: BakedSprite;
  readonly front: BakedSprite;
  /** The ring that opens from an icon just built. */
  readonly ring: BakedSprite;
  /** The owed charges of a build, one lozenge each, beside the icon (hollow owed, solid paid). */
  readonly row: Container;
  /** The lozenges of a payment that run into the icon (#872), over the row. */
  readonly loose: Container;
  /** Where the icon stands now (from the city centre), its size and its direction from the centre. */
  seat: Point;
  size: number;
  angle: number;
  /** The row of the build now (`null`: none). */
  owed: OwedRow | null;
  /** The build under way (`null`: none), its colour and side. */
  build: BuildingBuild | null;
  color: number;
  /** The owner's look the icon was built with (`null`: not built), to cross-fade a capture. */
  builtKey: string | null;
  /** The fade of the ring once the build is done (`null`: none). */
  done: EaseTween | null;
  /** The corner ticks round a building just finished (#972), and ms since the finish (`null`: none). */
  readonly ticks: Graphics;
  tickMs: number | null;
  tickKey: string;
  /** The quiet ink-in of an enemy building the view just turned on (#972; `null`: none). */
  ink: EaseTween | null;
  /** The owner of the city when the view last said it has no such building (`null`: not so). */
  off: PlayerId | null;
  /** The payment in motion now and the cost it was laid out for (`null`: none). */
  pay: { show: PayShow; cost: number } | null;
}

/**
 * How far back a payment may still move, ms: longer than any flight, pop and run (`paymentSpan` of a
 * build of a dozen charges paid one by one).
 */
const PAY_HORIZON_MS = 4000;

/** The size a row lozenge, a flying or a popping charge is baked at: the largest it is drawn. */
const CHARGE_BAKED = BUILDING.lozenge.max * BUILD_BOOST.lozenge * (1 + BUILD_PAY.pop);

/** A recruit of the queue: a small helmet in the column beyond the barracks icon. */
interface PipSlot {
  readonly root: Container;
  readonly back: BakedSprite;
  readonly level: BakedSprite;
  readonly front: BakedSprite;
  /** The shown share of the unit in production: eases toward the snapshot's. */
  readonly fill: EaseTween;
  /** #930, W4: the CP mark of its walk, upright beyond it: dimmed, inked in from the foot. */
  readonly mark: Container;
  readonly markBack: BakedSprite;
  readonly markFill: BakedSprite;
}

/** The CP mark of a walk on the ring (#930, W4): its size and how far beyond its recruit, world units. */
const WALK_MARK = { size: 13, out: 15, dim: 0.42 } as const;

/** How long the fill of a recruit takes to follow a new snapshot, ms (one snapshot apart). */
const PIP_EASE_MS = 120;

/**
 * The cities of the map (ui-style.md 9.4; Engraved, #847, part 2 of #829): a body whose size
 * follows the capacity class (the disc of the owner's colour on a dark cut, an ink ring, the
 * enemy's two inner rings, a neutral one hatched; the dark plate when units stand there), the
 * capital star, the capacity ring (a solid ink arc per own unit standing there, two hairlines per
 * free place), the warehouse as a row of lozenges under the ring (57u), the barracks and the
 * factory as the city menu's own icons outside the ring, in the widest free angle between the roads
 * (#954, P2 "Free side"; own, and an enemy's next to an own node, DEC-31), a build in progress as a
 * plan with a row of owed charges beside it (57k), then the icon filling with the build time, the
 * recruit queue as small helmets beyond the barracks (55k Pips) and the gilt VP lozenge. The
 * capacity is public and exact (DEC-22).
 *
 * A province (`kind = province`, DEC-23) is a small dot instead of a body, with the capacity ring.
 *
 * Every shape is a baked sprite (`bakedShapes.ts`, `pieceShapes.ts`, `SpriteCache`), one texture per
 * look with a bounded key; the fill of a building icon and of a recruit is a crop of one baked fill, so it
 * rises continuously without new textures. `destroy()` releases every object.
 */
/** How long a replaced city body takes to fade out, ms: the city flips at the start of a capture (#819). */
const BODY_FADE_MS = CAPTURE.cityMs;

export class CityView {
  private readonly cities: Container[];
  private readonly bodies: BakedSprite[];
  private readonly rings: BakedSprite[];
  /** The city whose capacity ring pulses now (`pulseFull`), `null`: none. */
  private fullRing: number | null = null;
  private readonly bars: BakedSprite[];
  private readonly alerts: BakedSprite[];
  /** The cities whose alert ring is on now (it pulses every frame). */
  private readonly alerting = new Set<number>();
  private readonly buildings: Record<BuildingKind, BuildingSlot>[];
  /** The angles at which the roads leave each city: the buildings stand between them. */
  private readonly roads: readonly (readonly number[])[];
  private readonly pips: PipSlot[][];
  private readonly pipLayers: Container[];
  private readonly badges: (Container | null)[];
  private readonly vpLabels: Text[] = [];
  private readonly keys: string[];
  /** The last state of every city: a change of the selection redraws from it. */
  private readonly states: (CityState | null)[];
  /** The selected city: it shows the free slots of its queue. */
  private selected: number | null = null;
  private readonly radii: number[];
  private readonly vpStyle: TextStyle;
  /** The size of the building icons now (`iconSize`) and the scale of the recruits (`pipScale`). */
  private iconSz = iconSize(1);
  private pipK = pipScale(1);
  /** The render tick of the frame (fractional): the build time fills by it. */
  private tick = 0;
  /** Set after the first snapshot: a body that changes after it (a capture) cross-fades. */
  private warm = false;
  /** The bodies that were just replaced, fading out over the new ones (#508). */
  private readonly fading: { sprite: Container; tween: EaseTween; hold: number }[] = [];
  /** How long (ms) a captured city keeps its old body before it fades: the winner's walk (#856). */
  private captureDelays: ReadonlyMap<number, number> = new Map();
  /** The buildings whose build is running or whose done effect plays: stepped every frame. */
  private readonly moving = new Set<BuildingSlot>();
  /** The recruits whose fill is still easing. */
  private readonly easing = new Set<PipSlot>();
  /** The own `build_paid` of the events (#872). */
  private readonly payLog: PaymentLog;
  /** The builds with a payment in motion this frame, and its payments. */
  private readonly paying = new Map<BuildingSlot, Payment[]>();
  /** The charges flying into a build, over the groups (the effects layer), a pool of sprites. */
  private readonly flightLayer = new Container({ label: 'build-pay' });
  private readonly flightSprites: BakedSprite[] = [];
  /** Where each flight left from, fixed at its first frame (the warehouse row changes after). */
  private readonly flightFrom = new Map<string, Point>();
  /** Where the own group standing in a node is drawn (a charge it pays leaves from there). */
  private groupAt: (node: number) => Point | null = () => null;
  private tickHz = 10;
  /** The tick of the snapshot drawn: a payment newer than it is not in the picture yet. */
  private baseTick = 0;

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    private readonly me: PlayerId,
    labelResolution: number,
    private readonly sprites: SpriteCache,
    /** The colours of the players by id (DEC-49); today's look by default. */
    private readonly colours: PlayerColours = sideColours(me),
  ) {
    this.vpStyle = new TextStyle({
      fontFamily: pieceFamily(),
      fontSize: VP_LOZENGE.font,
      fontWeight: '700',
      fill: VP,
    });
    usePieceFont([this.vpStyle]);
    this.payLog = new PaymentLog(me);
    layers.layer.effects.addChild(this.flightLayer);
    this.keys = map.nodes.map(() => '');
    this.states = map.nodes.map(() => null);
    this.radii = map.nodes.map((node) =>
      node.kind === 'province'
        ? PROVINCE.radius
        : node.capital_of === null
          ? NODE_RADIUS
          : CAPITAL_RADIUS,
    );
    this.cities = [];
    this.bodies = [];
    this.rings = [];
    this.bars = [];
    this.alerts = [];
    this.buildings = [];
    this.roads = roadAngles(map);
    this.pips = [];
    this.pipLayers = [];
    this.badges = [];
    for (const node of map.nodes) {
      const city = new Container({ x: node.x, y: node.y, label: `node-${String(node.id)}` });
      this.bodies.push(city.addChild(sprites.sprite()));
      this.rings.push(city.addChild(sprites.sprite()));
      const bar = city.addChild(sprites.sprite());
      bar.label = 'warehouse';
      this.bars.push(bar);
      const slots = {} as Record<BuildingKind, BuildingSlot>;
      for (const kind of BUILDING_KINDS) slots[kind] = this.buildingSlot(city, kind, node.id);
      this.buildings.push(slots);
      const pipLayer = city.addChild(new Container({ label: 'recruits' }));
      this.pipLayers.push(pipLayer);
      this.pips.push([]);
      const ring = city.addChild(sprites.sprite());
      ring.label = 'progress-alert';
      ring.visible = false;
      this.alerts.push(ring);
      // A province carries no VP (DEC-23).
      if (node.vp > 0 && node.kind !== 'province') {
        const badge = city.addChild(new Container());
        badge.addChild(sprites.sprite(vpBadgeSpec()));
        const label = new Text({
          text: String(node.vp),
          style: this.vpStyle,
          anchor: 0.5,
          resolution: labelResolution,
        });
        label.position.set(0, 0.5);
        this.vpLabels.push(badge.addChild(label));
        this.badges.push(badge);
      } else {
        this.badges.push(null);
      }
      this.cities.push(layers.layer.nodes.addChild(city));
    }
    this.setOwners(map.nodes.map((node) => node.start_owner));
  }

  private buildingSlot(city: Container, kind: BuildingKind, node: number): BuildingSlot {
    const row = city.addChild(new Container({ label: `owed-${kind}`, visible: false }));
    const root = city.addChild(new Container({ label: `building-${kind}`, visible: false }));
    const back = root.addChild(this.sprites.sprite());
    const fill = root.addChild(this.sprites.sprite());
    const head = root.addChild(this.sprites.sprite(iconHeadSpec(kind)));
    const front = root.addChild(this.sprites.sprite());
    fill.visible = false;
    head.visible = false;
    const loose = city.addChild(new Container({ label: `pay-${kind}`, visible: false }));
    const ring = city.addChild(this.sprites.sprite(doneRingSpec(10)));
    ring.label = `building-ring-${kind}`;
    ring.visible = false;
    const ticks = city.addChild(new Graphics({ label: `building-ticks-${kind}`, visible: false }));
    return {
      kind,
      node,
      root,
      back,
      fill,
      head,
      front,
      ring,
      row,
      loose,
      seat: { x: 0, y: 0 },
      size: BUILDING.world,
      angle: 0,
      owed: null,
      build: null,
      color: YOU,
      builtKey: null,
      done: null,
      ticks,
      tickMs: null,
      tickKey: '',
      ink: null,
      off: null,
      pay: null,
    };
  }

  /** Radius of the city `id` now: by its capacity class, a default until the capacity is known. */
  radiusOf(id: number): number {
    return this.radii[id] ?? NODE_RADIUS;
  }

  /**
   * The centre of the lozenge `index` of the warehouse row of the city `id` in world units (where a
   * charge leaves for a gathering plan, #851); `null`: no row is drawn there.
   */
  warehouseSlot(id: number, index: number): Point | null {
    const state = this.states[id];
    const at = this.map.nodes[id];
    if (state === null || state === undefined || at === undefined) return null;
    if (state.capacity === null || state.warehouse === null) return null;
    const xs = lozengeRow(state.warehouseCap ?? state.warehouse);
    const x = xs[Math.min(xs.length - 1, Math.max(0, index))];
    if (x === undefined) return null;
    return { x: at.x + x, y: at.y + lozengeRowY(this.radiusOf(id)) };
  }

  /**
   * Per node, how long (ms) a capture in the next snapshot keeps the old body before it fades, so that
   * the city flips with the flood as the winner walks in (Walk in, #856); set before `update`.
   */
  setCaptureDelays(delays: ReadonlyMap<number, number>): void {
    this.captureDelays = delays;
  }

  /** The radii of all cities (kept in step with the snapshots; read by other views). */
  get radiusTable(): readonly number[] {
    return this.radii;
  }

  /** Owners before the first snapshot (the map's start owners); capacity is not known yet. */
  setOwners(owners: readonly (PlayerId | null)[]): void {
    const none: BuildingState = { built: false, build: null, known: false };
    owners.forEach((owner, id) => {
      this.set(id, {
        owner,
        capacity: null,
        garrison: 0,
        occupied: false,
        warehouse: null,
        queue: null,
        progress: 0,
        unitTicks: null,
        waiting: false,
        paused: false,
        queueMax: 0,
        warehouseCap: null,
        buildings: { barracks: none, factory: none },
        walks: [],
      });
    });
  }

  /**
   * A new snapshot: owners, capacity classes, garrisons, warehouses, recruit queues and builds;
   * `unitTicks`: ticks per recruit (`null`: no queue marks); `queueMax`: the slots of a queue
   * (`null`: the selected city shows no free ones).
   */
  update(
    base: SnapshotMsg,
    unitTicks: number | null = null,
    cityUpgrades: CityDevelopment | null = null,
    queueMax: number | null = null,
    provinceWarehouse = 0,
    /** `recruit.rally_cost`, hundredths (#930); 0: no walk marks. */
    rallyCost = 0,
  ): void {
    const garrison = new Map<number, number>();
    const occupied = new Set<number>();
    for (const group of base.view.groups) {
      if (group.location.kind === 'node') {
        garrison.set(group.location.node, (garrison.get(group.location.node) ?? 0) + group.units);
        occupied.add(group.location.node);
      }
    }
    // The opponent's units seen standing in a node (`seen`, as the map draws their helmet there).
    for (const node of base.view.nodes) {
      const seen = node.seen;
      if (
        seen !== null &&
        node.detail !== 'fog' &&
        seen.level !== 'fog' &&
        seen.enemy_modes.length > 0
      )
        occupied.add(node.id);
    }
    // A city with a fight in it: its production stands (DEC-25, item 9). Its units are drawn by the
    // fight, not as a helmet in the city, so the city keeps its owner's disc.
    const fighting = new Set<number>();
    for (const fight of base.view.fights) {
      if (fight.node !== null) {
        fighting.add(fight.node);
        occupied.delete(fight.node);
      }
    }
    if (this.tick < base.tick - 1) this.tick = base.tick;
    this.baseTick = base.tick;
    // #930, W4: the walks the CP will pay, the nearest first, as the CP gauge earmarks them.
    const dues =
      unitTicks === null
        ? []
        : rallyDues(base.view.nodes, this.me, base.view.me.cp, unitTicks, rallyCost);
    for (const node of base.view.nodes) {
      this.set(
        node.id,
        this.stateOf(
          node,
          {
            garrison: garrison.get(node.id) ?? 0,
            fighting: fighting.has(node.id),
            occupied: occupied.has(node.id),
          },
          { unitTicks, cityUpgrades, queueMax, provinceWarehouse },
          cityDues(dues, node.id).map((d) => d.short),
        ),
      );
    }
    this.warm = true;
  }

  /**
   * The selected city (`null`: none) shows the free slots of its recruit queue. The server decides
   * what the city can queue; this only draws the room that is left.
   */
  setSelected(node: number | null): void {
    if (node === this.selected) return;
    const before = this.selected;
    this.selected = node;
    for (const id of [before, node]) {
      const state = id === null ? undefined : this.states[id];
      if (id !== null && state !== undefined && state !== null) this.set(id, state);
    }
  }

  /**
   * Every frame: the capacity ring of the city a recruit was refused for want of room swells (#765,
   * B21); `pulse` is the newest refusal, `null`: none.
   */
  pulseFull(pulse: CapacityPulse | null, nowMs: number): void {
    const look = pulse === null ? null : capacityPulse(nowMs - pulse.at, reducedMotion());
    const id = look === null || pulse === null ? null : pulse.node;
    if (this.fullRing !== null && this.fullRing !== id) {
      const before = this.rings[this.fullRing];
      before?.scale.set(1);
      if (before !== undefined) before.alpha = 1;
    }
    this.fullRing = id;
    if (id === null || look === null) return;
    const ring = this.rings[id];
    if (ring === undefined) return;
    ring.scale.set(look.scale);
    ring.alpha = look.alpha;
  }

  /** Every frame: the dashed rings that ask for a look pulse (steady with "less motion"). */
  pulse(nowMs: number): void {
    if (this.alerting.size === 0) return;
    const alpha = alertAlpha(beaconPulse(nowMs, false), reducedMotion());
    for (const id of this.alerting) {
      const ring = this.alerts[id];
      if (ring !== undefined) ring.alpha = alpha;
    }
  }

  /** The camera scale (CSS px per world unit): the icons and the recruits keep their screen size. */
  setCameraScale(scale: number): void {
    const size = iconSize(scale);
    const pips = pipScale(scale);
    if (size === this.iconSz && pips === this.pipK) return;
    this.iconSz = size;
    this.pipK = pips;
    this.states.forEach((state, id) => {
      if (state !== null) {
        this.placeBuildings(id, state);
        this.drawRecruits(id, state, this.selected === id);
      }
    });
  }

  /** The render tick of the frame (fractional): a build's time fills by it, between two snapshots. */
  setTick(tick: number): void {
    this.tick = tick;
  }

  /**
   * Every frame, after `setTick` (#872): the own `build_paid` among `events` move the builds they
   * paid (the charges fly in, pop, run into the icon) by their age at the render tick; `groupAt`:
   * where the own group standing in a node is drawn. Nothing moves with "less motion".
   */
  setPayments(
    events: readonly EventMsg[],
    tickHz: number,
    groupAt: (node: number) => Point | null,
  ): void {
    this.tickHz = tickHz;
    this.groupAt = groupAt;
    this.payLog.read(events);
    this.paying.clear();
    if (reducedMotion()) return;
    for (const payment of this.payLog.recent(this.tick, tickHz, PAY_HORIZON_MS)) {
      const slot = this.buildings[payment.node]?.[payment.kind];
      if (slot === undefined || slot.build === null) continue;
      const list = this.paying.get(slot);
      if (list === undefined) this.paying.set(slot, [payment]);
      else list.push(payment);
      this.moving.add(slot);
    }
  }

  setLabelResolution(resolution: number): void {
    for (const text of this.vpLabels) {
      if (text.resolution !== resolution) text.resolution = resolution;
    }
  }

  destroy(): void {
    for (const city of this.cities) city.destroy({ children: true });
    this.flightLayer.destroy({ children: true });
    this.vpStyle.destroy();
  }

  // --- Drawing ------------------------------------------------------------------------------

  private stateOf(
    node: NodeView,
    city: { garrison: number; fighting: boolean; occupied: boolean },
    rules: {
      unitTicks: number | null;
      cityUpgrades: CityDevelopment | null;
      queueMax: number | null;
      provinceWarehouse: number;
    },
    walks: readonly boolean[] = [],
  ): CityState {
    const { unitTicks, cityUpgrades, provinceWarehouse } = rules;
    // DEC-41, item 13: an own province has a warehouse of `provinceWarehouse` places (0: none). Any
    // other province shows no stock.
    const province = this.map.nodes[node.id]?.kind === 'province';
    const provinceStock = province && node.owner === this.me && provinceWarehouse > 0;
    const building = node.building;
    const own = node.owner === this.me;
    // The builds are drawn wherever the snapshot carries them: a live view carries only the own
    // ones (AGENTS.md 4.4), the full view of a replay those of both players (#905).
    const barracksBuild: BuildingBuild | null =
      building?.kind === 'barracks' && cityUpgrades !== null
        ? {
            owed: building.owed,
            price: cityUpgrades.barracksCharges ?? null,
            doneTick: building.done_tick,
            total: cityUpgrades.barracks,
          }
        : null;
    const factoryBuild: BuildingBuild | null =
      node.factory_build !== null
        ? {
            owed: node.factory_build.owed,
            price: cityUpgrades?.factoryCharges ?? null,
            doneTick: node.factory_build.done_tick,
            total: cityUpgrades?.factory ?? 0,
          }
        : null;
    // Free slots are shown where a unit can be queued: an own city (the view carries its queue), with
    // the barracks when the city development is on (DEC-26, the same test as the city menu).
    const recruits =
      own && node.recruit_queue !== null && (cityUpgrades === null || node.has_barracks === true);
    return {
      owner: node.owner,
      capacity: node.capacity,
      garrison: own ? city.garrison : 0,
      occupied: city.occupied,
      // The server sends a warehouse only where it may be seen: an own node at any `detail`
      // (DEC-35, detail 3) or a node where an own group stands.
      warehouse: province && !provinceStock ? null : node.warehouse,
      queue: node.recruit_queue,
      progress: node.recruit_progress ?? 0,
      unitTicks,
      waiting: node.recruit_waiting === true,
      paused: city.fighting,
      queueMax: recruits ? (rules.queueMax ?? 0) : 0,
      // An own city knows its warehouse capacity (the capacity of the node, DEC-22); a foreign one
      // shows only its charges.
      warehouseCap: provinceStock
        ? provinceWarehouse
        : (node.warehouse_cap ?? (cityUpgrades === null ? node.capacity : null)),
      buildings: {
        // The server sends these only where they may be seen (DEC-31: an enemy's next to an own node).
        barracks: {
          built: showsBarracks(node.has_barracks, cityUpgrades !== null),
          build: barracksBuild,
          known: node.has_barracks !== null && cityUpgrades !== null,
        },
        factory: {
          built: node.factory === true,
          build: factoryBuild,
          known: node.factory !== null,
        },
      },
      walks,
    };
  }

  private kindOf(owner: PlayerId | null): CityKind {
    return owner === null ? 'neutral' : sideOf(this.me, owner);
  }

  /** The colour of a city of `owner` (DEC-49); nobody's has no colour of a player. */
  private colorOf(owner: PlayerId | null): number | undefined {
    return owner === null ? undefined : this.colours[owner];
  }

  /** The body of city `id`. */
  private drawBody(id: number, state: CityState): void {
    const node = this.map.nodes[id];
    const body = this.bodies[id];
    if (node === undefined || body === undefined) return;
    const kind = this.kindOf(state.owner);
    const spec =
      node.kind === 'province'
        ? provinceBodySpec(kind, state.occupied, this.colorOf(state.owner))
        : cityBodySpec(
            kind,
            this.radii[id] ?? NODE_RADIUS,
            node.capital_of !== null,
            state.occupied,
            this.colorOf(state.owner),
          );
    const old = body.spec;
    // A capture cross-fades the colour; units coming or going swap the plate at once.
    if (
      this.warm &&
      old !== null &&
      old.key !== spec.key &&
      !reducedMotion() &&
      ownerPart(old.key) !== ownerPart(spec.key)
    ) {
      this.crossFade(id, body, old);
    }
    body.set(spec);
  }

  /**
   * A captured city: its old body stays on top of the new one and fades out, so the colour flows
   * from one owner to the other instead of flipping (#508).
   */
  private crossFade(id: number, body: BakedSprite, old: NonNullable<BakedSprite['spec']>): void {
    const city = this.cities[id];
    if (city === undefined) return;
    const ghost = this.sprites.sprite(old);
    ghost.position.set(body.x, body.y);
    city.addChildAt(ghost, city.getChildIndex(body) + 1);
    const tween = new EaseTween(1, BODY_FADE_MS);
    tween.setTarget(0);
    this.fading.push({ sprite: ghost, tween, hold: this.captureDelays.get(id) ?? 0 });
  }

  /**
   * Once per frame, by `dtMs` of real time: fades the replaced bodies out, fills the icons whose
   * build runs by the render tick, plays the end of a build and eases the recruits' fill.
   */
  advance(dtMs: number): void {
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const item = this.fading[i];
      if (item === undefined) continue;
      if (item.sprite.destroyed) {
        this.fading.splice(i, 1);
        continue;
      }
      // A capture waits for its winner to walk in (#856): the old body holds, then fades with the flood.
      if (item.hold > 0) {
        item.hold -= dtMs;
        continue;
      }
      item.sprite.alpha = item.tween.step(dtMs);
      if (!item.tween.active) {
        item.sprite.destroy({ children: true });
        this.fading.splice(i, 1);
      }
    }
    for (const slot of this.moving) {
      if (slot.root.destroyed) {
        this.moving.delete(slot);
        continue;
      }
      this.stepTicks(slot, dtMs);
      this.stepInk(slot, dtMs);
      if (slot.done !== null) {
        this.stepDone(slot, dtMs);
      } else if (slot.build !== null) {
        const paying = this.showBuild(slot, slot.build);
        // A build that owes charges stands still between its payments.
        if (!paying && (slot.build.doneTick === null || slot.build.owed > 0)) {
          this.moving.delete(slot);
        }
      } else if (!this.lingers(slot)) {
        this.moving.delete(slot);
      }
    }
    this.drawFlights();
    for (const pip of this.easing) {
      if (pip.root.destroyed) {
        this.easing.delete(pip);
        continue;
      }
      pip.fill.step(dtMs);
      showPipFill(pip);
      showMarkFill(pip);
      if (!pip.fill.active) this.easing.delete(pip);
    }
  }

  private set(id: number, state: CityState): void {
    this.states[id] = state;
    const selected = this.selected === id;
    const key = `${stateKey(state)}|${String(selected)}`;
    if (this.keys[id] === key) return;
    this.keys[id] = key;
    const node = this.map.nodes[id];
    const ring = this.rings[id];
    const bar = this.bars[id];
    if (node === undefined || ring === undefined || bar === undefined) return;

    const capital = node.capital_of !== null;
    const province = node.kind === 'province';
    const radius = province
      ? PROVINCE.radius
      : state.capacity === null
        ? capital
          ? CAPITAL_RADIUS
          : NODE_RADIUS
        : cityRadius(state.capacity);
    this.radii[id] = radius;
    const kind = this.kindOf(state.owner);
    this.drawBody(id, state);

    this.drawRecruits(id, state, selected);
    this.placeBuildings(id, state);

    const { capacity, warehouse } = state;
    const ringOn = capacity !== null;
    ring.set(ringOn ? cityRingSpec(radius, capacity, kind === 'you' ? state.garrison : 0) : null);
    ring.visible = ringOn;
    // A province has a warehouse only its owner sees (DEC-41, item 13):
    // `stateOf` leaves `warehouse` null for every other province, so nothing is drawn there.
    const barOn = ringOn && warehouse !== null;
    bar.set(
      barOn
        ? warehouseMarksSpec(
            state.warehouseCap ?? warehouse,
            warehouse,
            stockColor(kind, this.colorOf(state.owner)),
          )
        : null,
    );
    if (barOn) bar.position.set(0, lozengeRowY(radius));
    bar.visible = barOn;

    const badge = this.badges[id];
    if (badge !== null && badge !== undefined) {
      // On the capacity ring at its upper right (the mockup's gilt lozenge).
      const at = vpBadgeAt(radius);
      badge.position.set(at.x, at.y);
    }
  }

  /** The buildings the snapshot gives a city: built, or being built (nobody's city has any). */
  private kindsOf(state: CityState): BuildingKind[] {
    if (state.owner === null) return [];
    return BUILDING_KINDS.filter((kind) => {
      const b = state.buildings[kind];
      return b.built || b.build !== null;
    });
  }

  /** Where the buildings and the recruit queue of city `id` stand now (#954, P2 "Free side"). */
  private layoutOf(id: number, state: CityState): BuildingLayout {
    return layoutBuildings({
      radius: this.radii[id] ?? NODE_RADIUS,
      roads: this.roads[id] ?? [],
      vp: (this.badges[id] ?? null) !== null,
      kinds: this.kindsOf(state),
      size: this.iconSz,
    });
  }

  /**
   * The buildings of a city: the barracks and the factory as the menu's icons outside the ring,
   * built (the owner's rules) or being built (a plan while charges are owed, then filling with the
   * build time). A captured city's icons cross-fade to the new owner with its body.
   */
  private placeBuildings(id: number, state: CityState): void {
    const slots = this.buildings[id];
    if (slots === undefined) return;
    const layout = this.layoutOf(id, state);
    const enemy = this.kindOf(state.owner) === 'enemy';
    const color = this.colours[enemy ? otherPlayer(this.me) : this.me];
    for (const kind of BUILDING_KINDS) {
      const slot = slots[kind];
      const { built, build, known } = state.buildings[kind];
      const at = layout.items[kind];
      const wasBuilding = slot.build !== null;
      const shown = at !== undefined && (built || build !== null);
      slot.root.visible = shown;
      slot.row.visible = false;
      slot.loose.visible = false;
      if (!shown) {
        slot.build = null;
        slot.done = null;
        slot.builtKey = null;
        slot.owed = null;
        slot.ring.visible = false;
        this.stopLingering(slot);
        // The view says there is none (not "unknown"): when it turns on, the icon inks in (#972).
        slot.off = known && state.owner !== null ? state.owner : null;
        this.moving.delete(slot);
        continue;
      }
      slot.angle = layout.angles[kind] ?? 0;
      // A build in motion is one size up (#972): the icon grows outward from the seat it keeps once built.
      const grown = build === null ? 1 : BUILD_BOOST.size;
      const push = iconHalf(layout.size) * (grown - 1);
      slot.seat = {
        x: at.x + Math.cos(slot.angle) * push,
        y: at.y + Math.sin(slot.angle) * push,
      };
      slot.size = layout.size * grown;
      slot.root.position.set(slot.seat.x, slot.seat.y);
      slot.root.scale.set(slot.size / BUILDING.box);
      slot.color = color;
      if (build === null) {
        slot.build = null;
        slot.owed = null;
        const key = `${String(color)}:${enemy ? 'e' : 'o'}`;
        if (slot.builtKey !== null && slot.builtKey !== key && this.warm && !reducedMotion()) {
          this.ghostIcon(id, slot);
        }
        slot.builtKey = key;
        slot.back.set(iconBackSpec(kind, 'built', color, enemy));
        slot.front.set(iconFrontSpec(kind, 'built'));
        slot.fill.visible = false;
        slot.head.visible = false;
        // A build that ends here: a ring opens from the icon (57k) and four corner ticks stand
        // round it for 3 s (#972, V12); under "less motion" the ticks stand still and there is no ring.
        if (wasBuilding && this.warm) {
          slot.tickMs = 0;
          slot.tickKey = '';
          slot.ink = null;
          slot.root.alpha = 1;
          this.moving.add(slot);
          this.stepTicks(slot, 0);
          if (!reducedMotion()) {
            slot.done = new EaseTween(0, BUILD_PAY.done.ms);
            slot.done.setTarget(1);
            slot.ring.position.set(at.x, at.y);
            this.stepDone(slot, 0);
          }
        } else if (enemy && slot.off === state.owner && this.warm && !reducedMotion()) {
          // The view turned an enemy building on (DEC-31): a quiet ink-in, nothing else (#972).
          slot.ink = new EaseTween(0, BUILD_BOOST.inkInMs);
          slot.ink.setTarget(1);
          slot.root.alpha = 0;
          this.moving.add(slot);
        }
        slot.off = null;
        if (!this.lingers(slot)) this.moving.delete(slot);
        continue;
      }
      slot.builtKey = null;
      slot.done = null;
      slot.off = null;
      this.stopLingering(slot);
      slot.ring.visible = false;
      slot.build = build;
      this.showBuild(slot, build);
      if (build.doneTick !== null && build.owed === 0) this.moving.add(slot);
      else this.moving.delete(slot);
    }
  }

  /** The old look of an icon whose city changed hands stays over the new one, then fades with the body. */
  private ghostIcon(id: number, slot: BuildingSlot): void {
    const city = this.cities[id];
    const back = slot.back.spec;
    const front = slot.front.spec;
    if (city === undefined || back === null || front === null) return;
    const ghost = new Container({ label: `building-ghost-${slot.kind}` });
    ghost.position.copyFrom(slot.root.position);
    ghost.scale.copyFrom(slot.root.scale);
    ghost.addChild(this.sprites.sprite(back));
    ghost.addChild(this.sprites.sprite(front));
    city.addChildAt(ghost, city.getChildIndex(slot.root) + 1);
    const tween = new EaseTween(1, BODY_FADE_MS);
    tween.setTarget(0);
    this.fading.push({ sprite: ghost, tween, hold: this.captureDelays.get(id) ?? 0 });
  }

  /**
   * A building being built at the render tick: the plan or the fill, and the row of owed charges
   * beside it; while a payment moves (#872), the charges still in the air stay owed on the row, the
   * landed ones pop and, paid in full, run into the icon. Returns whether a payment moves.
   */
  private showBuild(slot: BuildingSlot, build: BuildingBuild): boolean {
    const { kind } = slot;
    const told = buildProgress(build.owed, build.price, build.doneTick, build.total, this.tick);
    const payments = this.paying.get(slot);
    const show =
      payments === undefined
        ? null
        : payShow(payments, told.cost, this.tick, this.baseTick, this.tickHz);
    slot.pay = show === null ? null : { show, cost: told.cost };
    const progress =
      show === null || show.hidden === 0
        ? told
        : { cost: told.cost, paid: Math.max(0, told.paid - show.hidden), time: 0, running: false };
    const look: IconLook = progress.running ? 'rising' : 'plan';
    slot.back.set(iconBackSpec(kind, look, slot.color, false));
    slot.front.set(iconFrontSpec(kind, look));
    const { top, bottom } = iconSpan(kind);
    const height = bottom - top;
    slot.fill.set(iconFillSpec(kind, slot.color));
    const shown = progress.running ? progress.time : 0;
    slot.fill.visible = shown > 0;
    if (shown > 0) slot.fill.cropBottom(shown * height);
    slot.head.visible = shown > 0 && shown < 1;
    slot.head.position.set(0, bottom - shown * height);
    slot.owed = owedRow(slot.seat, slot.angle, slot.size, progress.cost, BUILD_BOOST.lozenge);
    this.showRow(slot, progress, show);
    return payments !== undefined;
  }

  /**
   * The row of owed charges by the icon (the menu's price row): hollow while owed, solid when paid,
   * a landed one popping (#872); once the time runs the row is gone and, in the moment the build is
   * paid in full, the lozenges run into the icon.
   */
  private showRow(slot: BuildingSlot, progress: BuildProgress, show: PayShow | null): void {
    const { row, loose, owed } = slot;
    const spots = owed?.slots ?? [];
    const rowOn = owed !== null && !progress.running && spots.length > 0;
    row.visible = rowOn;
    if (rowOn) {
      while (row.children.length < spots.length) row.addChild(this.sprites.sprite());
      row.children.forEach((child, j) => {
        const sprite = child as BakedSprite;
        const at = spots[j];
        sprite.visible = at !== undefined;
        if (at === undefined) return;
        sprite.set(owedSpec(j < progress.paid, slot.color, CHARGE_BAKED));
        sprite.position.set(at.x, at.y);
        sprite.scale.set((owed.k * (show?.pops.get(j) ?? 1)) / CHARGE_BAKED);
      });
    }
    const marks: { at: Point; scale: number }[] = [];
    const run = show?.run ?? null;
    if (owed !== null && run !== null) {
      run.forEach((q, j) => {
        const p = spots[j];
        if (p === undefined || q >= 1) return;
        marks.push({
          at: { x: p.x + (slot.seat.x - p.x) * q, y: p.y + (slot.seat.y - p.y) * q },
          scale: owed.k * (1 - BUILD_PAY.run.shrink * q),
        });
      });
    }
    loose.visible = marks.length > 0;
    if (marks.length === 0) return;
    const spec = chargeSpec(slot.color, CHARGE_BAKED);
    while (loose.children.length < marks.length) loose.addChild(this.sprites.sprite());
    loose.children.forEach((child, i) => {
      const sprite = child as BakedSprite;
      const mark = marks[i];
      sprite.visible = mark !== undefined;
      if (mark === undefined) return;
      sprite.set(spec);
      sprite.position.set(mark.at.x, mark.at.y);
      sprite.scale.set(mark.scale / CHARGE_BAKED);
    });
  }

  /**
   * The charges in the air (#872): each from its place in the warehouse row, or from the own group
   * standing in the city, to its lozenge on the row by the icon, along an arc up (the plan ribbon's
   * flight language, #851), going from the warehouse size to the row's.
   */
  private drawFlights(): void {
    let used = 0;
    const live = new Set<string>();
    for (const slot of this.paying.keys()) {
      const pay = slot.pay;
      const owed = slot.owed;
      const city = this.map.nodes[slot.node];
      if (pay === null || owed === null || city === undefined || pay.show.flights.length === 0) {
        continue;
      }
      for (const flight of pay.show.flights) {
        const key = `${String(flight.payment.tick)}:${String(slot.node)}:${slot.kind}:${String(flight.k)}`;
        live.add(key);
        let from = this.flightFrom.get(key);
        if (from === undefined) {
          const stock = this.states[slot.node]?.warehouse ?? 0;
          const at =
            (flight.from === 'warehouse'
              ? this.warehouseSlot(slot.node, stock + flight.behind)
              : this.groupAt(slot.node)) ?? city;
          from = { x: at.x, y: at.y };
          this.flightFrom.set(key, from);
        }
        const p = owed.slots[flight.j];
        if (p === undefined) continue;
        const q = flight.q;
        const x = from.x + (city.x + p.x - from.x) * q;
        const y = from.y + (city.y + p.y - from.y) * q - Math.sin(q * Math.PI) * BUILD_PAY.lift;
        let sprite = this.flightSprites[used];
        if (sprite === undefined) {
          sprite = this.flightLayer.addChild(this.sprites.sprite());
          this.flightSprites.push(sprite);
        }
        used++;
        sprite.set(chargeSpec(slot.color, CHARGE_BAKED));
        sprite.position.set(x, y);
        sprite.scale.set((1 + (owed.k - 1) * q) / CHARGE_BAKED);
        sprite.visible = true;
      }
    }
    for (let i = used; i < this.flightSprites.length; i++) {
      const sprite = this.flightSprites[i];
      if (sprite !== undefined) sprite.visible = false;
    }
    for (const key of this.flightFrom.keys()) if (!live.has(key)) this.flightFrom.delete(key);
  }

  /** The end of a build: a ring opens from the icon (`BUILD_PAY.done`) and fades. */
  private stepDone(slot: BuildingSlot, dtMs: number): void {
    const done = slot.done;
    if (done === null) return;
    const q = done.step(dtMs);
    const { from, grow } = BUILD_PAY.done;
    slot.ring.visible = q < 1;
    slot.ring.scale.set((from * slot.size + grow * q) / 10);
    slot.ring.alpha = 1 - q;
    if (!done.active) {
      slot.done = null;
      slot.ring.visible = false;
      if (!this.lingers(slot)) this.moving.delete(slot);
    }
  }

  /** Something of the finish still moves: the corner ticks or the ink-in. */
  private lingers(slot: BuildingSlot): boolean {
    return slot.tickMs !== null || slot.ink !== null || slot.done !== null;
  }

  private stopLingering(slot: BuildingSlot): void {
    slot.tickMs = null;
    slot.ink = null;
    slot.root.alpha = 1;
    slot.ticks.visible = false;
  }

  /** The corner ticks of a building just finished (#972), `dtMs` further on; redrawn only when they change. */
  private stepTicks(slot: BuildingSlot, dtMs: number): void {
    if (slot.tickMs === null) return;
    slot.tickMs += dtMs;
    const show = buildTicksShow(slot.tickMs, reducedMotion());
    if (show === null) {
      slot.tickMs = null;
      slot.ticks.visible = false;
      return;
    }
    slot.ticks.visible = true;
    slot.ticks.position.set(slot.seat.x, slot.seat.y);
    const key = `${slot.size.toFixed(2)}:${show.alpha.toFixed(3)}:${show.grow.toFixed(3)}`;
    if (key === slot.tickKey) return;
    slot.tickKey = key;
    drawBuildTicks(slot.ticks, slot.size, show);
  }

  /** The quiet ink-in of an enemy building the view turned on (#972), `dtMs` further on. */
  private stepInk(slot: BuildingSlot, dtMs: number): void {
    const ink = slot.ink;
    if (ink === null) return;
    slot.root.alpha = ink.step(dtMs);
    if (!ink.active) {
      slot.ink = null;
      slot.root.alpha = 1;
    }
  }

  /**
   * The recruit queue of an own city (55k Pips): a small helmet per unit in a column beyond the
   * barracks (#954), the first filling with its production, the others hatched; the selected city's
   * free slots beaded. A unit ready with no room, or the production stopped by a fight, gets the
   * dashed amber ring that pulses. All from the snapshot and the rules.
   */
  private drawRecruits(id: number, state: CityState, selected: boolean): void {
    const layer = this.pipLayers[id];
    const pips = this.pips[id];
    const alert = this.alerts[id];
    if (layer === undefined || pips === undefined || alert === undefined) return;
    const count = state.unitTicks === null ? 0 : Math.max(0, state.queue ?? 0);
    const slots = state.unitTicks === null ? 0 : Math.max(count, selected ? state.queueMax : 0);
    const width = RECRUIT_PIPS.width;
    const scale = this.pipK;
    const seats = queueSeats(
      this.layoutOf(id, state),
      state.unitTicks === null ? 0 : Math.max(count, state.queueMax),
      scale,
    );
    while (pips.length < slots) pips.push(this.pipSlot(layer));
    pips.forEach((pip, j) => {
      pip.root.visible = j < slots;
      if (j >= slots) return;
      const at = seats[j] ?? { x: 0, y: 0 };
      pip.root.position.set(at.x, at.y);
      pip.root.scale.set(scale);
      const free = j >= count;
      const own = this.colours[this.me];
      pip.back.set(helmetBackSpec('own', width, own, free ? 'dashed' : 'solid', false));
      pip.front.set(helmetFrontSpec('own', width, own, free ? 'dashed' : 'solid'));
      pip.level.set(free ? null : helmetLevelSpec('own', width, own));
      const unitTicks = state.unitTicks ?? 0;
      const share =
        free || j > 0
          ? 0
          : state.waiting
            ? 1
            : unitTicks > 0
              ? Math.min(1, Math.max(0, state.progress / unitTicks))
              : 0;
      // A new queue or "less motion" shows the level at once; a unit that went shows the next at once.
      if (!this.warm || reducedMotion() || share < pip.fill.value) pip.fill.snap(share);
      else pip.fill.setTarget(share);
      showPipFill(pip);
      if (pip.fill.active) this.easing.add(pip);
      // #930, W4: the CP mark of its walk beyond the recruit, upright; red with a down chevron
      // when the CP now do not pay it.
      const walk = free ? undefined : state.walks[j];
      pip.mark.visible = walk !== undefined;
      if (walk !== undefined) {
        const d = Math.hypot(at.x, at.y);
        const k = (d + WALK_MARK.out * scale) / d;
        pip.mark.position.set(at.x * k, at.y * k);
        pip.mark.scale.set(scale);
        pip.markBack.set(cpMarkSpec(walk ? 'down' : 'ink', WALK_MARK.size, WALK_MARK.dim));
        pip.markFill.set(walk ? null : cpMarkSpec('ink', WALK_MARK.size));
        showMarkFill(pip);
      }
    });
    for (let j = slots; j < pips.length; j++) {
      const pip = pips[j];
      if (pip !== undefined) pip.mark.visible = false;
    }
    const ring = count > 0 && (state.waiting || state.paused) ? (seats[0] ?? null) : null;
    alert.set(ring === null ? null : pipAlertSpec(8));
    if (ring !== null) {
      alert.position.set(ring.x, ring.y);
      alert.scale.set(scale);
    }
    alert.visible = ring !== null;
    if (ring === null) this.alerting.delete(id);
    else this.alerting.add(id);
  }

  private pipSlot(layer: Container): PipSlot {
    const root = layer.addChild(new Container({ label: 'recruit' }));
    const back = root.addChild(this.sprites.sprite());
    const level = root.addChild(this.sprites.sprite());
    const front = root.addChild(this.sprites.sprite());
    level.visible = false;
    const mark = layer.addChild(new Container({ label: 'walk-mark' }));
    const markBack = mark.addChild(this.sprites.sprite());
    const markFill = mark.addChild(this.sprites.sprite());
    mark.visible = false;
    return {
      root,
      back,
      level,
      front,
      fill: new EaseTween(0, PIP_EASE_MS),
      mark,
      markBack,
      markFill,
    };
  }
}

/** The part of a body's key that names its owner and look, without the plate of units standing there. */
function ownerPart(key: string): string {
  return key.replace(/:o$/, ':');
}

/** Inks a walk's CP mark in from its foot as its recruit is made (#930, W4). */
function showMarkFill(pip: PipSlot): void {
  const shown = pip.fill.value;
  pip.markFill.visible = shown > 0 && pip.markFill.spec !== null;
  if (shown <= 0) return;
  const g = cpMarkGlyph(WALK_MARK.size);
  const half = WALK_MARK.size / 2 + 1;
  pip.markFill.cropBottom(half - g.bottom + 1 + shown * (g.bottom - g.top));
}

/** Puts a recruit's shown fill on its level sprite: the bottom of the dome up to the level. */
function showPipFill(pip: PipSlot): void {
  const shown = pip.fill.value;
  pip.level.visible = shown > 0 && pip.level.spec !== null;
  const h = helmet('own', RECRUIT_PIPS.width);
  if (shown > 0) pip.level.cropBottom(1 + shown * (h.domeBottom - h.domeTop));
}
