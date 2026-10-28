import {
  BlurFilter,
  Container,
  Graphics,
  GraphicsContext,
  Rectangle,
  Sprite,
  type Renderer,
  type Texture,
} from 'pixi.js';
import type { Detail, MapFile, PlayerId } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import type { MapLayers } from './layers.ts';
import { borderPermille } from './fogLayout.ts';
import { cellEdges, territoryBorders } from './regionLayout.ts';
import {
  laneDashes,
  laneOffsets,
  roadKind,
  roadSegments,
  type RoadSegment,
  type RoadStyle,
} from './roadLayout.ts';
import {
  BACKDROP_DIM,
  BG,
  CELL_BORDER,
  CELL_LINE,
  MAP_BORDER,
  ROAD_BUFFER,
  ROAD_FOG,
  ROAD_LANE,
  ROAD_OWN,
  TERRAIN_FILL,
  TERRITORY_GLOW,
  SUPPLY_FLOOR,
  SUPPLY_TERRITORY_ALPHA,
  TERRITORY_ALPHA,
  TERRITORY_BORDER,
  ownerColor,
  roadLanesWidth,
} from './style.ts';
import { TerrainView } from './terrainView.ts';
import { voronoiCells } from './voronoi.ts';

type Owner = PlayerId | null;

/** Dashed (buffer) and dotted (fog) lanes are drawn together; the solid ones per stretch. */
const isDashed = (style: RoadStyle): boolean => style === 'buffer' || style === 'fog';

/**
 * One road: up to two stretches (the halves, when exactly one of them is in fog), each a band
 * under the lanes and the lanes themselves. All four are placed along the road by `place`.
 */
interface Road {
  readonly casings: readonly [Graphics, Graphics];
  /** The solid lanes of an own road; dashed and dotted lanes are drawn together, see `dashes`. */
  readonly lanes: readonly [Graphics, Graphics];
  /** The stretches drawn now and the level: what the dashes layer draws of this road. */
  stretches: readonly RoadSegment[];
  level: number;
  readonly a: Point;
  readonly length: number;
  readonly angle: number;
  /** What is drawn now (level, kind, halves in fog): a new look that gives the same key changes nothing. */
  key: string;
}

/**
 * A road as a snapshot shows it: its level (the wire `width`, lanes: DEC-22; roads have no type,
 * DEC-26) and, when the view has them, its halves (`detail` 'fog': dotted). `EdgeView` fits.
 */
export interface RoadLook {
  readonly width: number;
  readonly halves?: readonly { readonly detail: Detail }[];
}

/**
 * Static part of the map (ui-style.md 9.1-9.3): the terrain background with its dimming and
 * stamps, the territory of the owners with its border line, and the roads. Cities are `CityView`.
 *
 * Owners and roads come from the map start fields now and from snapshots later (CLI-04, #60)
 * through `setOwners` and `setRoads`. A road reads without colour (R1 "Lanes", #345): its level
 * is the number of parallel lanes (an upgrade only speeds the supply up, DEC-26, item 7), a road
 * between two cities of one owner has solid lanes on a band of the owner's colour, a buffer road
 * dashed lanes without the band, and a half in fog dotted lanes. Redrawn only when the level, an
 * owner or a half in fog changes, not every frame. Identical shapes share one GraphicsContext (a
 * unit rectangle, the lanes of a level, the dashes of a given length); `destroy()` releases every
 * object and context created here.
 */
export class MapView {
  private readonly shared: GraphicsContext[] = [];
  private readonly casingContexts = new Map<RoadStyle, GraphicsContext>();
  private readonly laneContexts = new Map<string, GraphicsContext>();
  private readonly looks: (RoadLook | undefined)[] = [];
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
  /** The line of an owner's border, over its glow. */
  private readonly borderLines: Graphics;
  /**
   * The glow along the borders of the territories (BL1, #347): per owner a blurred wide line on the
   * owner's side of the border, cached as one texture and drawn again only when an owner changes.
   * The blur is a filter INSIDE the cached container, so it runs only when the cache is built.
   */
  private readonly glow = new Container({ label: 'territory-glow', visible: false });
  private readonly glowLines: Record<0 | 1, Graphics> = {
    0: new Graphics({ label: 'glow-lines-0' }),
    1: new Graphics({ label: 'glow-lines-1' }),
  };
  private readonly glowMasks: Record<0 | 1, Graphics> = {
    0: new Graphics({ label: 'glow-mask-0' }),
    1: new Graphics({ label: 'glow-mask-1' }),
  };
  private readonly glowBlurs: BlurFilter[] = [];
  private glowKey = '';
  private glowDrawn = false;
  private readonly roads: Road[];
  private readonly casingLayer: Container;
  private readonly laneLayer: Container;
  /**
   * The dashed lanes of the buffer roads and the dotted lanes of the halves in fog: one Graphics
   * for all of them, redrawn when one of them changes. Per road they would be hundreds of small
   * rectangles each, too many vertices to batch, so every road would cost a draw call of its own.
   */
  private readonly dashes: Graphics;
  private dashesDirty = false;
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
    this.buildGlow(layers.layer.territory, bounds);
    this.borderLines = layers.layer.territory.addChild(new Graphics());

    // All casings first, so no casing covers the lanes of a neighbouring road.
    this.casingLayer = layers.layer.roads.addChild(new Container({ label: 'road-casings' }));
    this.laneLayer = layers.layer.roads.addChild(new Container({ label: 'road-lanes' }));
    this.dashes = this.laneLayer.addChild(new Graphics());
    const hidden = this.context((g) => g);
    this.roads = map.edges.map((edge) => {
      const a = map.nodes[edge.a];
      const b = map.nodes[edge.b];
      const origin = a === undefined ? { x: 0, y: 0 } : { x: a.x, y: a.y };
      const length = a === undefined || b === undefined ? 0 : Math.hypot(b.x - a.x, b.y - a.y);
      const angle = a === undefined || b === undefined ? 0 : Math.atan2(b.y - a.y, b.x - a.x);
      const part = (parent: Container): Graphics => {
        const g = parent.addChild(new Graphics(hidden));
        g.rotation = angle;
        g.visible = false;
        return g;
      };
      return {
        casings: [part(this.casingLayer), part(this.casingLayer)] as const,
        lanes: [part(this.laneLayer), part(this.laneLayer)] as const,
        stretches: [],
        level: 1,
        a: origin,
        length,
        angle,
        key: '',
      };
    });

    this.setOwners(map.nodes.map((node) => node.start_owner));
    // Every road starts at level 1 (DEC-22): the map has no starting level.
    this.setRoads(map.edges.map(() => ({ width: 1 })));
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
    this.glow.visible = !on && this.glowDrawn;
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
    const lines = this.borderLines.clear();
    const borders = territoryBorders(this.cells, owners, TERRITORY_BORDER.inset);
    for (const owner of [0, 1] as const) {
      const own = borders.filter((border) => border.owner === owner);
      for (const { a, b } of own) lines.moveTo(a.x, a.y).lineTo(b.x, b.y);
      if (own.length > 0) {
        lines.stroke({
          width: TERRITORY_BORDER.width,
          color: ownerColor(this.me, owner),
          alpha: TERRITORY_BORDER.alpha,
          cap: 'round',
        });
      }
    }
    this.drawGlow(owners);
    // A road between two cities of one owner looks different from a buffer road.
    this.roads.forEach((_, i) => {
      this.drawRoad(i);
    });
    this.flushDashes();
  }

  private buildGlow(parent: Container, bounds: { width: number; height: number }): void {
    for (const owner of [0, 1] as const) {
      const blur = new BlurFilter({
        strength: TERRITORY_GLOW.blur,
        quality: TERRITORY_GLOW.blurQuality,
        resolution: TERRITORY_GLOW.resolution,
        // Not cut to the canvas: the filter runs inside the world-sized cache texture (#441).
        clipToViewport: false,
      });
      this.glowBlurs.push(blur);
      // Opaque strokes, the alpha on the blurred whole: where two lines meet nothing doubles.
      const blurred = new Container({
        label: `glow-blur-${String(owner)}`,
        alpha: TERRITORY_GLOW.alpha,
      });
      blurred.filters = [blur];
      blurred.addChild(this.glowLines[owner]);
      // The glow stays on the owner's side of the border: the cells of the owner clip it.
      const clip = new Container({ label: `glow-clip-${String(owner)}` });
      clip.addChild(blurred, this.glowMasks[owner]);
      clip.mask = this.glowMasks[owner];
      this.glow.addChild(clip);
    }
    this.glow.boundsArea = new Rectangle(0, 0, bounds.width, bounds.height);
    this.glow.cacheAsTexture({ resolution: TERRITORY_GLOW.resolution, antialias: true });
    parent.addChild(this.glow);
  }

  /** Redraws the glow (and its cache) when the owners changed; the tint of the «Supply» mode has none. */
  private drawGlow(owners: readonly Owner[]): void {
    const key = owners.map((owner) => String(owner)).join('');
    if (key === this.glowKey) return;
    this.glowKey = key;
    const borders = territoryBorders(this.cells, owners, 0);
    let drawn = 0;
    for (const owner of [0, 1] as const) {
      const lines = this.glowLines[owner].clear();
      const mask = this.glowMasks[owner].clear();
      const own = borders.filter((border) => border.owner === owner);
      for (const { a, b } of own) lines.moveTo(a.x, a.y).lineTo(b.x, b.y);
      if (own.length > 0) {
        lines.stroke({
          width: TERRITORY_GLOW.width,
          color: ownerColor(this.me, owner),
          cap: 'round',
        });
        drawn += own.length;
        owners.forEach((o, i) => {
          const cell = this.cells[i];
          if (o === owner && cell !== undefined) mask.poly(cell);
        });
        mask.fill(0xffffff);
      }
    }
    this.glowDrawn = drawn > 0;
    this.glow.visible = this.glowDrawn && !this.supplyMode;
    if (drawn > 0) this.glow.updateCacheTexture();
  }

  /**
   * `roads[i]`: the current level of edge `i` (1..3, DEC-22) and its halves in fog. A road whose
   * look did not change is not redrawn.
   */
  setRoads(roads: readonly RoadLook[]): void {
    roads.forEach((look, i) => {
      this.looks[i] = look;
      this.drawRoad(i);
    });
    this.flushDashes();
  }

  /** The look of road `i` from its level, the owners of its ends and its halves in fog. */
  private drawRoad(i: number): void {
    const road = this.roads[i];
    const look = this.looks[i];
    const edge = this.map.edges[i];
    if (road === undefined || look === undefined || edge === undefined) return;
    const level = Math.min(3, Math.max(1, Math.round(look.width)));
    const kind = roadKind(this.owners[edge.a] ?? null, this.owners[edge.b] ?? null);
    const fog: [boolean, boolean] = [
      look.halves?.[0]?.detail === 'fog',
      look.halves?.[1]?.detail === 'fog',
    ];
    const key = `${String(level)}|${kind.kind === 'buffer' ? 'b' : String(kind.owner)}|${fog[0] ? 'f' : 's'}${fog[1] ? 'f' : 's'}`;
    if (key === road.key) return;
    road.key = key;
    const segments = roadSegments(kind, fog, borderPermille(this.map, i) / 1000);
    if ([...road.stretches, ...segments].some((s) => isDashed(s.style))) this.dashesDirty = true;
    road.stretches = segments;
    road.level = level;
    for (const slot of [0, 1] as const) {
      const segment = segments[slot];
      const casing = road.casings[slot];
      const lanes = road.lanes[slot];
      casing.visible = segment !== undefined;
      lanes.visible = segment !== undefined && !isDashed(segment.style);
      if (segment !== undefined) this.placeSegment(road, segment, level, casing, lanes);
    }
  }

  /** Redraw the dashed and dotted lanes of all roads, if any of them changed. */
  private flushDashes(): void {
    if (!this.dashesDirty) return;
    this.dashesDirty = false;
    const g = this.dashes.clear();
    for (const style of ['buffer', 'fog'] as const) {
      const spec = style === 'fog' ? ROAD_FOG : ROAD_BUFFER;
      let any = false;
      for (const road of this.roads) {
        for (const stretch of road.stretches) {
          if (stretch.style !== style) continue;
          const along = stretch.from * road.length;
          const origin = {
            x: road.a.x + Math.cos(road.angle) * along,
            y: road.a.y + Math.sin(road.angle) * along,
          };
          const quads = laneDashes(
            origin,
            road.angle,
            (stretch.to - stretch.from) * road.length,
            road.level,
            spec.dash,
            spec.gap,
            ROAD_LANE.width,
          );
          for (const quad of quads) {
            g.poly(quad.flatMap((p) => [p.x, p.y]));
            any = true;
          }
        }
      }
      if (any) g.fill({ color: spec.lane, alpha: spec.laneAlpha });
    }
  }

  /** Put the band and the lanes of one stretch of a road where it belongs. */
  private placeSegment(
    road: Road,
    segment: RoadSegment,
    level: number,
    casing: Graphics,
    lanes: Graphics,
  ): void {
    const length = (segment.to - segment.from) * road.length;
    const start = {
      x: road.a.x + Math.cos(road.angle) * segment.from * road.length,
      y: road.a.y + Math.sin(road.angle) * segment.from * road.length,
    };
    casing.position.set(start.x, start.y);
    lanes.position.set(start.x, start.y);
    // The band: a unit rectangle scaled to the stretch and to the width of the lanes plus the casing.
    casing.context = this.casingContext(segment.style);
    casing.scale.set(length, roadLanesWidth(level) + this.casingExtra(segment.style));
    if (!isDashed(segment.style)) {
      // Solid lanes of a level are drawn once over a unit length.
      lanes.context = this.solidLanes(level);
      lanes.scale.set(length, 1);
    }
  }

  private casingExtra(style: RoadStyle): number {
    return style === 'fog'
      ? ROAD_FOG.casing
      : style === 'buffer'
        ? ROAD_BUFFER.casing
        : ROAD_OWN.casing;
  }

  /** The band under the lanes: owner's colour on an own road, dark on a buffer road and in fog. */
  private casingContext(style: RoadStyle): GraphicsContext {
    let context = this.casingContexts.get(style);
    if (context === undefined) {
      const fill =
        style === 'own0'
          ? { color: ownerColor(this.me, 0), alpha: ROAD_OWN.bandAlpha }
          : style === 'own1'
            ? { color: ownerColor(this.me, 1), alpha: ROAD_OWN.bandAlpha }
            : {
                color: BG,
                alpha: style === 'fog' ? ROAD_FOG.casingAlpha : ROAD_BUFFER.casingAlpha,
              };
      context = this.context((g) => g.rect(0, -0.5, 1, 1).fill(fill));
      this.casingContexts.set(style, context);
    }
    return context;
  }

  /** The solid lanes of `level` along x from 0 to 1 (scaled to the length of the stretch). */
  private solidLanes(level: number): GraphicsContext {
    const key = `solid:${String(level)}`;
    let context = this.laneContexts.get(key);
    if (context === undefined) {
      context = this.context((g) => {
        for (const offset of laneOffsets(level)) {
          g.rect(0, offset - ROAD_LANE.width / 2, 1, ROAD_LANE.width);
        }
        return g.fill({ color: ROAD_OWN.lane, alpha: ROAD_OWN.laneAlpha });
      });
      this.laneContexts.set(key, context);
    }
    return context;
  }

  destroy(): void {
    // The stretches use shared contexts (a Graphics leaves those alone): the layers first.
    this.casingLayer.destroy({ children: true });
    this.laneLayer.destroy({ children: true });
    this.cellLines.destroy();
    this.territory.destroy();
    this.borderLines.destroy();
    this.glow.destroy({ children: true });
    for (const blur of this.glowBlurs) blur.destroy();
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
