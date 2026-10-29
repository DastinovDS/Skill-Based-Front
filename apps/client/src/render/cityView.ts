import { Container, Text, TextStyle } from 'pixi.js';
import type { BuildKind, MapFile, NodeView, PlayerId, SnapshotMsg } from '../protocol.gen.ts';
import type { CityDevelopment } from './source.ts';
import type { Point } from './camera.ts';
import {
  barracksAt,
  barTop,
  cityRadius,
  lockedPlaces,
  ringRadius,
  showsBarracks,
} from './cityLayout.ts';
import {
  CAPITAL_RADIUS,
  ENEMY,
  NODE_RADIUS,
  PROVINCE,
  VP_BADGE_RADIUS,
  VP_FONT_SIZE,
  VP_TEXT_COLOR,
  YOU,
  sideOf,
} from './style.ts';
import { reducedMotion } from './motion.ts';
import { beaconPulse } from './alertLayout.ts';
import { alertSpot, alertAlpha, buildMark, markTops, queueMark } from './progressLayout.ts';
import type { MapLayers } from './layers.ts';
import type { BakedSprite, SpriteCache } from './bake.ts';
import {
  barracksSpec,
  buildMarkSpec,
  cityBodySpec,
  cityRingSpec,
  progressAlertSpec,
  provinceBodySpec,
  queueMarkSpec,
  stockColor,
  vpBadgeSpec,
  warehouseBarSpec,
  type CityKind,
} from './bakedShapes.ts';

/** What a city looks like; the city is redrawn only when this changes. */
interface CityState {
  readonly owner: PlayerId | null;
  /** `null`: the capacity is not known yet (a map without a snapshot). */
  readonly capacity: number | null;
  /** Units of the viewing player standing in the city. */
  readonly garrison: number;
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
  /** Segments of the warehouse bar: the warehouse capacity (DEC-26), or the charges only. */
  readonly warehouseCap: number | null;
  /** Own city: dashed places of the warehouse levels not built yet (DEC-26, C1); 0 for the rest. */
  readonly locked: number;
  /** Own city: what it is building (DEC-26) and the share done, in percent; `null`: nothing. */
  readonly buildKind: BuildKind | null;
  readonly buildPct: number;
  /** A city known to have the barracks (own, DEC-26, or an enemy's next door, DEC-31): the house. */
  readonly barracks: boolean;
}

function stateKey(s: CityState): string {
  return [
    s.owner,
    s.capacity,
    s.garrison,
    s.warehouse,
    s.queue,
    s.progress,
    s.unitTicks,
    s.waiting,
    s.paused,
    s.queueMax,
    s.warehouseCap,
    s.locked,
    s.buildKind,
    s.buildPct,
    s.barracks,
  ]
    .map(String)
    .join('|');
}

/** A point on the circle of `radius` at `angle` radians. */
function onCircle(radius: number, angle: number): Point {
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

/**
 * The cities of the map (ui-style.md 9.4): a body whose size follows the capacity class, filled
 * with the colour of the owner (own: blue with a white outline, enemy: red with a white outline and
 * a dark inner ring, neutral: grey with a thin outline), the capital star, the capacity ring of
 * segments (white for own units standing there, grey otherwise; overcrowding is the alert view's
 * pulsing ring and badge, not drawn here), the warehouse bar under the ring (a place per charge:
 * filled, a frame for room, dashed for a level not built yet, C1), the recruit queue and the
 * barracks or warehouse build of an own city above it as cells (DEC-25, DEC-26, variant A "Cells",
 * #439), the barracks house of an own city (DEC-26) or of an enemy city next to an own node (DEC-31)
 * and the VP badge. The capacity is public and exact (DEC-22: fixed by
 * the node kind).
 *
 * A province (`kind = province`, DEC-23, C1) is a small hollow ring instead of a body, with the
 * capacity ring but no warehouse bar, queue, barracks or VP badge.
 *
 * BL1-1 "Restrained" (#347): the body, the ring, the bar, the badges are baked sprites (a gradient,
 * a soft shadow, a light rim; `bakedShapes.ts`, `SpriteCache`), one texture per look shared by every
 * city with it, swapped when a city's state changes. The queue and build plates are baked the same
 * way, one texture per look: the growing part is quantized to whole pixels, so a build takes at most
 * 32 textures and a unit in production 12, whatever the number of cities. The dashed ring that asks
 * for a look (a unit ready with no room, production stopped by a fight) is a sprite of its own and
 * pulses (`pulse`). `destroy()` releases every object (the textures belong to the cache).
 */
export class CityView {
  private readonly cities: Container[];
  private readonly bodies: BakedSprite[];
  private readonly rings: BakedSprite[];
  private readonly bars: BakedSprite[];
  private readonly queues: BakedSprite[];
  private readonly builds: BakedSprite[];
  private readonly alerts: BakedSprite[];
  /** The cities whose alert ring is on now (it pulses every frame). */
  private readonly alerting = new Set<number>();
  private readonly barracks: BakedSprite[];
  private readonly badges: (Container | null)[];
  private readonly vpLabels: Text[] = [];
  private readonly keys: string[];
  /** The last state of every city: a change of the selection redraws from it. */
  private readonly states: (CityState | null)[];
  /** The selected city: it shows the free slots of its queue. */
  private selected: number | null = null;
  private readonly radii: number[];
  private readonly vpStyle: TextStyle;
  private supplyMode = false;

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    private readonly me: PlayerId,
    labelResolution: number,
    sprites: SpriteCache,
  ) {
    this.vpStyle = new TextStyle({
      fontFamily: 'system-ui, sans-serif',
      fontSize: VP_FONT_SIZE,
      fontWeight: '700',
      fill: VP_TEXT_COLOR,
    });
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
    this.queues = [];
    this.builds = [];
    this.alerts = [];
    this.barracks = [];
    this.badges = [];
    for (const node of map.nodes) {
      const city = new Container({ x: node.x, y: node.y, label: `node-${String(node.id)}` });
      this.bodies.push(city.addChild(sprites.sprite()));
      this.rings.push(city.addChild(sprites.sprite()));
      this.bars.push(city.addChild(sprites.sprite()));
      const queue = city.addChild(sprites.sprite());
      queue.label = 'queue';
      this.queues.push(queue);
      const build = city.addChild(sprites.sprite());
      build.label = 'build';
      this.builds.push(build);
      const ring = city.addChild(sprites.sprite());
      ring.label = 'progress-alert';
      ring.visible = false;
      this.alerts.push(ring);
      const house = city.addChild(sprites.sprite());
      house.label = 'barracks';
      house.visible = false;
      this.barracks.push(house);
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
        this.vpLabels.push(badge.addChild(label));
        this.badges.push(badge);
      } else {
        this.badges.push(null);
      }
      this.cities.push(layers.layer.nodes.addChild(city));
    }
    this.setOwners(map.nodes.map((node) => node.start_owner));
  }

  /** Radius of the city `id` now: by its capacity class, a default until the capacity is known. */
  radiusOf(id: number): number {
    return this.radii[id] ?? NODE_RADIUS;
  }

  /** The radii of all cities (kept in step with the snapshots; read by other views). */
  get radiusTable(): readonly number[] {
    return this.radii;
  }

  /** Owners before the first snapshot (the map's start owners); capacity is not known yet. */
  setOwners(owners: readonly (PlayerId | null)[]): void {
    owners.forEach((owner, id) => {
      this.set(id, {
        owner,
        capacity: null,
        garrison: 0,
        warehouse: null,
        queue: null,
        progress: 0,
        unitTicks: null,
        waiting: false,
        paused: false,
        queueMax: 0,
        warehouseCap: null,
        locked: 0,
        buildKind: null,
        buildPct: 0,
        barracks: false,
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
  ): void {
    const garrison = new Map<number, number>();
    for (const group of base.view.groups) {
      if (group.location.kind === 'node') {
        garrison.set(group.location.node, (garrison.get(group.location.node) ?? 0) + group.units);
      }
    }
    // A city with a fight in it: its production stands (DEC-25, item 9).
    const fighting = new Set<number>();
    for (const fight of base.view.fights) {
      if (fight.node !== null) fighting.add(fight.node);
    }
    for (const node of base.view.nodes) {
      this.set(
        node.id,
        this.stateOf(
          node,
          { garrison: garrison.get(node.id) ?? 0, fighting: fighting.has(node.id) },
          { unitTicks, cityUpgrades, queueMax },
          base.tick,
        ),
      );
    }
  }

  /**
   * The selected city (`null`: none) shows the free slots of its recruit queue as dashed cells. The
   * server decides what the city can queue; this only draws the room that is left.
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

  /** Every frame: the dashed rings that ask for a look pulse (steady with "less motion"). */
  pulse(nowMs: number): void {
    if (this.alerting.size === 0) return;
    const alpha = alertAlpha(beaconPulse(nowMs, false), reducedMotion());
    for (const id of this.alerting) {
      const ring = this.alerts[id];
      if (ring !== undefined) ring.alpha = alpha;
    }
  }

  /**
   * The «Supply» map mode (DEC-28, item 8) shows no garrison ring, warehouse bar, recruit queue or
   * barracks mark on the city: the layer of its own draws the warehouse.
   */
  setSupplyMode(on: boolean): void {
    if (on === this.supplyMode) return;
    this.supplyMode = on;
    for (const marks of [this.rings, this.bars, this.barracks, this.queues, this.builds]) {
      for (const mark of marks) mark.visible = !on && mark.spec !== null;
    }
    this.alerts.forEach((ring, id) => {
      ring.visible = !on && this.alerting.has(id);
    });
  }

  setLabelResolution(resolution: number): void {
    for (const text of this.vpLabels) {
      if (text.resolution !== resolution) text.resolution = resolution;
    }
  }

  destroy(): void {
    for (const city of this.cities) city.destroy({ children: true });
    this.vpStyle.destroy();
  }

  // --- Drawing ------------------------------------------------------------------------------

  private stateOf(
    node: NodeView,
    city: { garrison: number; fighting: boolean },
    rules: {
      unitTicks: number | null;
      cityUpgrades: CityDevelopment | null;
      queueMax: number | null;
    },
    tick: number,
  ): CityState {
    const { unitTicks, cityUpgrades } = rules;
    const building = node.building;
    let buildKind: BuildKind | null = null;
    let buildPct = 0;
    if (building !== null && building.kind !== 'road' && cityUpgrades !== null) {
      const total = cityUpgrades[building.kind];
      buildKind = building.kind;
      buildPct = Math.min(
        100,
        Math.max(0, Math.round((100 * (total - Math.max(0, building.done_tick - tick))) / total)),
      );
    }
    // Free slots are shown where a unit can be queued: an own city (the view carries its queue), with
    // the barracks when the city development is on (DEC-26, the same test as the city menu).
    const recruits =
      node.owner === this.me &&
      node.recruit_queue !== null &&
      (cityUpgrades === null || node.has_barracks === true);
    return {
      owner: node.owner,
      capacity: node.capacity,
      garrison: node.owner === this.me ? city.garrison : 0,
      warehouse: node.detail === 'exact' ? node.warehouse : null,
      queue: node.recruit_queue,
      progress: node.recruit_progress ?? 0,
      unitTicks,
      waiting: node.recruit_waiting === true,
      paused: city.fighting,
      queueMax: recruits ? (rules.queueMax ?? 0) : 0,
      // DEC-26: an own city knows its warehouse capacity; a foreign one shows only its charges
      // when the warehouse is apart from the capacity, else the capacity (DEC-22).
      warehouseCap: node.warehouse_cap ?? (cityUpgrades === null ? node.capacity : null),
      locked: lockedPlaces(node.warehouse_level, cityUpgrades),
      buildKind,
      buildPct,
      barracks: showsBarracks(node.has_barracks, cityUpgrades !== null),
    };
  }

  private kindOf(owner: PlayerId | null): CityKind {
    return owner === null ? 'neutral' : sideOf(this.me, owner);
  }

  /** The body of city `id`. */
  private drawBody(id: number, state: CityState): void {
    const node = this.map.nodes[id];
    const body = this.bodies[id];
    if (node === undefined || body === undefined) return;
    const kind = this.kindOf(state.owner);
    body.set(
      node.kind === 'province'
        ? provinceBodySpec(kind)
        : cityBodySpec(kind, this.radii[id] ?? NODE_RADIUS, node.capital_of !== null),
    );
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
    const queue = this.queues[id];
    const build = this.builds[id];
    const alert = this.alerts[id];
    const barracks = this.barracks[id];
    if (
      node === undefined ||
      ring === undefined ||
      bar === undefined ||
      queue === undefined ||
      build === undefined ||
      alert === undefined ||
      barracks === undefined
    ) {
      return;
    }

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

    this.drawProgress(id, state, radius, selected);

    // The barracks house: the same shape for both sides, the rim takes the colour of the owner.
    barracks.set(state.barracks ? barracksSpec(kind === 'enemy' ? ENEMY : YOU) : null);
    if (state.barracks) {
      const at = barracksAt(radius);
      barracks.position.set(at.x, at.y);
    }
    barracks.visible = state.barracks && !this.supplyMode;

    const { capacity, warehouse } = state;
    const ringOn = capacity !== null;
    ring.set(ringOn ? cityRingSpec(radius, capacity, kind === 'you' ? state.garrison : 0) : null);
    ring.visible = ringOn && !this.supplyMode;
    // A province has no warehouse (DEC-23): whatever number the view carries, nothing is drawn.
    const barOn = ringOn && warehouse !== null && !province;
    bar.set(
      barOn
        ? warehouseBarSpec(
            state.warehouseCap ?? warehouse,
            warehouse,
            stockColor(kind),
            state.locked,
          )
        : null,
    );
    if (barOn) bar.position.set(0, barTop(radius));
    bar.visible = barOn && !this.supplyMode;

    const badge = this.badges[id];
    if (badge !== null && badge !== undefined) {
      // Outside the capacity ring: the icon of the units in the city covers the body.
      const at = onCircle(ringRadius(radius) + VP_BADGE_RADIUS + 1, -Math.PI / 4);
      badge.position.set(at.x, at.y);
    }
  }

  /**
   * The progress marks of an own city (variant A "Cells", #439): the recruit queue (DEC-25) with the
   * dashed free slots of a selected city, the barracks or warehouse build (DEC-26) above it and the
   * dashed ring round the first queue cell when it needs a look. All from the snapshot and the rules.
   */
  private drawProgress(id: number, state: CityState, radius: number, selected: boolean): void {
    const queue = this.queues[id];
    const build = this.builds[id];
    const alert = this.alerts[id];
    if (queue === undefined || build === undefined || alert === undefined) return;
    const queued = state.queue ?? 0;
    const plate =
      state.unitTicks === null
        ? null
        : queueMark({
            count: queued,
            progress: state.progress,
            unitTicks: state.unitTicks,
            waiting: state.waiting,
            paused: state.paused,
            slots: selected ? state.queueMax : 0,
          });
    const built =
      state.buildKind === null ? null : buildMark(state.buildKind, state.buildPct / 100);
    const tops = markTops(radius, plate, built);

    queue.set(plate === null ? null : queueMarkSpec(plate));
    if (plate !== null && tops.queue !== null) queue.position.set(0, tops.queue);
    queue.visible = plate !== null && !this.supplyMode;
    build.set(built === null ? null : buildMarkSpec(built));
    if (built !== null && tops.build !== null) build.position.set(0, tops.build);
    build.visible = built !== null && !this.supplyMode;

    const spot = plate === null || tops.queue === null ? null : alertSpot(plate, tops.queue);
    alert.set(spot === null ? null : progressAlertSpec(spot.width, spot.height));
    if (spot !== null) alert.position.set(spot.x, spot.y);
    alert.visible = spot !== null && !this.supplyMode;
    if (spot === null) {
      this.alerting.delete(id);
    } else {
      this.alerting.add(id);
    }
  }
}
