import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { MapFile, NodeView, PlayerId, SnapshotMsg } from '../protocol.gen.ts';
import type { CityBuildTicks } from './source.ts';
import type { Point } from './camera.ts';
import {
  barracksAt,
  barTop,
  cityRadius,
  queueSlots,
  queueTop,
  ringRadius,
  showsBarracks,
} from './cityLayout.ts';
import {
  BAR_BASE,
  BUILD_MARK,
  CAPITAL_RADIUS,
  ENEMY,
  NODE_RADIUS,
  PAPER,
  QUEUE_SLOT,
  SEGMENT_EMPTY_BAR,
  VP_BADGE_RADIUS,
  VP_FONT_SIZE,
  VP_TEXT_COLOR,
  WARN,
  YOU,
  sideOf,
} from './style.ts';
import type { MapLayers } from './layers.ts';
import type { BakedSprite, SpriteCache } from './bake.ts';
import {
  barracksSpec,
  cityBodySpec,
  cityRingSpec,
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
  /** Segments of the warehouse bar: the warehouse capacity (DEC-26), or the charges only. */
  readonly warehouseCap: number | null;
  /** Own city: share of its barracks or warehouse build done, in percent; `null`: none. */
  readonly buildPct: number | null;
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
    s.warehouseCap,
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
 * pulsing ring and badge, not drawn here), the warehouse bar under the ring, the recruit queue of an
 * own city above it (DEC-25), the barracks house of an own city (DEC-26) or of an enemy city next to
 * an own node (DEC-31) and the VP badge. The capacity is public and exact (DEC-22: fixed by
 * the node kind).
 *
 * BL1-1 "Restrained" (#347): the body, the ring, the bar, the badges are baked sprites (a gradient,
 * a soft shadow, a light rim; `bakedShapes.ts`, `SpriteCache`), one texture per look shared by every
 * city with it, swapped when a city's state changes. The recruit queue and the build bar stay
 * vectors: their progress changes every snapshot, a texture per step would churn the cache.
 * `destroy()` releases every object (the textures belong to the cache).
 */
export class CityView {
  private readonly cities: Container[];
  private readonly bodies: BakedSprite[];
  private readonly rings: BakedSprite[];
  private readonly bars: BakedSprite[];
  private readonly queues: Graphics[];
  private readonly barracks: BakedSprite[];
  private readonly badges: (Container | null)[];
  private readonly vpLabels: Text[] = [];
  private readonly keys: string[];
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
    this.radii = map.nodes.map((node) => (node.capital_of === null ? NODE_RADIUS : CAPITAL_RADIUS));
    this.cities = [];
    this.bodies = [];
    this.rings = [];
    this.bars = [];
    this.queues = [];
    this.barracks = [];
    this.badges = [];
    for (const node of map.nodes) {
      const city = new Container({ x: node.x, y: node.y, label: `node-${String(node.id)}` });
      this.bodies.push(city.addChild(sprites.sprite()));
      this.rings.push(city.addChild(sprites.sprite()));
      this.bars.push(city.addChild(sprites.sprite()));
      this.queues.push(city.addChild(new Graphics()));
      const house = city.addChild(sprites.sprite());
      house.label = 'barracks';
      house.visible = false;
      this.barracks.push(house);
      if (node.vp > 0) {
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
        warehouseCap: null,
        buildPct: null,
        barracks: false,
      });
    });
  }

  /**
   * A new snapshot: owners, capacity classes, garrisons, warehouses and recruit queues;
   * `unitTicks`: ticks per recruit (`null`: no queue marks).
   */
  update(
    base: SnapshotMsg,
    unitTicks: number | null = null,
    cityUpgrades: CityBuildTicks | null = null,
  ): void {
    const garrison = new Map<number, number>();
    for (const group of base.view.groups) {
      if (group.location.kind === 'node') {
        garrison.set(group.location.node, (garrison.get(group.location.node) ?? 0) + group.units);
      }
    }
    for (const node of base.view.nodes) {
      this.set(
        node.id,
        this.stateOf(node, garrison.get(node.id) ?? 0, unitTicks, cityUpgrades, base.tick),
      );
    }
  }

  /**
   * The «Supply» map mode (DEC-28, item 8) shows no garrison ring, warehouse bar, recruit queue or
   * barracks mark on the city: the layer of its own draws the warehouse.
   */
  setSupplyMode(on: boolean): void {
    if (on === this.supplyMode) return;
    this.supplyMode = on;
    for (const marks of [this.rings, this.bars, this.barracks]) {
      for (const mark of marks) mark.visible = !on && mark.spec !== null;
    }
    for (const queue of this.queues) queue.visible = !on;
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
    garrison: number,
    unitTicks: number | null,
    cityUpgrades: CityBuildTicks | null,
    tick: number,
  ): CityState {
    const building = node.building;
    let buildPct: number | null = null;
    if (building !== null && building.kind !== 'road' && cityUpgrades !== null) {
      const total = cityUpgrades[building.kind];
      buildPct = Math.round((100 * (total - Math.max(0, building.done_tick - tick))) / total);
    }
    return {
      owner: node.owner,
      capacity: node.capacity,
      garrison: node.owner === this.me ? garrison : 0,
      warehouse: node.detail === 'exact' ? node.warehouse : null,
      queue: node.recruit_queue,
      progress: node.recruit_progress ?? 0,
      unitTicks,
      // DEC-26: an own city knows its warehouse capacity; a foreign one shows only its charges
      // when the warehouse is apart from the capacity, else the capacity (DEC-22).
      warehouseCap: node.warehouse_cap ?? (cityUpgrades === null ? node.capacity : null),
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
    body.set(
      cityBodySpec(
        this.kindOf(state.owner),
        this.radii[id] ?? NODE_RADIUS,
        node.capital_of !== null,
      ),
    );
  }

  private set(id: number, state: CityState): void {
    const key = stateKey(state);
    if (this.keys[id] === key) return;
    this.keys[id] = key;
    const node = this.map.nodes[id];
    const ring = this.rings[id];
    const bar = this.bars[id];
    const queue = this.queues[id];
    const barracks = this.barracks[id];
    if (
      node === undefined ||
      ring === undefined ||
      bar === undefined ||
      queue === undefined ||
      barracks === undefined
    ) {
      return;
    }

    const capital = node.capital_of !== null;
    const radius =
      state.capacity === null
        ? capital
          ? CAPITAL_RADIUS
          : NODE_RADIUS
        : cityRadius(state.capacity);
    this.radii[id] = radius;
    const kind = this.kindOf(state.owner);
    this.drawBody(id, state);

    queue.clear();
    if (state.queue !== null && state.queue > 0 && state.unitTicks !== null) {
      this.drawQueue(queue, radius, state.queue, state.progress, state.unitTicks);
    }
    if (state.buildPct !== null) this.drawBuild(queue, radius, state.buildPct);

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
    const barOn = ringOn && warehouse !== null;
    bar.set(
      barOn ? warehouseBarSpec(state.warehouseCap ?? warehouse, warehouse, stockColor(kind)) : null,
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

  private drawQueue(
    g: Graphics,
    radius: number,
    count: number,
    progress: number,
    unitTicks: number,
  ): void {
    const mark = queueSlots(count, progress, unitTicks);
    const top = queueTop(radius);
    const { width, height } = QUEUE_SLOT;
    g.roundRect(-mark.width / 2 - 1, top - 1, mark.width + 2, height + 4, BAR_BASE.radius).fill(
      BAR_BASE.color,
    );
    for (const slot of mark.slots) {
      g.rect(slot.x, top + 1, width, height).fill(SEGMENT_EMPTY_BAR);
      if (slot.fill > 0) {
        // Full: a ready unit waits for a place (DEC-25, item 7), told by the full slot and the colour.
        g.rect(slot.x, top + 1, width * slot.fill, height).fill(slot.fill >= 1 ? WARN : YOU);
      }
    }
  }

  /** The barracks or warehouse build of an own city (DEC-26): a thin bar above the queue mark. */
  private drawBuild(g: Graphics, radius: number, pct: number): void {
    const top = queueTop(radius) - BUILD_MARK.height - BUILD_MARK.gap;
    const { width, height } = BUILD_MARK;
    g.roundRect(-width / 2 - 1, top - 1, width + 2, height + 2, BAR_BASE.radius).fill(
      BAR_BASE.color,
    );
    g.rect(-width / 2, top, width, height).fill(SEGMENT_EMPTY_BAR);
    g.rect(-width / 2, top, (width * Math.min(100, Math.max(0, pct))) / 100, height).fill(PAPER);
  }
}
