import { Container, Graphics, GraphicsContext, Text, TextStyle } from 'pixi.js';
import type { MapFile, NodeView, PlayerId, SnapshotMsg } from '../protocol.gen.ts';
import type { CityBuildTicks } from './source.ts';
import type { Point } from './camera.ts';
import {
  BARRACKS_HOUSE,
  barracksAt,
  barTop,
  capacityRing,
  cityRadius,
  queueSlots,
  queueTop,
  ringRadius,
  showsBarracks,
  warehouseSegments,
  type Arc,
} from './cityLayout.ts';
import {
  BARRACKS_MARK,
  BAR_BASE,
  BAR_SEGMENT,
  BG,
  BUILD_MARK,
  CAPITAL_RADIUS,
  CAPITAL_STAR,
  CITY_HALO,
  CITY_HALO_INSET,
  ENEMY,
  INNER_RING,
  INNER_RING_INSET,
  NEUTRAL_FILL,
  NEUTRAL_OUTLINE,
  NEUTRAL_STROKE,
  NODE_RADIUS,
  OWNER_OUTLINE,
  PAPER,
  QUEUE_SLOT,
  RING_FILLED,
  RING_SEGMENT,
  SEGMENT_EMPTY,
  SEGMENT_EMPTY_BAR,
  VP_BADGE,
  VP_BADGE_RADIUS,
  VP_FONT_SIZE,
  VP_TEXT_COLOR,
  WARN,
  YOU,
  sideOf,
} from './style.ts';
import type { MapLayers } from './layers.ts';

type Kind = 'neutral' | 'you' | 'enemy';

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
  /** Own city with the barracks (DEC-26): the house mark is drawn. */
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
 * own city above it (DEC-25), the barracks house of an own city (DEC-26) and the VP badge. The capacity is public and exact (DEC-22: fixed by
 * the node kind).
 *
 * Bodies share GraphicsContexts (one per kind and radius); rings and bars are redrawn when a
 * city's state changes. `destroy()` releases every object and context created here.
 */
export class CityView {
  private readonly contexts = new Map<string, GraphicsContext>();
  private readonly shared: GraphicsContext[] = [];
  private readonly cities: Container[];
  private readonly bodies: Graphics[];
  private readonly stars: (Graphics | null)[];
  private readonly rings: Graphics[];
  private readonly bars: Graphics[];
  private readonly queues: Graphics[];
  private readonly barracks: Graphics[];
  private readonly badges: (Container | null)[];
  private readonly vpLabels: Text[] = [];
  private readonly keys: string[];
  private readonly radii: number[];
  private readonly vpStyle: TextStyle;
  private readonly badge: GraphicsContext;

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    private readonly me: PlayerId,
    labelResolution: number,
  ) {
    this.vpStyle = new TextStyle({
      fontFamily: 'system-ui, sans-serif',
      fontSize: VP_FONT_SIZE,
      fontWeight: '700',
      fill: VP_TEXT_COLOR,
    });
    this.badge = this.context('badge', (g) =>
      g.circle(0, 0, VP_BADGE_RADIUS).fill(VP_BADGE.fill).stroke(VP_BADGE.stroke),
    );
    this.keys = map.nodes.map(() => '');
    this.radii = map.nodes.map((node) => (node.capital_of === null ? NODE_RADIUS : CAPITAL_RADIUS));
    this.cities = [];
    this.bodies = [];
    this.stars = [];
    this.rings = [];
    this.bars = [];
    this.queues = [];
    this.barracks = [];
    this.badges = [];
    for (const node of map.nodes) {
      const city = new Container({ x: node.x, y: node.y, label: `node-${String(node.id)}` });
      this.bodies.push(city.addChild(new Graphics()));
      this.stars.push(node.capital_of === null ? null : city.addChild(new Graphics()));
      this.rings.push(city.addChild(new Graphics()));
      this.bars.push(city.addChild(new Graphics()));
      this.queues.push(city.addChild(new Graphics()));
      this.barracks.push(city.addChild(new Graphics()));
      if (node.vp > 0) {
        const badge = city.addChild(new Container());
        badge.addChild(new Graphics(this.badge));
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
    for (const marks of [this.rings, this.bars, this.queues, this.barracks]) {
      for (const mark of marks) mark.visible = !on;
    }
  }

  setLabelResolution(resolution: number): void {
    for (const text of this.vpLabels) {
      if (text.resolution !== resolution) text.resolution = resolution;
    }
  }

  destroy(): void {
    // Children first: they reference the shared contexts, which Graphics.destroy() leaves alone.
    for (const city of this.cities) city.destroy({ children: true });
    for (const context of this.shared) context.destroy();
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

  private context(key: string, draw: (g: GraphicsContext) => GraphicsContext): GraphicsContext {
    let context = this.contexts.get(key);
    if (context === undefined) {
      context = draw(new GraphicsContext());
      this.contexts.set(key, context);
      this.shared.push(context);
    }
    return context;
  }

  private kindOf(owner: PlayerId | null): Kind {
    return owner === null ? 'neutral' : sideOf(this.me, owner);
  }

  private bodyContext(kind: Kind, radius: number): GraphicsContext {
    return this.context(`body:${kind}:${String(radius)}`, (g) => {
      g.circle(0, 0, radius + CITY_HALO_INSET).stroke(CITY_HALO);
      switch (kind) {
        case 'neutral':
          return g.circle(0, 0, radius).fill(NEUTRAL_FILL).stroke(NEUTRAL_OUTLINE);
        case 'you':
          return g.circle(0, 0, radius).fill(YOU).stroke(OWNER_OUTLINE);
        case 'enemy':
          return g
            .circle(0, 0, radius)
            .fill(ENEMY)
            .stroke(OWNER_OUTLINE)
            .circle(0, 0, radius - INNER_RING_INSET)
            .stroke(INNER_RING);
      }
    });
  }

  private starContext(radius: number): GraphicsContext {
    return this.context(`star:${String(radius)}`, (g) =>
      g
        .star(0, 0, 5, radius * 0.6, radius * 0.27, -Math.PI / 2)
        .fill(CAPITAL_STAR.fill)
        .stroke(CAPITAL_STAR.stroke),
    );
  }

  private set(id: number, state: CityState): void {
    const key = stateKey(state);
    if (this.keys[id] === key) return;
    this.keys[id] = key;
    const node = this.map.nodes[id];
    const body = this.bodies[id];
    const ring = this.rings[id];
    const bar = this.bars[id];
    const queue = this.queues[id];
    const barracks = this.barracks[id];
    if (
      node === undefined ||
      body === undefined ||
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
    body.context = this.bodyContext(kind, radius);
    const star = this.stars[id];
    if (star !== null && star !== undefined) star.context = this.starContext(radius);

    ring.clear();
    bar.clear();
    queue.clear();
    barracks.clear();
    if (state.barracks) this.drawBarracks(barracks, radius);
    if (state.queue !== null && state.queue > 0 && state.unitTicks !== null) {
      this.drawQueue(queue, radius, state.queue, state.progress, state.unitTicks);
    }
    if (state.buildPct !== null) this.drawBuild(queue, radius, state.buildPct);
    if (state.capacity !== null) {
      this.drawRing(ring, radius, state.capacity, kind === 'you' ? state.garrison : 0);
      if (state.warehouse !== null) {
        const cap = state.warehouseCap ?? state.warehouse;
        this.drawBar(bar, radius, state.warehouse, cap, state.owner);
      }
    }
    const badge = this.badges[id];
    if (badge !== null && badge !== undefined) {
      // Outside the capacity ring: the icon of the units in the city covers the body.
      const at = onCircle(ringRadius(radius) + VP_BADGE_RADIUS + 1, -Math.PI / 4);
      badge.position.set(at.x, at.y);
    }
  }

  private strokeArcs(g: Graphics, radius: number, arcs: readonly Arc[], style: object): void {
    for (const arc of arcs) {
      const start = onCircle(radius, arc.from);
      g.moveTo(start.x, start.y).arc(0, 0, radius, arc.from, arc.to);
    }
    g.stroke({ ...style, cap: 'butt' });
  }

  private drawRing(g: Graphics, radius: number, capacity: number, garrison: number): void {
    const r = ringRadius(radius);
    const ring = capacityRing(capacity, garrison);
    this.strokeArcs(g, r, ring.arcs, {
      width: RING_SEGMENT.base,
      color: BG,
      alpha: RING_SEGMENT.baseAlpha,
    });
    this.strokeArcs(
      g,
      r,
      ring.arcs.filter((arc) => arc.filled),
      { width: RING_SEGMENT.width, color: RING_FILLED },
    );
    this.strokeArcs(
      g,
      r,
      ring.arcs.filter((arc) => !arc.filled),
      { width: RING_SEGMENT.width, color: SEGMENT_EMPTY },
    );
    for (const angle of ring.notches) {
      const inner = onCircle(r - RING_SEGMENT.base / 2, angle);
      const outer = onCircle(r + RING_SEGMENT.base / 2, angle);
      g.moveTo(inner.x, inner.y).lineTo(outer.x, outer.y);
    }
    if (ring.notches.length > 0) g.stroke({ width: 1.5, color: BG });
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

  /** The barracks of an own city (DEC-26): a dark badge with a house, left of the ring. */
  private drawBarracks(g: Graphics, radius: number): void {
    const at = barracksAt(radius);
    g.circle(at.x, at.y, BARRACKS_MARK.radius)
      .fill(BARRACKS_MARK.fill)
      .stroke(BARRACKS_MARK.stroke);
    g.poly(BARRACKS_HOUSE.flatMap(([x, y]) => [at.x + x, at.y + y])).fill(PAPER);
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

  private drawBar(
    g: Graphics,
    radius: number,
    warehouse: number,
    capacity: number,
    owner: PlayerId | null,
  ): void {
    const bar = warehouseSegments(warehouse, capacity);
    if (bar.segments.length === 0) return;
    const top = barTop(radius);
    const color = owner === null ? NEUTRAL_STROKE : sideOf(this.me, owner) === 'you' ? YOU : ENEMY;
    g.roundRect(
      -bar.width / 2 - 1,
      top - 1,
      bar.width + 2,
      BAR_SEGMENT.height + 4,
      BAR_BASE.radius,
    ).fill(BAR_BASE.color);
    for (const segment of bar.segments) {
      g.rect(segment.x, top + 1, BAR_SEGMENT.width, BAR_SEGMENT.height).fill(
        segment.filled ? color : SEGMENT_EMPTY_BAR,
      );
    }
  }
}
