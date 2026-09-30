import type { Application } from 'pixi.js';
import type { MapFile } from '../protocol.gen.ts';
import { labelResolution, type Camera } from './camera.ts';
import { CameraController } from './cameraController.ts';
import { createLayers, type MapLayers } from './layers.ts';
import { MapView } from './mapView.ts';

/**
 * One map on the stage: layers, the static map view and the camera. Created per map and
 * destroyed as a whole; the Application outlives it.
 */
export class MapScene {
  readonly layers: MapLayers;
  private readonly view: MapView;
  private readonly controller: CameraController;

  constructor(
    private readonly app: Application,
    map: MapFile,
  ) {
    this.layers = createLayers();
    // Label resolution 1 is a placeholder: the controller reports the first camera right away.
    this.view = new MapView(map, this.layers, 1);
    this.controller = new CameraController(
      app.canvas,
      this.layers.world,
      { width: map.meta.width, height: map.meta.height },
      { width: app.screen.width, height: app.screen.height },
      this.onCamera,
    );
    app.stage.addChild(this.layers.world);
    app.renderer.on('resize', this.onResize);
  }

  /** "Fit map": show the whole map. */
  fit(): void {
    this.controller.fit();
  }

  destroy(): void {
    this.app.renderer.off('resize', this.onResize);
    this.controller.destroy();
    this.view.destroy();
    // Layers are empty now; destroy the containers themselves.
    this.layers.world.destroy({ children: true });
  }

  private readonly onResize = (width: number, height: number): void => {
    this.controller.resize({ width, height });
  };

  private readonly onCamera = (camera: Camera): void => {
    // Also runs on resize, so a new device pixel ratio (window moved to another screen) applies.
    this.view.setLabelResolution(labelResolution(camera.scale, this.app.renderer.resolution));
  };
}
