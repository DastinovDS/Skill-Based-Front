import { Assets, type Application, type Renderer, type Texture } from 'pixi.js';
import { SpriteCache } from './bake.ts';
import type { MapFile, PlayerId } from '../protocol.gen.ts';
import { labelResolution, NO_INSETS, type Camera, type Insets } from './camera.ts';
import { CameraController } from './cameraController.ts';
import { CityView } from './cityView.ts';
import { AlertView } from './alertView.ts';
import { EffectsView } from './effectsView.ts';
import { hairFloor } from './engraving.ts';
import { FrameGuard } from './frameGuard.ts';
import { EntityView } from './entityView.ts';
import { FogView } from './fogView.ts';
import { veilCities } from './fogLayout.ts';
import { FortView } from './fortView.ts';
import { TollView } from './tollView.ts';
import { IntentView } from './intentView.ts';
import { createLayers, type MapLayers } from './layers.ts';
import { MapView } from './mapView.ts';
import { NameView } from './nameView.ts';
import {
  EMPTY_OVERLAY,
  type MapInteraction,
  type PickHit,
  type WheelInput,
  type WorldRect,
} from './interaction.ts';
import { insideRect } from './groupOrderLayout.ts';
import { GroupOrderView } from './groupOrderView.ts';
import { OverlayView } from './overlayView.ts';
import { UndoView } from './undoView.ts';
import { nodePoint } from './layout.ts';
import { pickAt } from './pick.ts';
import { DEFAULT_ROUND_TICKS, DEFAULT_TICK_HZ } from './renderRules.ts';
import type { RenderSource } from './source.ts';
import { SightView } from './sightView.ts';
import { FlowView } from './flowView.ts';
import { CoachMarkView } from './coachMarkView.ts';
import type { Anchor } from './anchors.ts';
import type { Point } from './camera.ts';
import type { GeoFile } from '../map/geography.ts';
import type { EventMsg } from '../protocol.gen.ts';
import { playerColours, type ColourIds } from './style.ts';
import { captureWalks, floodDelayMs, type Walk } from './walkLayout.ts';

/** Failed frames in a row before the player is told (a transient error is only skipped). */
const FRAME_FAILURE_LIMIT = 3;

/** Frame time assumed when the ticker gives none (60 FPS), ms. */
const DEFAULT_FRAME_MS = 1000 / 60;
/** A snapshot further on than this (seconds) from the last one drawn is a jump: its captures do not flood. */
const FLOOD_MAX_STEP_S = 2;

/**
 * The baked shapes of the map (`bake.ts`): in world units (cities, tokens: re-baked when the zoom
 * changes) and in screen px (the arenas of fights: the device pixel ratio only). They belong to the
 * Application (`GameCanvas`), so a scene that replaces another finds the textures made already.
 */
export interface SceneSprites {
  readonly world: SpriteCache;
  readonly screen: SpriteCache;
}

/** The caches of a renderer; the owner destroys them after the Application. */
export function createSceneSprites(renderer: Renderer): SceneSprites {
  return { world: new SpriteCache(renderer), screen: new SpriteCache(renderer) };
}

export interface SceneOptions {
  /** The baked shapes; without them the scene makes its own and frees them with itself. */
  sprites?: SceneSprites;
  /** Frames and events to draw; without it only the static map is shown. */
  source?: RenderSource | null;
  /** The viewing player: own groups and packets are this player's. Default 0. */
  player?: PlayerId;
  /**
   * The colour ids of the players by player id (DEC-49: `welcome.colours`, a replay header);
   * without them today's look (the viewer Lapis, the opponent Minium).
   */
  colours?: ColourIds | null;
  /**
   * URL of the baked background (`maps/<id>.bg.webp`); without it flat terrain colours with the
   * terrain stamps (a map with a background has no stamps). Loaded through `Assets`, which caches
   * it by URL, so the scene that replaces this one gets the same texture. The scene never unloads
   * it: the unload of `Assets` is async and would destroy the texture a new scene of the same map
   * has just been handed (#617). The caller unloads the URL once no scene shows it (`GameCanvas`).
   */
  backgroundUrl?: string | null;
  /**
   * The vector file of the map (DEC-36, `map/geography.ts`): the areas of the tint, the borders,
   * the veil and a click come from it instead of the Voronoi cells. Without it, or when it does
   * not fit the map, the Voronoi cells.
   */
  geo?: GeoFile | null;
  /** Selection, ghost orders and preview to draw, and where clicks go (CLI-06, #62). */
  interaction?: MapInteraction | null;
  /** Called once when the background has loaded or has failed to (tests wait for it). */
  onbackground?: (state: 'loaded' | 'failed') => void;
  /** Called when a frame built on a new snapshot is drawn for the first time (tick of it). */
  onsnapshot?: (tick: number) => void;
  /** Called once when frames keep failing (`FRAME_FAILURE_LIMIT` in a row): the map is not drawing. */
  onframefailure?: (error: unknown) => void;
}

/**
 * One map on the stage: layers, the static map view and the camera. Created per map and
 * destroyed as a whole; the Application outlives it.
 */
export class MapScene {
  readonly layers: MapLayers;
  private readonly view: MapView;
  /** Baked shapes in world units (cities, tokens): re-baked when the zoom changes. */
  private readonly sprites: SpriteCache;
  /** Baked shapes drawn in screen px (the arenas of fights): the device pixel ratio only. */
  private readonly screenSprites: SpriteCache;
  /** Made by the scene itself (not handed in): freed with it. */
  private readonly ownedSprites: SceneSprites | null;
  private readonly cities: CityView;
  private readonly names: NameView;
  private readonly entities: EntityView;
  private readonly intents: IntentView;
  private readonly effects: EffectsView;
  private readonly fog: FogView;
  private readonly overlay: OverlayView;
  /** The group order and the rally points on the map (DEC-48): the seal, the waits, the muster rings. */
  private readonly groupOrders: GroupOrderView;
  /** The Shift+drag selection box being dragged (world units); `null`: none (DEC-48, item K1). */
  private box: WorldRect | null = null;
  private readonly undo: UndoView;
  private readonly flow: FlowView;
  /** The road fortifications (DEC-43, item D; #707). */
  private readonly forts: FortView;
  /** The toll of the lines (K6): its own layer. */
  private readonly tolls: TollView;
  private readonly sight: SightView;
  private readonly alerts: AlertView;
  /** The goal marks of a tutorial card (#806). */
  private readonly coach: CoachMarkView;
  private interaction: MapInteraction | null;
  private hovering = false;
  /** Where the pointer rests on the canvas, CSS px; `null`: off it. */
  private pointer: Point | null = null;
  private readonly controller: CameraController;
  private source: RenderSource | null;
  private base: unknown = null;
  /** The tick of the snapshot drawn: a capture floods only when the picture runs on from it. */
  private baseTick: number | null = null;
  /** The walks of the captures among the events (Walk in, #856), made again when the events change. */
  private walks: readonly Walk[] = [];
  private walkEvents: readonly EventMsg[] | null = null;
  private walkEventCount = -1;
  private destroyed = false;
  private readonly me: PlayerId;
  private terrainOn = false;
  private readonly onsnapshot: ((tick: number) => void) | undefined;
  /** A frame that throws is skipped, not the end of the loop (CLI-03, #418). */
  private readonly guard: FrameGuard;
  private readonly onbackground: ((state: 'loaded' | 'failed') => void) | undefined;

  constructor(
    private readonly app: Application,
    private readonly map: MapFile,
    insets: Insets = NO_INSETS,
    options: SceneOptions = {},
  ) {
    this.source = options.source ?? null;
    this.interaction = options.interaction ?? null;
    this.onsnapshot = options.onsnapshot;
    this.onbackground = options.onbackground;
    this.guard = new FrameGuard(FRAME_FAILURE_LIMIT, (error) => options.onframefailure?.(error));
    this.layers = createLayers();
    const me = options.player ?? 0;
    this.me = me;
    const colours = playerColours(me, options.colours);
    // Label resolution 1 is a placeholder: the controller reports the first camera right away.
    const hasBackground = options.backgroundUrl !== undefined && options.backgroundUrl !== null;
    const shapes = options.sprites ?? createSceneSprites(app.renderer);
    this.ownedSprites = options.sprites === undefined ? shapes : null;
    this.sprites = shapes.world;
    this.screenSprites = shapes.screen;
    this.view = new MapView(
      map,
      this.layers,
      me,
      app.renderer,
      hasBackground,
      options.geo ?? null,
      colours,
    );
    this.cities = new CityView(map, this.layers, me, 1, this.sprites, colours);
    const radiusOf = (node: number): number => this.cities.radiusOf(node);
    this.names = new NameView(map, this.layers, radiusOf, 1);
    // The barracks' foundation keeps clear of the names, the arenas of fights clear of it (#1005).
    this.cities.setCaptions((node) => this.names.sizeOf(node));
    this.entities = new EntityView(map, this.layers, me, 1, radiusOf, this.sprites, colours);
    this.intents = new IntentView(map, this.layers, me, radiusOf, colours);
    this.intents.setWarehouseSlots((node, index) => this.cities.warehouseSlot(node, index));
    this.forts = new FortView(map, this.layers, me, () => this.view.territoryEdges, colours);
    this.effects = new EffectsView(map, this.layers, me, 1, radiusOf, this.screenSprites, colours);
    this.effects.setPieces(() => this.cities.pieceBoxes());
    this.tolls = new TollView(
      this.layers.layer.tolls,
      map,
      me,
      1,
      (node, edge) => this.forts.lineAt(node, edge),
      colours,
    );
    this.fog = new FogView(
      map,
      this.layers,
      me,
      this.entities.kit,
      1,
      this.source?.rules.tickHz ?? DEFAULT_TICK_HZ,
      radiusOf,
    );
    this.overlay = new OverlayView(map, this.layers, me, radiusOf, colours[me]);
    this.groupOrders = new GroupOrderView(map, this.layers, me, radiusOf, this.sprites, colours);
    this.undo = new UndoView(map, this.layers, radiusOf, colours[me]);
    this.flow = new FlowView(map, this.layers, me, radiusOf, this.sprites);
    this.sight = new SightView(map, this.layers, me, radiusOf);
    this.alerts = new AlertView(map, this.layers, me, radiusOf, colours);
    this.coach = new CoachMarkView(map, this.layers, radiusOf, this.sprites);
    this.controller = new CameraController(
      app.canvas,
      this.layers.world,
      { width: map.meta.width, height: map.meta.height },
      { width: app.screen.width, height: app.screen.height },
      this.onCamera,
      insets,
    );
    this.controller.setHandlers({
      onclick: this.onClick,
      onhover: this.onHover,
      onwheel: this.onWheel,
      onbox: this.onBox,
    });
    app.stage.addChild(this.layers.world);
    app.renderer.on('resize', this.onResize);
    app.ticker.add(this.onFrame);
    if (options.backgroundUrl !== undefined && options.backgroundUrl !== null) {
      void this.loadBackground(options.backgroundUrl);
    }
  }

  setSource(source: RenderSource | null): void {
    this.source = source;
    this.base = null;
    this.baseTick = null;
  }

  setInteraction(interaction: MapInteraction | null): void {
    this.interaction = interaction;
  }

  /** Moves the camera to a city (the jump of `Space` to an alert). */
  focusNode(node: number): void {
    const at = nodePoint(this.map, node);
    if (at !== undefined) this.controller.focus(at);
  }

  /** Where the city `id` is on the page and the radius of its circle there (CSS px). */
  nodeAnchor(id: number): Anchor | null {
    const at = nodePoint(this.map, id);
    return at === undefined ? null : this.anchorAt(at, this.cities.radiusOf(id));
  }

  /** Where the own group `id` is drawn on the page (CSS px); `null`: no such token now. */
  groupAnchor(id: string): Anchor | null {
    const spot = this.entities.groupPoints().get(id);
    return spot === undefined ? null : this.anchorAt(spot, (spot.side * spot.scale) / 2);
  }

  private anchorAt(world: Point, radius: number): Anchor {
    const box = this.app.canvas.getBoundingClientRect();
    const { position, scale } = this.layers.world;
    return {
      x: box.left + position.x + world.x * scale.x,
      y: box.top + position.y + world.y * scale.y,
      r: radius * scale.x,
    };
  }

  /** Shows a rectangle of the map (world units), for a scene that looks at one part of it. */
  showRect(rect: { x: number; y: number; width: number; height: number }): void {
    this.controller.showRect(rect);
  }

  /** "Fit map": show the whole map. */
  fit(): void {
    this.controller.fit();
  }

  /** The part of the screen the HUD covers; while the camera is fitted, the map moves out of it. */
  setInsets(insets: Insets): void {
    this.controller.setInsets(insets);
  }

  /** The walks of the captures (#856), made again only when the list of events changed. */
  private readWalks(events: readonly EventMsg[], tickHz: number): void {
    if (events === this.walkEvents && events.length === this.walkEventCount) return;
    this.walkEvents = events;
    this.walkEventCount = events.length;
    this.walks = captureWalks(
      events,
      this.map,
      this.me,
      this.source?.rules.roundTicks ?? DEFAULT_ROUND_TICKS,
      tickHz,
    );
  }

  /** Per node, how long its flood waits for the walker: the captures that ended in `(from, to]`. */
  private captureDelays(from: number | null, to: number, tickHz: number): Map<number, number> {
    const delays = new Map<number, number>();
    for (const walk of this.walks) {
      if (walk.end > to || (from !== null && walk.end <= from)) continue;
      delays.set(walk.node, floodDelayMs(walk, tickHz));
    }
    return delays;
  }

  destroy(): void {
    this.destroyed = true;
    this.app.renderer.off('resize', this.onResize);
    this.app.ticker.remove(this.onFrame);
    this.controller.destroy();
    this.fog.destroy();
    this.alerts.destroy();
    this.coach.destroy();
    this.effects.destroy();
    this.intents.destroy();
    this.entities.destroy();
    this.overlay.destroy();
    this.groupOrders.destroy();
    this.undo.destroy();
    this.flow.destroy();
    this.forts.destroy();
    this.tolls.destroy();
    this.sight.destroy();
    this.names.destroy();
    this.cities.destroy();
    this.view.destroy();
    // Its own caches go with it; the Application's stay for the next scene.
    this.ownedSprites?.world.destroy();
    this.ownedSprites?.screen.destroy();
    // The background stays loaded: the owner of the URL unloads it (see `SceneOptions.backgroundUrl`).
    // Layers are empty now; destroy the containers themselves.
    this.layers.world.destroy({ children: true });
  }

  private async loadBackground(url: string): Promise<void> {
    try {
      const texture = await Assets.load<Texture>(url);
      if (this.destroyed) return;
      this.view.setBackground(texture);
      this.onbackground?.('loaded');
    } catch (error) {
      // No background is not fatal: the flat terrain colours stay, with the stamps.
      console.warn('map background failed to load', error);
      if (!this.destroyed) {
        this.view.showStamps();
        this.onbackground?.('failed');
      }
    }
  }

  /** The ticker listener: PixiJS stops asking for frames if a listener throws, so it never does. */
  private readonly onFrame = (ticker?: { deltaMS: number }): void => {
    this.frameMs = ticker?.deltaMS ?? DEFAULT_FRAME_MS;
    this.guard.run(this.drawFrame);
  };

  /** Real time the last frame took, ms: what the charge fills ease by (#508). */
  private frameMs = DEFAULT_FRAME_MS;

  /** Every frame: owners and road widths from a new snapshot, then the moving entities. */
  private readonly drawFrame = (): void => {
    // The camera glides first, so everything below is placed for the camera of this frame.
    this.controller.step(this.frameMs);
    // Textures dropped a frame ago may go now (see `SpriteCache.endFrame`).
    this.sprites.endFrame();
    this.screenSprites.endFrame();
    const frame = this.source?.frame();
    if (frame === undefined || frame === null || this.source === null) return;
    const overlay = this.interaction?.overlay() ?? EMPTY_OVERLAY;
    this.setTerrainMode(overlay.terrain);
    // The selected city shows the free slots of its queue; the rings that ask for a look pulse.
    this.cities.setSelected(overlay.selection?.kind === 'node' ? overlay.selection.id : null);
    // The area a click would pick or aim at is lit lightly (#762); not the selected city itself.
    const hovered = overlay.hover?.node ?? null;
    const selectedNode = overlay.selection?.kind === 'node' ? overlay.selection.id : null;
    this.view.setHover(hovered === selectedNode ? null : hovered);
    this.cities.pulse(performance.now());
    this.cities.pulseFull(overlay.cityFull ?? null, performance.now());
    const rules = this.source.rules;
    const tickHzNow = rules.tickHz;
    this.readWalks(this.source.events(), tickHzNow);
    const announce = frame.base !== this.base;
    if (announce) {
      // The first snapshot shows the map as it is; later changes of owners flood (#819), unless the
      // picture jumped (a replay scrubbed back or far ahead, a reconnect): then they are drawn at once.
      const first = this.base === null;
      const step = this.baseTick === null ? 0 : frame.base.tick - this.baseTick;
      // A capture whose winner walks in floods (and flips its city) as the walker crosses the ring.
      const delays = this.captureDelays(this.baseTick, frame.base.tick, tickHzNow);
      const flowing = step > 0 && step <= FLOOD_MAX_STEP_S * rules.tickHz;
      this.base = frame.base;
      this.baseTick = frame.base.tick;
      // A dev scene may show a capture under way (#819): the owners before it come first.
      const before = first ? this.source.floodFrom : undefined;
      if (before !== undefined) this.view.setOwners(before);
      this.view.holdFloods(this.source.floodHoldMs ?? null);
      // A change of owners floods the area of the node into the new owner's colour (#819).
      this.view.setOwners(
        frame.base.view.nodes.map((node) => node.owner),
        (!first && flowing) || before !== undefined,
        delays,
      );
      this.cities.setCaptureDelays(delays);
      // The walls of a captured node fall once its winner has walked in (#858).
      this.forts.setCaptureDelays(delays);
      // The Ruled veil over the areas the snapshot hides (#842).
      this.view.setHidden(veilCities(frame.base.view.nodes));
      this.view.setRoads(frame.base.view.edges);
      this.cities.update(
        frame.base,
        rules.recruitTicks,
        rules.buildings,
        rules.recruitQueueMax,
        rules.provinceWarehouse,
        rules.rallyCost,
      );
      // An own province shows its warehouse (DEC-41, item 13): its caption goes under it.
      const places = rules.provinceWarehouse;
      this.names.refresh(
        new Set(
          places > 0
            ? frame.base.view.nodes
                .filter((n) => n.owner === this.me && this.map.nodes[n.id]?.kind === 'province')
                .map((n) => n.id)
            : [],
        ),
      );
    }
    const tickHz = rules.tickHz;
    this.entities.setTickHz(tickHz);
    this.overlay.setTickHz(tickHz);
    const delays = rules.orderDelays;
    this.intents.setDelays(delays);
    this.intents.setTickHz(tickHz);
    this.entities.setWalks(this.walks);
    this.effects.setWalks(this.walks);
    this.entities.update(frame);
    this.entities.advance(this.frameMs);
    this.view.advance(this.frameMs);
    // A build's time fills its icon by the render tick (#847, #954).
    this.cities.setTick(frame.tick);
    // A charge a build takes flies in from the warehouse or the group standing there (#872).
    const spots = this.entities.groupPoints();
    const standing = frame.base.view.groups;
    this.cities.setPayments(this.source.events(), tickHz, (node) => {
      for (const group of standing) {
        if (group.location.kind !== 'node' || group.location.node !== node) continue;
        const spot = spots.get(group.id);
        if (spot !== undefined) return spot;
      }
      return null;
    });
    // A made unit leaves the barracks' foundation: into the ring, or off to the rally point (#1005).
    this.cities.setRecruits(this.source.events(), tickHz);
    this.cities.advance(this.frameMs);
    this.intents.update(frame, this.entities.groupPoints());
    const punches = this.effects.update(
      frame,
      this.source.events(),
      this.entities.groupPoints(),
      tickHz,
      rules.roundTicks,
      this.entities,
      this.view.captures,
    );
    // The toll of the road fortifications (#707), on both maps; its hits swell the tokens as a fight's do.
    const tollPunches = this.tolls.update(
      this.source.events(),
      frame.tick,
      this.entities.groupPoints(),
      this.entities,
      tickHz,
      Math.max(1, 1 / this.layers.world.scale.x),
    );
    this.entities.punch([...punches, ...tollPunches]);
    this.fog.setTickHz(tickHz);
    this.fog.update(frame.base);
    this.overlay.setBox(this.box ?? overlay.box ?? null);
    this.overlay.update(overlay, (id) => this.entities.groupPoints().get(id));
    this.groupOrders.update(frame, overlay, this.entities.groupPoints(), tickHz);
    this.undo.update(
      overlay.undo ?? [],
      (id) => this.entities.groupPoints().get(id),
      this.pointerOnMap(),
      Math.max(1, 1 / this.layers.world.scale.x),
    );
    // The starving marks of the supply flow (ui-style 42): alerts only.
    this.flow.update(frame.base);
    // The road fortifications; the road pick adds a ghost of the line on every road it reaches.
    this.forts.setBuildTicks(rules.fortBuildTicks);
    this.forts.update(frame.base.view, frame.tick, overlay.fortPick ?? null);
    this.forts.advance(this.frameMs);
    this.sight.update(this.terrainOn, frame.base.view.nodes, this.layers.world.scale.x);
    this.alerts.update(frame.base.view.nodes, tickHz, overlay.beacon, performance.now());
    // A tutorial chapter (#806): the VP badges by its gate, and the goal marks of its card.
    const gate = this.source.gate?.() ?? null;
    this.cities.setVpBadges(gate === null || gate.has('vp'));
    const points = this.entities.groupPoints();
    this.coach.update(
      this.source.coachMarks?.() ?? null,
      (node) => {
        for (const group of frame.base.view.groups) {
          if (group.location.kind !== 'node' || group.location.node !== node) continue;
          return points.get(group.id) ?? null;
        }
        return null;
      },
      performance.now(),
    );
    if (announce) this.onsnapshot?.(frame.base.tick);
  };

  /**
   * The terrain map mode (#429): the ground becomes flat colours with a pattern per terrain and a
   * sight sign stands beside the places you see. Everything else stays drawn.
   */
  private setTerrainMode(on: boolean): void {
    if (on === this.terrainOn) return;
    this.terrainOn = on;
    this.view.setTerrainMode(on);
  }

  /** The hit under a point of the canvas, in CSS px. */
  private hitAt(at: Point): PickHit | null {
    const world = this.layers.world;
    return pickAt(
      this.map,
      {
        x: (at.x - world.position.x) / world.scale.x,
        y: (at.y - world.position.y) / world.scale.y,
      },
      {
        groups: this.entities.roadGroupPoints(),
        icons: this.entities.cityIcons(),
        cells: this.view.cells,
        geo: this.view.geography,
        forts: this.forts.pickTargets(),
      },
      world.scale.x,
    );
  }

  private readonly onClick = (at: Point, shift: boolean): void => {
    this.interaction?.click(this.hitAt(at), shift);
  };

  /**
   * A Shift+drag box (DEC-48, item K1): drawn while it is dragged; on release the groups whose
   * token stands inside it go to the match input, left to right (it keeps the own ones). Only a
   * match input that selects groups (`selectBox`) gets a box at all.
   */
  private readonly onBox = (
    box: { readonly from: Point; readonly to: Point } | null,
    done: boolean,
  ): void => {
    const interaction = this.interaction;
    if (box === null || interaction?.selectBox === undefined) {
      this.box = null;
      return;
    }
    const a = this.toWorld(box.from);
    const b = this.toWorld(box.to);
    const rect: WorldRect = { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
    this.box = done ? null : rect;
    if (!done) return;
    const inside = [...this.entities.groupPoints()]
      .filter(([, spot]) => spot.enemy !== true && insideRect(rect, spot))
      .sort(([, p], [, q]) => p.x - q.x || p.y - q.y)
      .map(([id]) => id);
    interaction.selectBox(inside);
  };

  /** A point of the canvas (CSS px) in world units. */
  private toWorld(at: Point): Point {
    const world = this.layers.world;
    return {
      x: (at.x - world.position.x) / world.scale.x,
      y: (at.y - world.position.y) / world.scale.y,
    };
  }

  /** The wheel goes to the match input first (E + wheel: the plan bonus, #793), else it zooms. */
  private readonly onWheel = (input: WheelInput): boolean =>
    this.interaction?.wheel?.(input) ?? false;

  /** The pointer in world units; off the canvas: the middle of the canvas. */
  private pointerOnMap(): Point {
    const world = this.layers.world;
    const at = this.pointer ?? { x: this.app.screen.width / 2, y: this.app.screen.height / 2 };
    return {
      x: (at.x - world.position.x) / world.scale.x,
      y: (at.y - world.position.y) / world.scale.y,
    };
  }

  private readonly onHover = (at: Point | null): void => {
    this.pointer = at;
    const hit = at === null ? null : this.hitAt(at);
    // The pointer cursor (CSSOM, allowed by the CSP) tells that a click does something here.
    const pointer = hit !== null && this.interaction !== null;
    if (pointer !== this.hovering) {
      this.hovering = pointer;
      this.app.canvas.style.cursor = pointer ? 'pointer' : '';
    }
    this.interaction?.hover(hit);
  };

  private readonly onResize = (width: number, height: number): void => {
    this.controller.resize({ width, height });
  };

  private readonly onCamera = (camera: Camera): void => {
    // Also runs on resize, so a new device pixel ratio (window moved to another screen) applies.
    const resolution = labelResolution(camera.scale, this.app.renderer.resolution);
    // The hatches of the map keep their screen pitch, the hairlines one device pixel at least (#842).
    this.view.setCamera(camera.scale, this.app.renderer.resolution);
    this.sprites.setResolution(resolution);
    this.cities.setLabelResolution(resolution);
    this.overlay.setLabelResolution(resolution);
    this.overlay.setCameraScale(camera.scale);
    this.groupOrders.setLabelResolution(resolution);
    this.groupOrders.setCameraScale(camera.scale);
    // The order arrows, ribbons and cues of #851: hairlines keep one device pixel.
    this.overlay.setDeviceResolution(this.app.renderer.resolution);
    this.intents.setDeviceResolution(this.app.renderer.resolution);
    this.undo.setCamera(camera.scale, this.app.renderer.resolution);
    this.entities.setLabelResolution(resolution);
    this.alerts.setLabelResolution(resolution);
    this.coach.setLabelResolution(resolution);
    this.forts.setLabelResolution(resolution);
    this.forts.setCameraScale(camera.scale);
    this.forts.setDeviceResolution(this.app.renderer.resolution);
    // What is drawn at one unit a CSS px (the arenas of fights, the bonus of plans) needs the device pixel ratio only.
    const screen = labelResolution(1, this.app.renderer.resolution);
    this.names.setCameraScale(camera.scale);
    this.names.setLabelResolution(screen);
    this.screenSprites.setResolution(screen);
    this.effects.setScreenResolution(screen);
    this.tolls.setScreenResolution(screen);
    this.tolls.setHairFloor(hairFloor(camera.scale, this.app.renderer.resolution));
    this.intents.setScreenResolution(screen);
    this.effects.setCameraScale(camera.scale);
    // The canvas in the px of the world times the scale: the arenas of fights keep inside it.
    const { width, height } = this.app.renderer.screen;
    this.effects.setViewport({
      left: camera.x * camera.scale - width / 2,
      right: camera.x * camera.scale + width / 2,
      top: camera.y * camera.scale - height / 2,
      bottom: camera.y * camera.scale + height / 2,
    });
    this.entities.setCameraScale(camera.scale);
    this.intents.setCameraScale(camera.scale);
    this.cities.setCameraScale(camera.scale);
    this.alerts.setCameraScale(camera.scale);
    this.fog.setCameraScale(camera.scale);
    this.fog.setLabelResolution(resolution);
  };
}
