import { Assets, type Application, type Renderer, type Texture } from 'pixi.js';
import { SpriteCache } from './bake.ts';
import type { MapFile, PlayerId } from '../protocol.gen.ts';
import { labelResolution, NO_INSETS, type Camera, type Insets } from './camera.ts';
import { CameraController } from './cameraController.ts';
import { CityView } from './cityView.ts';
import { AlertView } from './alertView.ts';
import { EffectsView } from './effectsView.ts';
import { EntityView } from './entityView.ts';
import { FogView } from './fogView.ts';
import { IntentView } from './intentView.ts';
import { createLayers, type MapLayers } from './layers.ts';
import { MapView } from './mapView.ts';
import { EMPTY_OVERLAY, type MapInteraction, type PickHit } from './interaction.ts';
import { OverlayView } from './overlayView.ts';
import { nodePoint } from './layout.ts';
import { pickAt } from './pick.ts';
import type { RenderSource } from './source.ts';
import { SupplyView } from './supplyView.ts';
import type { Anchor } from './anchors.ts';
import type { Point } from './camera.ts';

/** Ticks per second when the source does not say (`rulesets/mvp-0.toml`). */
const DEFAULT_TICK_HZ = 10;

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
   * URL of the baked background (`maps/<id>.bg.webp`); without it flat terrain colours with the
   * terrain stamps (a map with a background has no stamps).
   */
  backgroundUrl?: string | null;
  /** Selection, ghost orders and preview to draw, and where clicks go (CLI-06, #62). */
  interaction?: MapInteraction | null;
  /** Called once when the background has loaded or has failed to (tests wait for it). */
  onbackground?: (state: 'loaded' | 'failed') => void;
  /** Called when a frame built on a new snapshot is drawn for the first time (tick of it). */
  onsnapshot?: (tick: number) => void;
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
  private readonly entities: EntityView;
  private readonly intents: IntentView;
  private readonly effects: EffectsView;
  private readonly fog: FogView;
  private readonly overlay: OverlayView;
  private readonly supply: SupplyView;
  private readonly alerts: AlertView;
  private interaction: MapInteraction | null;
  private hovering = false;
  private readonly controller: CameraController;
  private source: RenderSource | null;
  private base: unknown = null;
  private destroyed = false;
  private supplyOn = false;
  private readonly onsnapshot: ((tick: number) => void) | undefined;
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
    this.layers = createLayers();
    const me = options.player ?? 0;
    // Label resolution 1 is a placeholder: the controller reports the first camera right away.
    const hasBackground = options.backgroundUrl !== undefined && options.backgroundUrl !== null;
    const shapes = options.sprites ?? createSceneSprites(app.renderer);
    this.ownedSprites = options.sprites === undefined ? shapes : null;
    this.sprites = shapes.world;
    this.screenSprites = shapes.screen;
    this.view = new MapView(map, this.layers, me, app.renderer, hasBackground);
    this.cities = new CityView(map, this.layers, me, 1, this.sprites);
    const radiusOf = (node: number): number => this.cities.radiusOf(node);
    this.entities = new EntityView(map, this.layers, me, 1, radiusOf, this.sprites);
    this.intents = new IntentView(map, this.layers, me, this.entities.kit, radiusOf);
    this.effects = new EffectsView(
      map,
      this.layers,
      me,
      1,
      this.view.cells,
      radiusOf,
      this.screenSprites,
    );
    this.fog = new FogView(
      map,
      this.layers,
      me,
      this.entities.kit,
      1,
      this.source?.tickHz ?? DEFAULT_TICK_HZ,
      this.view.cells,
      radiusOf,
    );
    this.overlay = new OverlayView(map, this.layers, me, radiusOf);
    this.supply = new SupplyView(map, this.layers, me, radiusOf);
    this.alerts = new AlertView(map, this.layers, me, radiusOf);
    this.controller = new CameraController(
      app.canvas,
      this.layers.world,
      { width: map.meta.width, height: map.meta.height },
      { width: app.screen.width, height: app.screen.height },
      this.onCamera,
      insets,
    );
    this.controller.setHandlers({ onclick: this.onClick, onhover: this.onHover });
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

  destroy(): void {
    this.destroyed = true;
    this.app.renderer.off('resize', this.onResize);
    this.app.ticker.remove(this.onFrame);
    this.controller.destroy();
    this.fog.destroy();
    this.alerts.destroy();
    this.effects.destroy();
    this.intents.destroy();
    this.entities.destroy();
    this.overlay.destroy();
    this.supply.destroy();
    this.cities.destroy();
    this.view.destroy();
    // Its own caches go with it; the Application's stay for the next scene.
    this.ownedSprites?.world.destroy();
    this.ownedSprites?.screen.destroy();
    if (this.backgroundUrl !== null) {
      void Assets.unload(this.backgroundUrl);
    }
    // Layers are empty now; destroy the containers themselves.
    this.layers.world.destroy({ children: true });
  }

  private backgroundUrl: string | null = null;

  private async loadBackground(url: string): Promise<void> {
    try {
      const texture = await Assets.load<Texture>(url);
      if (this.destroyed) {
        void Assets.unload(url);
        return;
      }
      this.backgroundUrl = url;
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

  /** Every frame: owners and road widths from a new snapshot, then the moving entities. */
  private readonly onFrame = (): void => {
    // Textures dropped a frame ago may go now (see `SpriteCache.endFrame`).
    this.sprites.endFrame();
    this.screenSprites.endFrame();
    const frame = this.source?.frame();
    if (frame === undefined || frame === null || this.source === null) return;
    // Asked once per frame and first: the «Supply» mode swaps the picture before anything draws.
    const overlay = this.interaction?.overlay() ?? EMPTY_OVERLAY;
    this.setSupplyMode(overlay.supply !== null);
    const announce = frame.base !== this.base;
    if (announce) {
      this.base = frame.base;
      this.view.setOwners(frame.base.view.nodes.map((node) => node.owner));
      const edges = frame.base.view.edges;
      this.view.setRoads(edges);
      this.cities.update(
        frame.base,
        this.source.recruitTicks ?? null,
        this.source.cityUpgrades ?? null,
      );
    }
    const tickHz = this.source.tickHz ?? DEFAULT_TICK_HZ;
    this.entities.setTickHz(tickHz);
    this.entities.setBuildTicks(this.source.roadBuildTicks ?? 0);
    this.overlay.setTickHz(tickHz);
    const delays = this.source.orderDelays ?? null;
    this.intents.setDelays(delays);
    this.intents.setTickHz(tickHz);
    this.entities.update(frame);
    this.intents.update(frame, this.entities.groupPoints());
    const punches = this.effects.update(
      frame,
      this.source.events(),
      this.entities.groupPoints(),
      tickHz,
      this.source.roundTicks,
      this.entities,
    );
    this.entities.punch(punches);
    this.fog.setTickHz(tickHz);
    this.fog.update(frame.base);
    this.overlay.update(overlay, (id) => this.entities.groupPoints().get(id));
    this.supply.setTickHz(tickHz);
    this.supply.update(frame, overlay.supply);
    this.alerts.update(frame.base.view.nodes, tickHz, overlay.beacon, performance.now());
    if (announce) this.onsnapshot?.(frame.base.tick);
  };

  /**
   * The «Supply» map mode (DEC-28, item 8): a flat picture of its own. The terrain, the groups, the
   * intents, the fog and the effects are hidden (`SupplyView` draws on the `supply` layer); the
   * territory gets a flat tint and the cities lose the garrison, queue and barracks marks.
   */
  private setSupplyMode(on: boolean): void {
    if (on === this.supplyOn) return;
    this.supplyOn = on;
    this.view.setSupplyMode(on);
    this.cities.setSupplyMode(on);
    this.entities.setSupplyMode(on);
    const { groups, intents, fog, effects } = this.layers.layer;
    for (const layer of [groups, intents, fog, effects]) layer.visible = !on;
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
      },
      world.scale.x,
    );
  }

  private readonly onClick = (at: Point, shift: boolean): void => {
    this.interaction?.click(this.hitAt(at), shift);
  };

  private readonly onHover = (at: Point | null): void => {
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
    this.sprites.setResolution(resolution);
    this.cities.setLabelResolution(resolution);
    this.overlay.setLabelResolution(resolution);
    this.overlay.setCameraScale(camera.scale);
    this.entities.setLabelResolution(resolution);
    this.alerts.setLabelResolution(resolution);
    this.supply.setLabelResolution(resolution);
    // What is drawn at one unit a CSS px (the arenas of fights, the bonus of plans) needs the device pixel ratio only.
    const screen = labelResolution(1, this.app.renderer.resolution);
    this.screenSprites.setResolution(screen);
    this.effects.setScreenResolution(screen);
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
    this.alerts.setCameraScale(camera.scale);
    this.fog.setCameraScale(camera.scale);
    this.fog.setLabelResolution(resolution);
  };
}
