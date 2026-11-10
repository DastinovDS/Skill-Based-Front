import {
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
import { reducedMotion } from './motion.ts';
import { levelShare } from './levelLayout.ts';
import { type Border, type CellEdge } from './regionLayout.ts';
import {
  AREA_LINE,
  BORDER_BAND,
  BORDER_ENGRAVING,
  BORDER_LINE_KINDS,
  ENGRAVE,
  HatchTile,
  bandStrips,
  borderLines,
  hairFloor,
  pointsAlong,
  traceRuns,
  withInward,
  type BorderLineKind,
  type BorderLines,
  type Strip,
} from './engraving.ts';
import { VeilView, bandAngle } from './veilView.ts';
import { easeOutCubic } from './tween.ts';
import {
  BORDER_FIT,
  floodLook,
  glowRegions,
  neighboursOf,
  radialReach,
  revealAt,
  roadParts,
  type FloodLook,
  type Owner,
} from './captureLayout.ts';
import { FloodView, premultiplied, type GlowPair } from './floodView.ts';
import {
  laneDashes,
  roadKind,
  roadSegments,
  type RoadSegment,
  type RoadStyle,
} from './roadLayout.ts';
import {
  BACKDROP_DIM,
  BG,
  CANAL_LAND,
  CELL_BORDER,
  HOVER_AREA,
  MAP_BORDER,
  PAPER,
  PATTERN_GROUND,
  ROAD_BUFFER,
  ROAD_FOG,
  ROAD_LANE,
  ROAD_OWN,
  TERRAIN_FILL,
  WATER_FLAT,
  ownerColor,
  sideColours,
  type PlayerColours,
} from './style.ts';
import { patternMarks } from './patternLayout.ts';
import { TerrainView } from './terrainView.ts';
import { territoryOf } from './territory.ts';
import type { GeoFile } from '../map/geography.ts';

/** A capture under way on the map (#819): the area of `node` floods from `from` to `to`. */
export interface Flood {
  readonly node: number;
  readonly from: Owner;
  readonly to: PlayerId | null;
  /** Where the city stands: the flood grows from it. */
  readonly at: Point;
  /** Real time since the flood started, ms; below zero while it waits for the winner's walk (#856). */
  ms: number;
  /** The enemy took the node: the calmer look (no flash, the lights at half). */
  readonly calm: boolean;
  /** "Less motion" when it started: a short cross-fade instead. */
  readonly reduced: boolean;
  look: FloodLook;
}

/** Dashed (buffer) and dotted (fog) lanes are drawn together; the solid ones per stretch. */
const isDashed = (style: RoadStyle): boolean => style === 'buffer' || style === 'fog';

/**
 * One road: up to two stretches (the halves, when exactly one of them is in fog), each a band
 * under the lanes and the lanes themselves. All four are placed along the road by `place`.
 */
interface Road {
  /** One band per stretch: two at most, four while a capture runs out along the road (#819). */
  readonly casings: Graphics[];
  /** The solid lanes of an own road; dashed and dotted lanes are drawn together, see `dashes`. */
  readonly lanes: Graphics[];
  /** A capture runs out along it: its dashes are drawn by `floodDashes`, every frame. */
  flooding: boolean;
  /** The stretches drawn now: what the dashes layer draws of this road. */
  stretches: readonly RoadSegment[];
  readonly a: Point;
  readonly length: number;
  readonly angle: number;
  /** What is drawn now (kind, halves in fog): a new look that gives the same key changes nothing. */
  key: string;
}

/**
 * A road as a snapshot shows it: when the view has them, its halves (`detail` 'fog': dotted).
 * `EdgeView` fits.
 */
export interface RoadLook {
  readonly halves?: readonly { readonly detail: Detail }[];
}

/**
 * Static part of the map (ui-style.md 9.1-9.3): the terrain background with its dimming and
 * stamps, the territory of the owners with its border line, and the roads. Cities are `CityView`.
 *
 * Owners and roads come from the map start fields now and from snapshots later (CLI-04, #60)
 * through `setOwners` and `setRoads`. A road reads without colour (R1 "Lanes", #345): a road
 * between two cities of one owner has a solid lane on a band of the owner's colour, a buffer road
 * a dashed lane without the band, and a half in fog a dotted lane. Redrawn only when an
 * owner or a half in fog changes, not every frame. Identical shapes share one GraphicsContext (a
 * unit rectangle, the lane, the dashes of a given length); `destroy()` releases every
 * object and context created here.
 */
export class MapView {
  private readonly shared: GraphicsContext[] = [];
  private readonly casingContexts = new Map<RoadStyle, GraphicsContext>();
  private readonly laneContexts = new Map<string, GraphicsContext>();
  private readonly looks: (RoadLook | undefined)[] = [];
  /**
   * The area of every node (a polygon each): the Voronoi cells, or with a geography (DEC-36) the
   * areas of the baker's border chains, which are not convex.
   */
  readonly cells: Point[][];
  /** The edges of the areas, with the area or the water across each. */
  private readonly edges: readonly CellEdge[];
  /** The areas are convex Voronoi cells (a map without a usable vector file). */
  private readonly convex: boolean;
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
  private supplyMode = false;
  /** The ground of the terrain mode (patterns), made on first use. */
  private ground: Graphics | null = null;
  private terrainMode = false;
  private owners: readonly Owner[] = [];
  /** The engraved border lines of `owners`, and of the owners before the first capture under way. */
  private lines: BorderLines = { cut: [], rule: [], rule2: [], beads: [] };
  private linesBefore: BorderLines | null = null;
  /** The quadrilaterals of the Border band of `owners` (#842). */
  private strips: readonly Strip[] = [];
  /** The edges of the areas with an inward normal on each: the borders are mitred everywhere. */
  private readonly mitred: readonly CellEdge[];
  /** The hatch of the Border band, in zoom buckets (one tile, turned per owner). */
  private readonly bandTile = new HatchTile(BORDER_BAND.hatch);
  /** The Ruled veil of the fog over the hidden areas (#842). */
  private readonly veil: VeilView;
  /** The camera: css px per world unit and the device pixel ratio. */
  private zoom = 1;
  private resolution = 1;
  /** The thinnest stroke (one device pixel) in world units, rounded up (`hairFloor`). */
  private hairMin = hairFloor(1, 1);
  /** The captures under way (#819), by node, oldest first. */
  private readonly floods = new Map<number, Flood>();
  /** The dev scenes hold every flood at this age (ms) to look at it frame by frame; `null`: real time. */
  private floodHold: number | null = null;
  private readonly floodView: FloodView;
  /** The areas next to each area (the glow of a border lies on both sides of it). */
  private readonly neighbours: number[][];
  /** The glow before the first capture under way and after the last; `null`: none under way. */
  private glowPair: GlowPair | null = null;
  /** Where the floods draw the glow themselves: the map's own glow is masked out there. */
  private readonly glowHole = new Graphics({ label: 'flood-glow-hole' });
  private readonly cellLines: Graphics;
  private readonly territory: Graphics;
  /** The supply view (Canal, #858): the own nodes ahead of the level, crosshatched. */
  private readonly levelFill: Graphics;
  /** The crosshatch of the nodes ahead of the level, in zoom buckets. */
  private readonly aheadTile = new HatchTile(CANAL_LAND.ahead);
  /** The area under the pointer that a click would pick or aim at (#762): one cell, redrawn on a change. */
  private readonly hoverFill: Graphics;
  private hoverCell: number | null = null;
  private level: ReadonlySet<number> = new Set();
  private levelFrom: ReadonlySet<number> | null = null;
  private levelElapsed = 0;
  /** 0: no crosshatch (the normal map), 1: full (the «Supply» mode). */
  private levelStrength = 0;
  private levelSet = false;
  /** The engraved lines of the owners' borders, over the band. */
  private readonly borderLines: Graphics;
  /**
   * The Border band (#829 round 3, topic o; #842): per owner a hatched band inside the land borders,
   * own horizontal, the enemy's at 45 degrees. It replaces the blurred glow of BL1 (#347); the
   * floods of captures still take it as a texture before and after a change (`GlowPair`).
   */
  private readonly glow = new Container({ label: 'territory-band', visible: false });
  /** Holds the band: the floods under way mask it out where they draw it. */
  private readonly glowHolder = new Container({ label: 'territory-band-holder' });
  private readonly bands: Record<0 | 1, Graphics> = {
    0: new Graphics({ label: 'band-0' }),
    1: new Graphics({ label: 'band-1' }),
  };
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
  /** The dashed lanes of the roads a capture runs out along: redrawn every frame of it. */
  private readonly floodDashes: Graphics;
  private dashesDirty = false;
  private readonly layers: MapLayers;

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    private readonly me: PlayerId,
    private readonly renderer: Renderer,
    /** A baked background is on its way (`setBackground`): the stamps are not created. */
    bakedBackground = false,
    /** The vector file of the map (DEC-36), if it has one that fits this version of the map. */
    geo: GeoFile | null = null,
    /** The colours of the players by id (DEC-49); today's look by default. */
    private readonly colours: PlayerColours = sideColours(me),
  ) {
    const bounds = { width: map.meta.width, height: map.meta.height };
    const territory = territoryOf(map, geo);
    this.cells = territory.cells;
    this.edges = territory.edges;
    this.convex = territory.convex;
    this.mitred = withInward(this.cells, this.edges);

    this.layers = layers;
    const background = layers.layer.background;
    this.stampParent = background;
    this.terrainFill = background.addChild(this.drawTerrain());
    this.veil = new VeilView(
      map,
      background,
      background.getChildIndex(this.terrainFill) + 1,
      layers.layer.fog,
      this.cells,
      this.mitred,
      {
        band: (g, cells, alpha) => {
          this.fillBand(g, (strip) => cells.has(strip.cell), alpha);
        },
        lines: (g, cells, alpha) => {
          for (const kind of BORDER_LINE_KINDS) {
            const list = this.lines[kind].filter((border) => cells.has(border.cell));
            this.strokeLines(g, kind, list, alpha);
          }
        },
      },
    );
    this.bandTile.update(this.zoom, this.resolution);
    this.aheadTile.update(this.zoom, this.resolution);
    this.dim = background.addChild(
      new Graphics().rect(0, 0, bounds.width, bounds.height).fill(BACKDROP_DIM),
    );
    this.mapFrame = background.addChild(
      new Graphics().rect(0, 0, bounds.width, bounds.height).stroke(MAP_BORDER),
    );
    if (!bakedBackground) this.showStamps();
    // A thin cut round every area, also between areas of one owner or nobody: under the band and
    // the engraved border of the owners, under the roads.
    this.cellLines = layers.layer.territory.addChild(new Graphics({ label: 'area-lines' }));
    this.drawCellLines();
    this.territory = layers.layer.territory.addChild(new Graphics({ label: 'territory' }));
    // The floods of captures (#819): the fill over the tint, the glow over the map's glow, the rim
    // over the border lines.
    const floodFill = layers.layer.territory.addChild(new Container({ label: 'flood-fill' }));
    this.levelFill = layers.layer.territory.addChild(new Graphics({ label: 'level-fill' }));
    this.hoverFill = layers.layer.territory.addChild(new Graphics({ label: 'hover-area' }));
    this.buildGlow(layers.layer.territory, bounds);
    const floodGlow = layers.layer.territory.addChild(new Container({ label: 'flood-glow' }));
    this.borderLines = layers.layer.territory.addChild(new Graphics({ label: 'border-lines' }));
    const floodRim = layers.layer.territory.addChild(new Container({ label: 'flood-rim' }));
    // A mask is placed by the world like the rest; it is never drawn itself.
    layers.layer.territory.addChild(this.glowHole);
    this.floodView = new FloodView({ fill: floodFill, glow: floodGlow, rim: floodRim }, bounds);
    this.neighbours = neighboursOf(this.edges, map.nodes.length);

    // All casings first, so no casing covers the lanes of a neighbouring road.
    this.casingLayer = layers.layer.roads.addChild(new Container({ label: 'road-casings' }));
    this.laneLayer = layers.layer.roads.addChild(new Container({ label: 'road-lanes' }));
    this.dashes = this.laneLayer.addChild(new Graphics());
    this.roads = map.edges.map((edge) => {
      const a = map.nodes[edge.a];
      const b = map.nodes[edge.b];
      const origin = a === undefined ? { x: 0, y: 0 } : { x: a.x, y: a.y };
      const length = a === undefined || b === undefined ? 0 : Math.hypot(b.x - a.x, b.y - a.y);
      const angle = a === undefined || b === undefined ? 0 : Math.atan2(b.y - a.y, b.x - a.x);
      const road: Road = {
        casings: [],
        lanes: [],
        flooding: false,
        stretches: [],
        a: origin,
        length,
        angle,
        key: '',
      };
      this.addStretchSlot(road);
      this.addStretchSlot(road);
      return road;
    });

    // The dashes of the roads a capture runs out along, over the lanes of every road.
    this.floodDashes = this.laneLayer.addChild(new Graphics({ label: 'flood-dashes' }));
    this.setOwners(map.nodes.map((node) => node.start_owner));
    this.setRoads(map.edges.map(() => ({})));
  }

  /** One more band and lanes for a stretch of `road`, hidden until a stretch is placed on it. */
  private addStretchSlot(road: Road): void {
    const part = (parent: Container): Graphics => {
      const g = parent.addChild(new Graphics(this.hiddenContext));
      g.rotation = road.angle;
      g.visible = false;
      return g;
    };
    road.casings.push(part(this.casingLayer));
    road.lanes.push(part(this.laneLayer));
  }

  /** An empty drawing: what a stretch slot shows before it is placed. */
  private readonly hiddenContext = this.context((g) => g);

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
    if (this.flatGround) sprite.visible = false;
    // The Intaglio picture is already dark stone (#842): no dimming over it.
    this.dim.visible = false;
    this.veil.setPicture(texture);
  }

  /**
   * The areas under the fog (sorted node ids, `veilCities`): the Ruled veil covers them. The same
   * set costs nothing.
   */
  setHidden(hidden: readonly number[]): void {
    this.veil.setHidden(hidden);
  }

  /**
   * The camera (css px per world unit) and the device pixel ratio: the hatches keep their screen
   * pitch in zoom buckets, the hairlines at least one device pixel (#829, round 2).
   */
  setCamera(zoom: number, resolution: number): void {
    if (zoom === this.zoom && resolution === this.resolution) return;
    this.zoom = zoom;
    this.resolution = resolution;
    const floor = hairFloor(zoom, resolution);
    const floorChanged = floor !== this.hairMin;
    this.hairMin = floor;
    if (this.bandTile.update(zoom, resolution)) {
      this.drawGlow(this.owners, true);
      this.veil.bandChanged();
    }
    if (this.aheadTile.update(zoom, resolution) && this.levelSet) {
      this.drawLevel(this.levelShareNow());
    }
    if (floorChanged) {
      this.drawBorderLines();
      this.drawCellLines();
    }
    this.veil.setCamera(zoom, resolution, floorChanged);
  }

  /** A stroke of `width` world units, at least one device pixel wide. */
  private hair(width: number): number {
    return Math.max(width, this.hairMin);
  }

  /**
   * The fallback of a map whose background did not load: the flat terrain colours get the stamps
   * the baked background would have carried (ui-style.md 9.2). Nothing happens if they are there.
   */
  showStamps(): void {
    if (this.stamps !== null || this.backdrop !== null) return;
    // Between the dimming and the frame of the map, as when they were always there.
    const at = this.stampParent.getChildIndex(this.mapFrame);
    this.stamps = new TerrainView(
      this.map,
      this.cells,
      this.stampParent,
      this.renderer,
      at,
      this.convex,
    );
    this.stamps.setVisible(!this.flatGround);
  }

  /**
   * The «Supply» mode (DEC-28, item 8), "Canal" (#858): the map keeps its picture and its band, the own
   * land is darkened and the nodes ahead of the level are crosshatched (`setLevel`).
   */
  setSupplyMode(on: boolean): void {
    if (on === this.supplyMode) return;
    this.supplyMode = on;
    this.setOwners(this.owners);
  }

  /**
   * The terrain mode (#429, "Patterns"): the baked background, the stamps and the dimming give
   * way to a flat colour per area with a pattern per terrain. The territory, borders, roads and
   * the fog stay as they are. Not together with the «Supply» mode (the scene turns one off).
   */
  setTerrainMode(on: boolean): void {
    if (on === this.terrainMode) return;
    this.terrainMode = on;
    if (on && this.ground === null) this.ground = this.drawPatternGround();
    this.applyGround();
  }

  /** The ground is flat (no baked picture): in the terrain mode. */
  private get flatGround(): boolean {
    return this.terrainMode;
  }

  private applyGround(): void {
    const flat = this.flatGround;
    this.dim.visible = !flat && this.backdrop === null;
    this.veil.setGroundVisible(!flat);
    this.stamps?.setVisible(!flat);
    if (this.ground !== null) this.ground.visible = this.terrainMode;
    if (this.backdrop !== null) this.backdrop.visible = !flat;
    // Without a baked background the flat terrain colours are the fallback (hidden with the rest).
    if (this.backdrop === null) this.terrainFill.visible = !flat;
  }

  /** The edges of the areas with the area across each: what the road fortifications lie along (#707). */
  get territoryEdges(): readonly CellEdge[] {
    return this.edges;
  }

  /** The areas come from a vector file (DEC-36), not from Voronoi cells. */
  get geography(): boolean {
    return !this.convex;
  }

  /** Number of terrain stamps (tests and the performance check). */
  get stampCount(): number {
    return this.stamps?.count ?? 0;
  }

  /**
   * The supply view's crosshatch (Canal, #858): `cells` are the own nodes ahead of the leaf level
   * (an empty list or `strength` 0 draws nothing), `strength` is 1 in the «Supply» mode and 0 on the
   * normal map. A new set fades in and out over `CANAL_LAND.fadeMs`; the first one and "less motion"
   * are instant. Called every frame: the same input costs nothing.
   */
  setLevel(cells: readonly number[], strength: number): void {
    const next = new Set(cells);
    const same = next.size === this.level.size && cells.every((cell) => this.level.has(cell));
    if (same && strength === this.levelStrength && this.levelSet) return;
    if (!same) {
      // The old target (or the fade in progress) becomes the start of the new fade.
      const instant = !this.levelSet || reducedMotion() || strength === 0;
      this.levelFrom = instant ? null : this.level;
      this.levelElapsed = 0;
      this.level = next;
    }
    this.levelStrength = strength;
    this.levelSet = true;
    this.drawLevel(this.levelFrom === null ? 1 : 0);
  }

  private levelShareNow(): number {
    return this.levelFrom === null
      ? 1
      : easeOutCubic(Math.min(1, this.levelElapsed / CANAL_LAND.fadeMs));
  }

  private drawLevel(share: number): void {
    const fill = this.levelFill.clear();
    const strength = this.levelStrength;
    if (strength <= 0) return;
    const from = this.levelFrom ?? this.level;
    const to = this.level;
    const color = ownerColor(this.colours, this.me);
    for (const cell of new Set([...from, ...to])) {
      const polygon = this.cells[cell];
      const k = levelShare(cell, from, to, share);
      if (polygon === undefined || k <= 0) continue;
      // Two hatches across each other: the node neither gets nor gives (it is ahead of the level).
      for (const angle of [45, -45]) {
        fill.poly(polygon).fill({
          texture: this.aheadTile.texture,
          textureSpace: 'global',
          matrix: this.aheadTile.matrix(angle),
          color,
          alpha: CANAL_LAND.ahead.alpha * strength * k,
        });
      }
    }
  }

  /**
   * Lights the area of node `cell` lightly (#762): what a click there would pick or aim at; `null`
   * lights nothing. Called every frame: the same cell costs nothing, a new one redraws one polygon.
   */
  setHover(cell: number | null): void {
    if (cell === this.hoverCell) return;
    this.hoverCell = cell;
    const g = this.hoverFill.clear();
    const polygon = cell === null ? undefined : this.cells[cell];
    if (polygon === undefined) return;
    g.poly(polygon).fill({ color: PAPER, alpha: HOVER_AREA.alpha });
    g.poly(polygon).stroke({
      width: HOVER_AREA.rimWidth,
      color: PAPER,
      alpha: HOVER_AREA.rimAlpha,
      join: 'round',
    });
  }

  /** The node whose area is lit as under the pointer (`setHover`); `null`: none. */
  get hovered(): number | null {
    return this.hoverCell;
  }

  /**
   * `owners[i]`: current owner of node `i` (`null`: nobody). With `animate` a node that changed hands
   * floods into the new owner's colour (#819, "Fitted", ui-style 49); the first call, the «Supply»
   * tint and a call without `animate` are instant (and end the floods under way). `delays`: per node,
   * how long (ms) its flood waits, so that it starts as the winner walks into the city (Walk in, #856).
   */
  setOwners(
    owners: readonly Owner[],
    animate = false,
    delays: ReadonlyMap<number, number> = new Map(),
  ): void {
    const previous = this.owners;
    const changed =
      previous.length === owners.length
        ? owners.flatMap((owner, i) => (owner === previous[i] ? [] : [i]))
        : null;
    if (animate && changed !== null && changed.length === 0) return;
    this.owners = owners;
    const flood = animate && !this.supplyMode && changed !== null;
    if (!flood) this.endFloods();
    this.lines = borderLines(this.cells, owners, this.mitred);
    if (flood) this.startFloods(changed, previous, delays);
    else this.drawGlow(owners);
    this.drawTerritory();
    this.drawBorderLines();
    this.veil.ownersChanged();
    if (this.levelSet) this.drawLevel(this.levelShareNow());
    // A road between two cities of one owner looks different from a buffer road.
    this.roads.forEach((_, i) => {
      this.drawRoad(i);
    });
    this.flushDashes();
    this.drawFloodDashes();
  }

  /** The captures under way (the effects light their cities, #819). */
  get captures(): readonly Flood[] {
    return [...this.floods.values()];
  }

  /** Dev scenes: every flood stays `ms` old (`null`: they run on real time again). */
  holdFloods(ms: number | null): void {
    this.floodHold = ms;
  }

  /**
   * Floods start on the nodes `changed` (the owners before them: `previous`). The glow is taken as a
   * texture before (unless floods are under way: theirs stays) and after the change; the map's own
   * glow is redrawn for the new owners and masked out where the floods draw it.
   */
  private startFloods(
    changed: readonly number[],
    previous: readonly Owner[],
    delays: ReadonlyMap<number, number>,
  ): void {
    if (this.floods.size === 0) this.linesBefore = borderLines(this.cells, previous, this.mitred);
    const before = this.glowPair?.before ?? this.glowTexture();
    const reduced = reducedMotion();
    for (const node of changed) {
      const at = this.map.nodes[node];
      const to = this.owners[node] ?? null;
      const calm = to !== this.me;
      this.floods.delete(node);
      this.floods.set(node, {
        node,
        from: previous[node] ?? null,
        to,
        at: at === undefined ? { x: 0, y: 0 } : { x: at.x, y: at.y },
        // A flood that waits for its walker starts below zero: its look stays the old one until then.
        ms: -(delays.get(node) ?? 0),
        calm,
        reduced,
        look: floodLook(-(delays.get(node) ?? 0), calm, reduced),
      });
    }
    this.drawGlow(this.owners);
    const after = before === null ? null : this.glowTexture();
    if (this.glowPair !== null && this.glowPair.after !== after) this.glowPair.after.destroy(true);
    this.glowPair = before !== null && after !== null ? { before, after } : null;
    this.buildFloods();
  }

  /** The meshes of every flood under way, their glow and the hole they make in the map's glow. */
  private buildFloods(): void {
    const nodes = [...this.floods.keys()];
    const regions = glowRegions(nodes, this.neighbours);
    const hole = this.glowHole.clear();
    const alpha = this.territoryAlpha;
    this.floodView.setGlow(this.glowPair);
    nodes.forEach((node, i) => {
      const flood = this.floods.get(node);
      const cell = this.cells[node];
      if (flood === undefined || cell === undefined) return;
      const glowCells = (regions[i] ?? []).flatMap((c) => {
        const polygon = this.cells[c];
        return polygon === undefined ? [] : [polygon];
      });
      const color = flood.to === null ? null : ownerColor(this.colours, flood.to);
      this.floodView.add(node, {
        centre: flood.at,
        cell,
        glowCells: this.glowPair === null ? [] : glowCells,
        reach: radialReach(cell, flood.at),
        from: premultiplied(
          flood.from === null ? null : ownerColor(this.colours, flood.from),
          alpha,
        ),
        to: premultiplied(color, alpha),
        color: color ?? PAPER,
      });
      this.floodView.update(node, flood.look);
      if (this.glowPair !== null)
        for (const polygon of glowCells) hole.poly(polygon).fill(0xffffff);
    });
    if (this.glowPair !== null && nodes.length > 0) {
      this.glowHolder.setMask({ mask: hole, inverse: true });
    } else {
      this.glowHolder.mask = null;
    }
  }

  /** The map's glow as a world-sized texture; `null` without a renderer that can make one (tests). */
  private glowTexture(): Texture | null {
    const renderer = this.renderer as Partial<Renderer>;
    if (typeof renderer.generateTexture !== 'function') return null;
    // The glow itself, not its holder: the hole of the floods under way is not part of it.
    return renderer.generateTexture({
      target: this.glow,
      frame: new Rectangle(0, 0, this.map.meta.width, this.map.meta.height),
      resolution: 1,
      antialias: true,
    });
  }

  /** Every flood ends now: the map is drawn as it is. */
  private endFloods(): void {
    if (this.floods.size === 0) return;
    for (const node of this.floods.keys()) this.floodView.remove(node);
    this.floods.clear();
    this.afterFloods();
  }

  /** The textures and the mask of the glow go when no flood is left. */
  private afterFloods(): void {
    if (this.floods.size > 0) return;
    this.linesBefore = null;
    this.glowHolder.mask = null;
    this.glowHole.clear();
    this.floodView.setGlow(null);
    if (this.glowPair !== null) {
      this.glowPair.before.destroy(true);
      this.glowPair.after.destroy(true);
      this.glowPair = null;
    }
  }

  /** The flat tint of the territory: none (the Border band, #842: the land reads clean). */
  private get territoryAlpha(): number {
    return 0;
  }

  /** The «Supply» mode darkens the own land (Canal, #858); an area under a flood is drawn by its flood. */
  private drawTerritory(): void {
    const g = this.territory;
    g.clear();
    if (!this.supplyMode) return;
    const own = this.owners.flatMap((owner, i) => {
      const cell = this.cells[i];
      return cell === undefined || owner !== this.me || this.floods.has(i) ? [] : [cell];
    });
    if (own.length === 0) return;
    for (const cell of own) g.poly(cell);
    g.fill({ color: CANAL_LAND.shade, alpha: CANAL_LAND.shadeAlpha });
  }

  /**
   * The engraved border of the areas (#842): every line kind of `BORDER_ENGRAVING`. While floods
   * run, a line that a capture adds joins as the front reaches it (just inside the area, or just
   * outside it for a neighbour's line) and a line it removes leaves the same way.
   */
  private drawBorderLines(): void {
    const g = this.borderLines.clear();
    const now = this.lines;
    const before = this.linesBefore ?? now;
    const key = (b: Border): string =>
      `${String(b.owner)}:${String(b.a.x)},${String(b.a.y)}:${String(b.b.x)},${String(b.b.y)}`;
    const share = (b: Border): number => {
      const own = this.floods.get(b.cell);
      if (own !== undefined) return revealAt(own.look, BORDER_FIT.inside);
      const across = b.neighbour === null ? undefined : this.floods.get(b.neighbour);
      return across === undefined ? 1 : revealAt(across.look, BORDER_FIT.outside);
    };
    for (const kind of BORDER_LINE_KINDS) {
      const oldKeys = new Set(before[kind].map(key));
      const nowKeys = new Set(now[kind].map(key));
      const groups = new Map<number, Border[]>();
      const put = (border: Border, fade: number): void => {
        if (fade <= 0) return;
        // Shares are rounded to a few steps of a frame: one stroke each.
        const step = Math.round(fade * 64) / 64;
        const list = groups.get(step);
        if (list === undefined) groups.set(step, [border]);
        else list.push(border);
      };
      for (const border of now[kind]) put(border, oldKeys.has(key(border)) ? 1 : share(border));
      for (const border of before[kind]) {
        if (!nowKeys.has(key(border))) put(border, 1 - share(border));
      }
      for (const [fade, borders] of groups) this.strokeLines(g, kind, borders, fade);
    }
  }

  /**
   * One kind of the engraved border lines into `g` at `alpha`: the cut on the border for every
   * owner, the owner's rule inside it, the second rule on the own side, the beads on the enemy's.
   */
  private strokeLines(
    g: Graphics,
    kind: BorderLineKind,
    borders: readonly Border[],
    alpha: number,
  ): void {
    if (borders.length === 0 || alpha <= 0) return;
    if (kind === 'cut') {
      const { width, alpha: cutAlpha } = BORDER_ENGRAVING.cut;
      traceRuns(g, borders);
      g.stroke({
        width: this.hair(width),
        color: ENGRAVE.cut,
        alpha: cutAlpha * alpha,
        cap: 'round',
        join: 'round',
      });
      return;
    }
    for (const owner of [0, 1] as const) {
      const own = owner === this.me;
      if ((kind === 'rule2' && !own) || (kind === 'beads' && own)) continue;
      const list = borders.filter((border) => border.owner === owner);
      if (list.length === 0) continue;
      const color = ownerColor(this.colours, owner);
      if (kind === 'beads') {
        const { step, radius } = BORDER_ENGRAVING.beads;
        for (const { at } of pointsAlong(list, step)) g.circle(at.x, at.y, radius);
        g.fill({ color, alpha: alpha * BORDER_ENGRAVING.alpha });
        continue;
      }
      const { width } = BORDER_ENGRAVING[kind];
      traceRuns(g, list);
      g.stroke({
        width: this.hair(width),
        color,
        alpha: alpha * BORDER_ENGRAVING.alpha,
        cap: 'round',
        join: 'round',
      });
    }
  }

  /** Runs the floods of captures by `dtMs` of real time; once per frame (a no-op when none is under way). */
  advance(dtMs: number): void {
    this.advanceLevel(dtMs);
    if (this.floods.size === 0) return;
    const done: number[] = [];
    for (const flood of this.floods.values()) {
      flood.ms = this.floodHold ?? flood.ms + Math.max(0, dtMs);
      flood.look = floodLook(flood.ms, flood.calm, flood.reduced);
      if (flood.look.done) done.push(flood.node);
      else this.floodView.update(flood.node, flood.look);
    }
    for (const node of done) {
      this.floods.delete(node);
      this.floodView.remove(node);
    }
    if (done.length > 0) {
      this.afterFloods();
      // The claims of the glow change with the set of floods.
      if (this.floods.size > 0) this.buildFloods();
      this.drawTerritory();
    }
    this.drawBorderLines();
    this.roads.forEach((road, i) => {
      if (road.flooding || this.floodAt(i) !== undefined) this.drawRoad(i);
    });
    this.flushDashes();
    this.drawFloodDashes();
  }

  /** The flood under way at an end of road `i`, if any. */
  private floodAt(i: number): Flood | undefined {
    const edge = this.map.edges[i];
    if (edge === undefined || this.floods.size === 0) return undefined;
    return this.floods.get(edge.a) ?? this.floods.get(edge.b);
  }

  /** The fade of the supply level by `dtMs` of real time (a no-op when none is under way). */
  private advanceLevel(dtMs: number): void {
    if (this.levelFrom === null) return;
    this.levelElapsed += Math.max(0, dtMs);
    const t = Math.min(1, this.levelElapsed / CANAL_LAND.fadeMs);
    if (t >= 1) {
      this.levelFrom = null;
      this.drawLevel(1);
    } else this.drawLevel(easeOutCubic(t));
  }

  private buildGlow(parent: Container, bounds: { width: number; height: number }): void {
    this.glow.addChild(this.bands[0], this.bands[1]);
    this.glow.boundsArea = new Rectangle(0, 0, bounds.width, bounds.height);
    this.glowHolder.addChild(this.glow);
    parent.addChild(this.glowHolder);
  }

  /**
   * The hatched strips of the band that pass `keep` into `g`, per owner (own horizontal, the
   * enemy's at 45 degrees), at `alpha` of the band's own. Whether any was drawn.
   */
  private fillBand(g: Graphics, keep: (strip: Strip) => boolean, alpha: number): boolean {
    let drawn = false;
    for (const owner of [0, 1] as const) {
      const strips = this.strips.filter((strip) => strip.owner === owner && keep(strip));
      if (strips.length === 0) continue;
      for (const strip of strips) g.poly([...strip.points]);
      g.fill({
        texture: this.bandTile.texture,
        textureSpace: 'global',
        matrix: this.bandTile.matrix(bandAngle(this.me, owner)),
        color: ownerColor(this.colours, owner),
        alpha: BORDER_BAND.alpha * alpha,
      });
      drawn = true;
    }
    return drawn;
  }

  /**
   * Redraws the band when the owners changed (or `force`: a new zoom bucket of its hatch); the
   * «Supply» mode has none.
   */
  private drawGlow(owners: readonly Owner[], force = false): void {
    const key = owners.map((owner) => String(owner)).join('');
    if (key === this.glowKey && !force) return;
    if (key !== this.glowKey) {
      this.glowKey = key;
      this.strips = bandStrips(this.cells, owners, this.mitred, BORDER_BAND.depth);
    }
    let drawn = false;
    for (const owner of [0, 1] as const) {
      const g = this.bands[owner].clear();
      drawn = this.fillBand(g, (strip) => strip.owner === owner, 1) || drawn;
    }
    this.glowDrawn = drawn;
    this.glow.visible = this.glowDrawn;
  }

  /**
   * `roads[i]`: the halves of edge `i` in fog. A road whose look did not change is not redrawn.
   */
  setRoads(roads: readonly RoadLook[]): void {
    roads.forEach((look, i) => {
      this.looks[i] = look;
      this.drawRoad(i);
    });
    this.flushDashes();
  }

  /**
   * The look of road `i` from the owners of its ends and its halves in fog. While a
   * capture floods one of its ends, the new look runs out along it from that end (#819).
   */
  private drawRoad(i: number): void {
    const road = this.roads[i];
    const look = this.looks[i];
    const edge = this.map.edges[i];
    if (road === undefined || look === undefined || edge === undefined) return;
    const kind = roadKind(this.owners[edge.a] ?? null, this.owners[edge.b] ?? null);
    // The own territory is never under the veil (DEC-35, the owner's decision of 2026-10-29): the
    // half of an own end is drawn as seen even when its `detail` is `fog`.
    const fog: [boolean, boolean] = [
      look.halves?.[0]?.detail === 'fog' && this.owners[edge.a] !== this.me,
      look.halves?.[1]?.detail === 'fog' && this.owners[edge.b] !== this.me,
    ];
    const flood = this.floodAt(i);
    const split = borderPermille(this.map, i) / 1000;
    const kindKey = (k: ReturnType<typeof roadKind>): string =>
      k.kind === 'buffer' ? 'b' : String(k.owner);
    let segments: RoadSegment[] = roadSegments(kind, fog, split);
    let floodKey = '';
    if (flood !== undefined) {
      const ownerBefore = (end: number): Owner =>
        this.floods.get(end)?.from ?? this.owners[end] ?? null;
      const before = roadKind(ownerBefore(edge.a), ownerBefore(edge.b));
      const cut = flood.look.road;
      segments = roadParts(roadSegments(before, fog, split), segments, cut, edge.a === flood.node);
      floodKey = `|flood:${kindKey(before)}:${cut.toFixed(4)}`;
    }
    const key = `${kindKey(kind)}|${fog[0] ? 'f' : 's'}${fog[1] ? 'f' : 's'}${floodKey}`;
    if (key === road.key) return;
    road.key = key;
    const flooding = flood !== undefined;
    const dashed = (list: readonly RoadSegment[]): boolean => list.some((s) => isDashed(s.style));
    // A road leaving or joining the dashes of the map, or changing them there, redraws them.
    if ((!road.flooding && dashed(road.stretches)) || (!flooding && dashed(segments))) {
      this.dashesDirty = true;
    }
    road.flooding = flooding;
    road.stretches = segments;
    while (road.casings.length < segments.length) this.addStretchSlot(road);
    road.casings.forEach((casing, slot) => {
      const segment = segments[slot];
      const lanes = road.lanes[slot];
      if (lanes === undefined) return;
      casing.visible = segment !== undefined;
      lanes.visible = segment !== undefined && !isDashed(segment.style);
      if (segment !== undefined) this.placeSegment(road, segment, casing, lanes);
    });
  }

  /** The dashed and dotted lanes of `road`'s stretches of `style` into `g`; whether any was drawn. */
  private drawDashes(g: Graphics, road: Road, style: 'buffer' | 'fog'): boolean {
    const spec = style === 'fog' ? ROAD_FOG : ROAD_BUFFER;
    let any = false;
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
        spec.dash,
        spec.gap,
        ROAD_LANE.width,
      );
      for (const quad of quads) {
        g.poly(quad.flatMap((p) => [p.x, p.y]));
        any = true;
      }
    }
    return any;
  }

  /** Redraw the dashed and dotted lanes of all roads, if any of them changed (not the flooding ones). */
  private flushDashes(): void {
    if (!this.dashesDirty) return;
    this.dashesDirty = false;
    this.fillDashes(
      this.dashes,
      this.roads.filter((road) => !road.flooding),
    );
  }

  /** The dashes of the roads a capture runs out along: every frame of it, a few roads. */
  private drawFloodDashes(): void {
    this.fillDashes(
      this.floodDashes,
      this.roads.filter((road) => road.flooding),
    );
  }

  private fillDashes(g: Graphics, roads: readonly Road[]): void {
    g.clear();
    for (const style of ['buffer', 'fog'] as const) {
      const spec = style === 'fog' ? ROAD_FOG : ROAD_BUFFER;
      let any = false;
      for (const road of roads) any = this.drawDashes(g, road, style) || any;
      if (any) g.fill({ color: spec.lane, alpha: spec.laneAlpha });
    }
  }

  /** Put the band and the lanes of one stretch of a road where it belongs. */
  private placeSegment(road: Road, segment: RoadSegment, casing: Graphics, lanes: Graphics): void {
    const length = (segment.to - segment.from) * road.length;
    const start = {
      x: road.a.x + Math.cos(road.angle) * segment.from * road.length,
      y: road.a.y + Math.sin(road.angle) * segment.from * road.length,
    };
    casing.position.set(start.x, start.y);
    lanes.position.set(start.x, start.y);
    // The band: a unit rectangle scaled to the stretch and to the width of the lane plus the casing.
    casing.context = this.casingContext(segment.style);
    casing.scale.set(length, ROAD_LANE.width + this.casingExtra(segment.style));
    if (!isDashed(segment.style)) {
      // The solid lane is drawn once over a unit length.
      lanes.context = this.solidLane();
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
          ? { color: ownerColor(this.colours, 0), alpha: ROAD_OWN.bandAlpha }
          : style === 'own1'
            ? { color: ownerColor(this.colours, 1), alpha: ROAD_OWN.bandAlpha }
            : {
                color: BG,
                alpha: style === 'fog' ? ROAD_FOG.casingAlpha : ROAD_BUFFER.casingAlpha,
              };
      context = this.context((g) => g.rect(0, -0.5, 1, 1).fill(fill));
      this.casingContexts.set(style, context);
    }
    return context;
  }

  /** The solid lane along x from 0 to 1 (scaled to the length of the stretch). */
  private solidLane(): GraphicsContext {
    let context = this.laneContexts.get('solid');
    if (context === undefined) {
      context = this.context((g) =>
        g
          .rect(0, -ROAD_LANE.width / 2, 1, ROAD_LANE.width)
          .fill({ color: ROAD_OWN.lane, alpha: ROAD_OWN.laneAlpha }),
      );
      this.laneContexts.set('solid', context);
    }
    return context;
  }

  destroy(): void {
    // The floods first: their meshes and the textures of the glow.
    this.floods.clear();
    this.floodView.destroy();
    this.afterFloods();
    this.glowHole.destroy();
    // The stretches use shared contexts (a Graphics leaves those alone): the layers first.
    this.casingLayer.destroy({ children: true });
    this.laneLayer.destroy({ children: true });
    this.cellLines.destroy();
    this.territory.destroy();
    this.levelFill.destroy();
    this.hoverFill.destroy();
    this.borderLines.destroy();
    this.glow.destroy({ children: true });
    this.veil.destroy();
    this.bandTile.destroy();
    this.aheadTile.destroy();
    this.stamps?.destroy();
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
   * Each edge shared by two land areas once, a faint cut (#842); the edge on the border of the map
   * is the map frame's. No line where an area ends at water (DEC-36, the owner's decision of
   * 2026-10-29): the water itself is the border.
   */
  private drawCellLines(): void {
    const g = this.cellLines.clear();
    for (const { cell, a, b, neighbour, water } of this.edges) {
      if (neighbour !== null && water !== true && cell < neighbour) {
        g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      }
    }
    g.stroke({ width: this.hair(AREA_LINE.width), color: ENGRAVE.cut, alpha: AREA_LINE.alpha });
  }

  /** A flat colour per area and the marks of its terrain, one Graphics drawn once. */
  private drawPatternGround(): Graphics {
    const g = new Graphics({ label: 'pattern-ground' });
    const { dot, fir, hatch } = PATTERN_GROUND;
    // Under the frame and over the dimming.
    this.stampParent.addChildAt(g, this.stampParent.getChildIndex(this.mapFrame));
    const { width, height } = this.map.meta;
    g.rect(0, 0, width, height).fill(this.convex ? PATTERN_GROUND.floor : PATTERN_GROUND.water);
    this.map.nodes.forEach((node, i) => {
      const cell = this.cells[i];
      if (cell === undefined || cell.length === 0) return;
      // Over the water the land needs the floor under its translucent fill.
      if (!this.convex) g.poly(cell).fill(PATTERN_GROUND.floor);
      g.poly(cell).fill({ color: PATTERN_GROUND.fill[node.terrain], alpha: PATTERN_GROUND.alpha });
      const marks = patternMarks(cell, node.terrain, this.convex);
      for (const at of marks.dots) g.circle(at.x, at.y, dot.radius);
      if (marks.dots.length > 0) g.fill({ color: BG, alpha: dot.alpha });
      for (const at of marks.firs) {
        g.moveTo(at.x - fir.halfWidth, at.y + fir.down)
          .lineTo(at.x, at.y - fir.up)
          .lineTo(at.x + fir.halfWidth, at.y + fir.down);
      }
      if (marks.firs.length > 0) g.stroke({ color: BG, alpha: fir.alpha, width: fir.width });
      for (const [p, q] of marks.hatches) g.moveTo(p.x, p.y).lineTo(q.x, q.y);
      if (marks.hatches.length > 0) g.stroke({ color: BG, alpha: hatch.alpha, width: hatch.width });
    });
    g.visible = this.terrainMode;
    return g;
  }

  /**
   * The flat terrain colours, the fallback of a map whose background did not load. With a geography
   * the water is flat blue under the land and no area gets a dark stroke (the thin line between
   * land areas is `drawCellLines`).
   */
  private drawTerrain(): Graphics {
    const g = new Graphics();
    if (!this.convex) {
      g.rect(0, 0, this.map.meta.width, this.map.meta.height).fill(WATER_FLAT);
    }
    this.map.nodes.forEach((node, i) => {
      const cell = this.cells[i];
      if (cell !== undefined && cell.length > 0) {
        g.poly(cell).fill(TERRAIN_FILL[node.terrain]);
        if (this.convex) g.stroke(CELL_BORDER);
      }
    });
    return g;
  }
}
