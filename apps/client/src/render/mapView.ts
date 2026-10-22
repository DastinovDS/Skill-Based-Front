import { Container, Graphics, GraphicsContext, Sprite, type Renderer, type Texture } from 'pixi.js';
import type { MapFile, PlayerId } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import type { MapLayers } from './layers.ts';
import { cellEdges, territoryBorders } from './regionLayout.ts';
import {
  BACKDROP_DIM,
  CELL_BORDER,
  CELL_LINE,
  MAP_BORDER,
  ROAD_CASING,
  ROAD_CASING_EXTRA,
  ROAD_CHEVRON,
  ROAD_COLOR,
  TERRAIN_FILL,
  SUPPLY_FLOOR,
  SUPPLY_TERRITORY_ALPHA,
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
  /** The chevrons of an upgraded road; created on first need. */
  chevrons: Graphics | null;
  readonly length: number;
  width: number;
}

/** A road as a snapshot shows it: its level (the wire `width`); roads have no type (DEC-26). */
export interface RoadLook {
  readonly width: number;
}

/**
 * Static part of the map (ui-style.md 9.1-9.3): the terrain background with its dimming and
 * stamps, the territory of the owners with its border line, and the roads. Cities are `CityView`.
 *
 * Owners and roads come from the map start fields now and from snapshots later (CLI-04, #60)
 * through `setOwners` and `setRoads`. A road is always a solid line and reads without colour
 * (DEC-22): the level shows in its thickness and an upgraded road carries chevrons (double ones on
 * level 3): an upgrade only speeds the supply up (DEC-26, item 7). Identical shapes share one GraphicsContext
 * (the unit road rectangle and the chevrons of a given length);
 * `destroy()` releases every object and context created here.
 */
export class MapView {
  private readonly shared: GraphicsContext[] = [];
  private readonly roadContext: GraphicsContext;
  private readonly casingContext: GraphicsContext;
  private readonly chevronContexts = new Map<string, GraphicsContext>();
  readonly cells: Point[][];
  private readonly terrainFill: Graphics;
  private readonly dim: Graphics;
  /**
   * Stamps of the terrain: only for a map without a baked background. The background carries its
   * own details (trees, tufts, stones), so a map with one gets no stamp sprites (#344).
   */
  private stamps: TerrainView | null = null;
  private readonly stampParent: Container;
  private readonly mapFrame: Graphics;
  private backdrop: Sprite | null = null;
  /** The flat floor of the «Supply» mode, hidden on the normal map. */
  private readonly floor: Graphics;
  private supplyMode = false;
  private owners: readonly Owner[] = [];
  private readonly cellLines: Graphics;
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
    private readonly renderer: Renderer,
    /** A baked background is on its way (`setBackground`): the stamps are not created. */
    bakedBackground = false,
  ) {
    const bounds = { width: map.meta.width, height: map.meta.height };
    this.cells = voronoiCells(map.nodes, bounds);

    // A unit rectangle along +x; each road scales it to its length and thickness.
    this.roadContext = this.context((g) => g.rect(0, -0.5, 1, 1).fill(ROAD_COLOR));
    // A dark edge under each road keeps it visible on the snow of the baked background.
    this.casingContext = this.context((g) => g.rect(0, -0.5, 1, 1).fill(ROAD_CASING));

    this.layers = layers;
    const background = layers.layer.background;
    this.stampParent = background;
    this.terrainFill = background.addChild(this.drawTerrain());
    this.dim = background.addChild(
      new Graphics().rect(0, 0, bounds.width, bounds.height).fill(BACKDROP_DIM),
    );
    this.floor = background.addChild(
      new Graphics().rect(0, 0, bounds.width, bounds.height).fill(SUPPLY_FLOOR),
    );
    this.floor.visible = false;
    this.mapFrame = background.addChild(
      new Graphics().rect(0, 0, bounds.width, bounds.height).stroke(MAP_BORDER),
    );
    if (!bakedBackground) this.showStamps();
    // A thin line round every area, also between areas of one owner or nobody: under the tint and
    // the stronger border of the owners, under the roads.
    this.cellLines = layers.layer.territory.addChild(this.drawCellLines());
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
      return { holder, body, chevrons: null, length, width: 0 };
    });

    this.setOwners(map.nodes.map((node) => node.start_owner));
    this.setRoads(map.edges.map((edge) => ({ width: edge.base_width })));
  }

  /**
   * Put the baked background (maps/<id>.bg.webp, 1 px per world unit, origin 0,0) under the map.
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
    if (this.supplyMode) sprite.visible = false;
  }

  /**
   * The fallback of a map whose background did not load: the flat terrain colours get the stamps
   * the baked background would have carried (ui-style.md 9.2). Nothing happens if they are there.
   */
  showStamps(): void {
    if (this.stamps !== null || this.backdrop !== null) return;
    // Between the dimming and the floor, as when they were always there.
    const at = this.stampParent.getChildIndex(this.floor);
    this.stamps = new TerrainView(this.map, this.cells, this.stampParent, this.renderer, at);
    this.stamps.setVisible(!this.supplyMode);
  }

  /**
   * The «Supply» mode (DEC-28, item 8): no terrain (colours, baked background, stamps, dimming), a
   * flat floor instead, and a stronger flat tint of the territory.
   */
  setSupplyMode(on: boolean): void {
    if (on === this.supplyMode) return;
    this.supplyMode = on;
    this.floor.visible = on;
    this.dim.visible = !on;
    this.stamps?.setVisible(!on);
    if (this.backdrop !== null) this.backdrop.visible = !on;
    // Without a baked background the flat terrain colours are the fallback (hidden with the rest).
    if (this.backdrop === null) this.terrainFill.visible = !on;
    this.setOwners(this.owners);
  }

  /** Number of terrain stamps (tests and the performance check). */
  get stampCount(): number {
    return this.stamps?.count ?? 0;
  }

  /** `owners[i]`: current owner of node `i` (`null`: nobody). */
  setOwners(owners: readonly Owner[]): void {
    this.owners = owners;
    const alpha = this.supplyMode ? SUPPLY_TERRITORY_ALPHA : TERRITORY_ALPHA;
    const g = this.territory;
    g.clear();
    owners.forEach((owner, i) => {
      const cell = this.cells[i];
      if (owner !== null && cell !== undefined) {
        g.poly(cell).fill({ color: ownerColor(this.me, owner), alpha });
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

  /** `roads[i]`: current level of edge `i` (levels 1..3, DEC-22). */
  setRoads(roads: readonly RoadLook[]): void {
    roads.forEach(({ width }, i) => {
      const road = this.roads[i];
      const casing = this.casings[i];
      if (road === undefined || casing === undefined) return;
      const thickness = roadThickness(width);
      casing.scale.y = thickness + ROAD_CASING_EXTRA;
      if (road.width === width) return;
      road.width = width;
      road.body.scale.y = thickness;
      // An upgraded road: chevrons along it, double on level 3.
      if (width > 1) {
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
    this.cellLines.destroy();
    this.territory.destroy();
    this.stamps?.destroy();
    this.backdrop?.destroy();
    this.terrainFill.destroy();
    this.dim.destroy();
    this.floor.destroy();
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

  /** Each edge shared by two areas once; the edge on the border of the map is the map frame's. */
  private drawCellLines(): Graphics {
    const g = new Graphics();
    for (const { cell, a, b, neighbour } of cellEdges(this.cells)) {
      if (neighbour !== null && cell < neighbour) g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }
    return g.stroke({ width: CELL_LINE.width, color: CELL_LINE.color, alpha: CELL_LINE.alpha });
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
