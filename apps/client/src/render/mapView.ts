import { Container, Graphics, GraphicsContext, Sprite, type Renderer, type Texture } from 'pixi.js';
import type { MapFile, PlayerId } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import type { MapLayers } from './layers.ts';
import { territoryBorders } from './regionLayout.ts';
import {
  BACKDROP_DIM,
  CELL_BORDER,
  MAP_BORDER,
  ROAD_CASING,
  ROAD_CASING_EXTRA,
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
  readonly length: number;
  width: number;
}

/**
 * Static part of the map (ui-style.md 9.1-9.3): the terrain background with its dimming and
 * stamps, the territory of the owners with its border line, and the roads. Cities are `CityView`.
 *
 * Owners and road widths come from the map start fields now and from snapshots later
 * (CLI-04, #60) through `setOwners` and `setRoadWidths`. Identical shapes share one
 * GraphicsContext (the unit road rectangle, the dashed trail of a given length); `destroy()`
 * releases every object and context created here.
 */
export class MapView {
  private readonly shared: GraphicsContext[] = [];
  private readonly roadContext: GraphicsContext;
  private readonly casingContext: GraphicsContext;
  private readonly stripeContext: GraphicsContext;
  private readonly trailContexts = new Map<number, GraphicsContext>();
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
      return { holder, body, stripes: [], length, width: 0 };
    });

    this.setOwners(map.nodes.map((node) => node.start_owner));
    this.setRoadWidths(map.edges.map((edge) => edge.base_width));
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

  /** `widths[i]`: current width of edge `i` (1..5). */
  setRoadWidths(widths: readonly number[]): void {
    widths.forEach((width, i) => {
      const road = this.roads[i];
      const casing = this.casings[i];
      if (road === undefined || casing === undefined) return;
      const thickness = roadThickness(width);
      casing.scale.y = thickness + ROAD_CASING_EXTRA;
      if (road.width === width) return;
      road.width = width;
      road.body.scale.y = thickness;
      // Width 1 is a dashed trail, wider roads are solid with `width - 1` dark lanes between.
      road.body.context = width <= 1 ? this.trailContext(road.length) : this.roadContext;
      for (let k = 0; k < Math.max(width - 1, road.stripes.length); k++) {
        let stripe = road.stripes[k];
        if (stripe === undefined && k < width - 1) {
          stripe = road.holder.addChild(new Graphics(this.stripeContext));
          stripe.scale.y = ROAD_STRIPE.width;
          road.stripes[k] = stripe;
        }
        if (stripe !== undefined) {
          stripe.visible = k < width - 1;
          stripe.position.y = -thickness / 2 + (thickness * (k + 1)) / width;
        }
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
