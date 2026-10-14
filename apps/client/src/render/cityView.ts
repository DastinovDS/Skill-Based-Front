import { Container, Graphics, GraphicsContext, Text, TextStyle } from 'pixi.js';
import type { MapFile, NodeView, PlayerId, SnapshotMsg } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import {
  barTop,
  capacityRing,
  cityRadius,
  ringRadius,
  warehouseSegments,
  type Arc,
} from './cityLayout.ts';
import {
  BAR_BASE,
  BAR_SEGMENT,
  BG,
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
  RING_FILLED,
  RING_SEGMENT,
  SEGMENT_EMPTY,
  SEGMENT_EMPTY_BAR,
  VP_BADGE,
  VP_BADGE_RADIUS,
  VP_FONT_SIZE,
  VP_TEXT_COLOR,
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
}

function stateKey(s: CityState): string {
  return [s.owner, s.capacity, s.garrison, s.warehouse].map(String).join('|');
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
 * pulsing ring and badge, not drawn here), the warehouse bar under the ring and the VP badge. The capacity is public and
 * exact (DEC-22: fixed by the node kind).
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
    this.badges = [];
    for (const node of map.nodes) {
      const city = new Container({ x: node.x, y: node.y, label: `node-${String(node.id)}` });
      this.bodies.push(city.addChild(new Graphics()));
      this.stars.push(node.capital_of === null ? null : city.addChild(new Graphics()));
      this.rings.push(city.addChild(new Graphics()));
      this.bars.push(city.addChild(new Graphics()));
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
      this.set(id, { owner, capacity: null, garrison: 0, warehouse: null });
    });
  }

  /** A new snapshot: owners, capacity classes, garrisons and warehouses. */
  update(base: SnapshotMsg): void {
    const garrison = new Map<number, number>();
    for (const group of base.view.groups) {
      if (group.location.kind === 'node') {
        garrison.set(group.location.node, (garrison.get(group.location.node) ?? 0) + group.units);
      }
    }
    for (const node of base.view.nodes) {
      this.set(node.id, this.stateOf(node, garrison.get(node.id) ?? 0));
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

  private stateOf(node: NodeView, garrison: number): CityState {
    return {
      owner: node.owner,
      capacity: node.capacity,
      garrison: node.owner === this.me ? garrison : 0,
      warehouse: node.detail === 'exact' ? node.warehouse : null,
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
    if (node === undefined || body === undefined || ring === undefined || bar === undefined) return;

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
    if (state.capacity !== null) {
      this.drawRing(ring, radius, state.capacity, kind === 'you' ? state.garrison : 0);
      if (state.warehouse !== null) {
        this.drawBar(bar, radius, state.warehouse, state.capacity, state.owner);
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
