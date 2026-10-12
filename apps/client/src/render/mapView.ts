import { Container, Graphics, GraphicsContext, Sprite, type Renderer, type Texture } from 'pixi.js';
import type { MapFile, PlayerId, RoadKind } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import type { MapLayers } from './layers.ts';
import { territoryBorders } from './regionLayout.ts';
import {
  BACKDROP_DIM,
  CELL_BORDER,
  MAP_BORDER,
  ROAD_CASING,
  ROAD_CASING_EXTRA,
  ROAD_CHEVRON,
  ROAD_COLOR,
  ROAD_STRIPE,
  ROAD_TRAIL_DASH,
  ROAD_TRAIL_GAP,
  TERRAIN_FILL,
  TERRITORY_ALPHA,
  TERRITORY_BORDER,
  ownerColor,
  roadThickness,
} from './style.ts';
import { TerrainView } from './terrainView.ts';
import { voronoiCells } from './voronoi.ts';

type Owner = PlayerId | null;

/** One road: its parts are unit shapes along +x, scaled by the road's length and thickness. */
interface Road {
  readonly holder: Container;
  readonly body: Graphics;
  readonly stripes: Graphics[];
  /** The chevrons of a fast road; created on first need. */
  chevrons: Graphics | null;
  readonly length: number;
  width: number;
  kind: RoadKind;
}

/** A road as a snapshot shows it: level (the wire `width`) and type (DEC-22). */
export interface RoadLook {
  readonly width: number;
  readonly kind: RoadKind;
}

/**
 * Static part of the map (ui-style.md 9.1-9.3): the terrain background with its dimming and
 * stamps, the territory of the owners with its border line, and the roads. Cities are `CityView`.
 *
 * Owners and roads come from the map start fields now and from snapshots later (CLI-04, #60)
 * through `setOwners` and `setRoads`. A road reads without colour (DEC-22): level 1 is a dashed
 * trail; an upgraded road is solid and thicker per level; a freight road carries lanes (one per
 * level above 1), a fast road chevrons (double ones on level 3). Identical shapes share one
 * GraphicsContext (the unit road rectangle, the dashed trail and the chevrons of a given length);
 * `destroy()` releases every object and context created here.
 */
export class MapView {
  private readonly shared: GraphicsContext[] = [];
  private readonly roadContext: GraphicsContext;
  private readonly casingContext: GraphicsContext;
  private readonly stripeContext: GraphicsContext;
  private readonly trailContexts = new Map<number, GraphicsContext>();
  private readonly chevronContexts = new Map<string, GraphicsContext>();
  readonly cells: Point[][];
  private readonly terrainFill: Graphics;
  private readonly dim: Graphics;
  private readonly stamps: TerrainView;
  private readonly mapFrame: Graphics;
  private backdrop: Sprite | null = null;
  private readonly territory: Graphics;
  private readonly roads: Road[];
  private readonly casings: Graphics[];
  private readonly casingLayer: Container;
  private readonly bodyLayer: Container;
  private readonly layers: MapLayers;

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    private readonly me: PlayerId,
    renderer: Renderer,
  ) {
    const bounds = { width: map.meta.width, height: map.meta.height };
    this.cells = voronoiCells(map.nodes, bounds);

    // A unit rectangle along +x; each road scales it to its length and thickness.
    this.roadContext = this.context((g) => g.rect(0, -0.5, 1, 1).fill(ROAD_COLOR));
    // A dark edge under each road keeps it visible on the snow of the baked background.
    this.casingContext = this.context((g) => g.rect(0, -0.5, 1, 1).fill(ROAD_CASING));
    this.stripeContext = this.context((g) => g.rect(0, -0.5, 1, 1).fill(ROAD_STRIPE));

    this.layers = layers;
    const background = layers.layer.background;
    this.terrainFill = background.addChild(this.drawTerrain());
    this.dim = background.addChild(
      new Graphics().rect(0, 0, bounds.width, bounds.height).fill(BACKDROP_DIM),
    );
    this.stamps = new TerrainView(map, this.cells, background, renderer);
    this.mapFrame = background.addChild(
      new Graphics().rect(0, 0, bounds.width, bounds.height).stroke(MAP_BORDER),
    );
    this.territory = layers.layer.territory.addChild(new Graphics());

    // All casings first, so no casing covers a neighbouring road.
    this.casingLayer = layers.layer.roads.addChild(new Container({ label: 'road-casings' }));
    this.bodyLayer = layers.layer.roads.addChild(new Container({ label: 'road-bodies' }));
    const placed = (
      parent: Container,
      context: GraphicsContext,
      edge: MapFile['edges'][number],
    ) => {
      const a = map.nodes[edge.a];
      const b = map.nodes[edge.b];
      const part = new Graphics(context);
      let length = 0;
      if (a !== undefined && b !== undefined) {
        length = Math.hypot(b.x - a.x, b.y - a.y);
        part.position.set(a.x, a.y);
        part.rotation = Math.atan2(b.y - a.y, b.x - a.x);
        part.scale.x = length;
      }
      parent.addChild(part);
      return { part, length };
    };
    this.casings = map.edges.map((edge) => placed(this.casingLayer, this.casingContext, edge).part);
    this.roads = map.edges.map((edge) => {
      const a = map.nodes[edge.a];
      const b = map.nodes[edge.b];
      // The holder carries the position and rotation; its parts are unit shapes scaled to the road.
      const holder = new Container({ label: `road-${String(edge.id)}` });
      let length = 0;
      if (a !== undefined && b !== undefined) {
        length = Math.hypot(b.x - a.x, b.y - a.y);
        holder.position.set(a.x, a.y);
        holder.rotation = Math.atan2(b.y - a.y, b.x - a.x);
        holder.scale.x = length;
      }
      const body = holder.addChild(new Graphics(this.roadContext));
      this.bodyLayer.addChild(holder);
      return { holder, body, stripes: [], chevrons: null, length, width: 0, kind: 'none' };
    });

    this.setOwners(map.nodes.map((node) => node.start_owner));
    this.setRoads(map.edges.map((edge) => ({ width: edge.base_width, kind: 'none' })));
  }

  /**
   * Put the baked background (maps/<id>.bg.png, 1 px per world unit, origin 0,0) under the map.
   * It replaces the flat terrain colours; without it (no file yet) those stay as the fallback.
   */
  setBackground(texture: Texture): void {
    this.backdrop?.destroy();
    const sprite = new Sprite(texture);
    sprite.position.set(0, 0);
    sprite.width = this.map.meta.width;
    sprite.height = this.map.meta.height;
    this.layers.layer.background.addChildAt(sprite, 0);
    this.backdrop = sprite;
    this.terrainFill.visible = false;
  }

  /** Number of terrain stamps (tests and the performance check). */
  get stampCount(): number {
    return this.stamps.count;
  }

  /** `owners[i]`: current owner of node `i` (`null`: nobody). */
  setOwners(owners: readonly Owner[]): void {
    const g = this.territory;
    g.clear();
    owners.forEach((owner, i) => {
      const cell = this.cells[i];
      if (owner !== null && cell !== undefined) {
        g.poly(cell).fill({ color: ownerColor(this.me, owner), alpha: TERRITORY_ALPHA });
      }
    });
    // The border of an area: a light line of the owner colour, one stroke per owner.
    const borders = territoryBorders(this.cells, owners, TERRITORY_BORDER.inset);
    for (const owner of [0, 1] as const) {
      const own = borders.filter((border) => border.owner === owner);
      for (const { a, b } of own) g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      if (own.length > 0) {
        g.stroke({
          width: TERRITORY_BORDER.width,
          color: ownerColor(this.me, owner),
          alpha: TERRITORY_BORDER.alpha,
          cap: 'round',
        });
      }
    }
  }

  /** `roads[i]`: current level and type of edge `i` (levels 1..3, DEC-22). */
  setRoads(roads: readonly RoadLook[]): void {
    roads.forEach(({ width, kind }, i) => {
      const road = this.roads[i];
      const casing = this.casings[i];
      if (road === undefined || casing === undefined) return;
      const thickness = roadThickness(width);
      casing.scale.y = thickness + ROAD_CASING_EXTRA;
      if (road.width === width && road.kind === kind) return;
      road.width = width;
      road.kind = kind;
      road.body.scale.y = thickness;
      road.body.context = width <= 1 ? this.trailContext(road.length) : this.roadContext;
      // A freight road: `width - 1` dark lanes across the body.
      const lanes = kind === 'freight' ? width - 1 : 0;
      for (let k = 0; k < Math.max(lanes, road.stripes.length); k++) {
        let stripe = road.stripes[k];
        if (stripe === undefined && k < lanes) {
          stripe = road.holder.addChild(new Graphics(this.stripeContext));
          stripe.scale.y = ROAD_STRIPE.width;
          road.stripes[k] = stripe;
        }
        if (stripe !== undefined) {
          stripe.visible = k < lanes;
          stripe.position.y = -thickness / 2 + (thickness * (k + 1)) / width;
        }
      }
      // A fast road: chevrons along it, double on level 3.
      if (kind === 'fast' && width > 1) {
        const context = this.chevronContext(road.length, width >= 3 ? 2 : 1);
        if (road.chevrons === null) road.chevrons = road.holder.addChild(new Graphics(context));
        else road.chevrons.context = context;
        road.chevrons.scale.y = thickness;
        road.chevrons.visible = true;
      } else if (road.chevrons !== null) {
        road.chevrons.visible = false;
      }
    });
  }

  destroy(): void {
    for (const road of this.roads) road.holder.destroy({ children: true });
    for (const casing of this.casings) casing.destroy();
    this.casingLayer.destroy();
    this.bodyLayer.destroy();
    this.territory.destroy();
    this.stamps.destroy();
    this.backdrop?.destroy();
    this.terrainFill.destroy();
    this.dim.destroy();
    this.mapFrame.destroy();
    for (const context of this.shared) context.destroy();
  }

  private context(draw: (g: GraphicsContext) => GraphicsContext): GraphicsContext {
    const context = draw(new GraphicsContext());
    this.shared.push(context);
    return context;
  }

  /**
   * Chevrons of a fast road of `length`, in the unit space of the road (x 0..1 along it, y
   * -0.5..0.5 across, scaled by the thickness): `count` arrowheads per mark.
   */
  private chevronContext(length: number, count: number): GraphicsContext {
    const span = Math.max(1, Math.round(length));
    const key = `${String(span)}:${String(count)}`;
    let context = this.chevronContexts.get(key);
    if (context === undefined) {
      const { spacing, size, gap, depth } = ROAD_CHEVRON;
      context = this.context((g) => {
        const mark = count * size + (count - 1) * gap;
        for (let at = spacing / 2; at + mark < span - spacing / 4; at += spacing) {
          for (let c = 0; c < count; c++) {
            const x0 = (at + c * (size + gap)) / span;
            const x1 = (at + c * (size + gap) + size) / span;
            const notch = (at + c * (size + gap) + size * depth) / span;
            g.poly([x0, -0.4, x1, 0, x0, 0.4, notch, 0]);
          }
        }
        return g.fill(ROAD_CHEVRON.color);
      });
      this.chevronContexts.set(key, context);
    }
    return context;
  }

  /** Dashes of the trail along a road of `length`, in the unit space of the road (0..1). */
  private trailContext(length: number): GraphicsContext {
    const key = Math.max(1, Math.round(length));
    let context = this.trailContexts.get(key);
    if (context === undefined) {
      context = this.context((g) => {
        for (let at = 0; at < key; at += ROAD_TRAIL_DASH + ROAD_TRAIL_GAP) {
          g.rect(at / key, -0.5, Math.min(ROAD_TRAIL_DASH, key - at) / key, 1);
        }
        return g.fill(ROAD_COLOR);
      });
      this.trailContexts.set(key, context);
    }
    return context;
  }

  private drawTerrain(): Graphics {
    const g = new Graphics();
    this.map.nodes.forEach((node, i) => {
      const cell = this.cells[i];
      if (cell !== undefined && cell.length > 0) {
        g.poly(cell).fill(TERRAIN_FILL[node.terrain]).stroke(CELL_BORDER);
      }
    });
    return g;
  }
}
