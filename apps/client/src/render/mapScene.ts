import { Assets, type Application, type Texture } from 'pixi.js';
import type { MapFile, PlayerId } from '../protocol.gen.ts';
import { labelResolution, NO_INSETS, type Camera, type Insets } from './camera.ts';
import { CameraController } from './cameraController.ts';
import { CityView } from './cityView.ts';
import { EffectsView } from './effectsView.ts';
import { EntityView } from './entityView.ts';
import { FogView } from './fogView.ts';
import { createLayers, type MapLayers } from './layers.ts';
import { MapView } from './mapView.ts';
import { EMPTY_OVERLAY, type MapInteraction, type PickHit } from './interaction.ts';
import { OverlayView } from './overlayView.ts';
import { pickAt } from './pick.ts';
import type { RenderSource } from './source.ts';
import type { Point } from './camera.ts';

/** Ticks per second when the source does not say (`rulesets/mvp-0.toml`). */
const DEFAULT_TICK_HZ = 10;

export interface SceneOptions {
  /** Frames and events to draw; without it only the static map is shown. */
  source?: RenderSource | null;
  /** The viewing player: own groups and packets are this player's. Default 0. */
  player?: PlayerId;
  /** URL of the baked background PNG (`maps/<id>.bg.png`); without it flat terrain colours. */
  backgroundUrl?: string | null;
  /** Selection, ghost orders and preview to draw, and where clicks go (CLI-06, #62). */
  interaction?: MapInteraction | null;
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
  private readonly cities: CityView;
  private readonly entities: EntityView;
  private readonly effects: EffectsView;
  private readonly fog: FogView;
  private readonly overlay: OverlayView;
  private interaction: MapInteraction | null;
  private hovering = false;
  private hoveredGroup: string | null = null;
  private readonly controller: CameraController;
  private source: RenderSource | null;
  private base: unknown = null;
  private destroyed = false;
  private readonly onsnapshot: ((tick: number) => void) | undefined;

  constructor(
    private readonly app: Application,
    private readonly map: MapFile,
    insets: Insets = NO_INSETS,
    options: SceneOptions = {},
  ) {
    this.source = options.source ?? null;
    this.interaction = options.interaction ?? null;
    this.onsnapshot = options.onsnapshot;
    this.layers = createLayers();
    const me = options.player ?? 0;
    // Label resolution 1 is a placeholder: the controller reports the first camera right away.
    this.view = new MapView(map, this.layers, me, app.renderer);
    this.cities = new CityView(map, this.layers, me, 1);
    const radiusOf = (node: number): number => this.cities.radiusOf(node);
    this.entities = new EntityView(map, this.layers, me, 1, radiusOf);
    this.effects = new EffectsView(map, this.layers, me, 1, this.view.cells);
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
    this.effects.destroy();
    this.entities.destroy();
    this.overlay.destroy();
    this.cities.destroy();
    this.view.destroy();
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
    } catch (error) {
      // No background is not fatal: the flat terrain colours stay.
      console.warn('map background failed to load', error);
    }
  }

  /** Every frame: owners and road widths from a new snapshot, then the moving entities. */
  private readonly onFrame = (): void => {
    const frame = this.source?.frame();
    if (frame === undefined || frame === null || this.source === null) return;
    const announce = frame.base !== this.base;
    if (announce) {
      this.base = frame.base;
      this.view.setOwners(frame.base.view.nodes.map((node) => node.owner));
      const widths = frame.base.view.edges.map((edge) => edge.width);
      this.view.setRoadWidths(widths);
      this.overlay.setRoadWidths(widths);
      this.cities.update(frame.base);
    }
    const tickHz = this.source.tickHz ?? DEFAULT_TICK_HZ;
    this.entities.setTickHz(tickHz);
    const selection = this.interaction?.overlay().selection ?? null;
    this.entities.setEmphasis(selection?.kind === 'group' ? selection.id : null, this.hoveredGroup);
    this.entities.update(frame);
    this.effects.update(frame, this.source.events(), this.entities.groupPoints(), tickHz);
    this.fog.setTickHz(tickHz);
    this.fog.update(frame.base);
    this.overlay.update(this.interaction?.overlay() ?? EMPTY_OVERLAY, (id) =>
      this.entities.groupPoints().get(id),
    );
    if (announce) this.onsnapshot?.(frame.base.tick);
  };

  /** The hit under a point of the canvas, in CSS px. */
  private hitAt(at: Point): PickHit | null {
    const world = this.layers.world;
    return pickAt(
      this.map,
      {
        x: (at.x - world.position.x) / world.scale.x,
        y: (at.y - world.position.y) / world.scale.y,
      },
      this.entities.groupPoints(),
      world.scale.x,
    );
  }

  private readonly onClick = (at: Point, shift: boolean): void => {
    this.interaction?.click(this.hitAt(at), shift);
  };

  private readonly onHover = (at: Point | null): void => {
    const hit = at === null ? null : this.hitAt(at);
    this.hoveredGroup = hit?.kind === 'group' ? hit.id : null;
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
    this.cities.setLabelResolution(resolution);
    this.overlay.setLabelResolution(resolution);
    this.entities.setLabelResolution(resolution);
    this.effects.setLabelResolution(resolution);
    this.entities.setCameraScale(camera.scale);
    this.fog.setCameraScale(camera.scale);
    this.fog.setLabelResolution(resolution);
  };
}
