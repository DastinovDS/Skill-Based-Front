import type { Container } from 'pixi.js';
import {
  cameraLimits,
  clampCamera,
  fitCamera,
  FIT_PADDING,
  NO_INSETS,
  panBy,
  wheelZoomFactor,
  worldTransform,
  zoomAt,
  type Camera,
  type CameraLimits,
  type Insets,
  type Point,
  type Size,
} from './camera.ts';

/** A press that moves less than this (CSS px) stays a click, for selection (CLI-06, #62). */
const DRAG_THRESHOLD = 4;
const PRIMARY_BUTTON = 0;
const MIDDLE_BUTTON = 1;

interface Press {
  readonly pointerId: number;
  readonly start: Point;
  last: Point;
  dragging: boolean;
}

/**
 * Camera input on the canvas element: drag with the primary or middle button pans, the wheel
 * zooms around the cursor, `fit()` shows the whole map. DOM listeners, not PixiJS events: the
 * camera works in screen space and does not need hit testing.
 *
 * Until the player moves the camera it follows "fit map" on resize; after that a resize keeps
 * the centre and the scale (clamped to the new limits).
 */
export class CameraController {
  private camera: Camera;
  private limits: CameraLimits;
  private fitted = true;
  private insets: Insets = NO_INSETS;
  private press: Press | null = null;

  constructor(
    private readonly element: HTMLElement,
    private readonly world: Container,
    private readonly worldSize: Size,
    private viewport: Size,
    private readonly onchange: (camera: Camera) => void,
    insets: Insets = NO_INSETS,
  ) {
    this.insets = insets;
    this.limits = cameraLimits(worldSize, viewport, FIT_PADDING, insets);
    this.camera = fitCamera(worldSize, viewport, FIT_PADDING, insets);
    element.addEventListener('pointerdown', this.onPointerDown);
    element.addEventListener('pointermove', this.onPointerMove);
    element.addEventListener('pointerup', this.onPointerUp);
    element.addEventListener('pointercancel', this.onPointerUp);
    element.addEventListener('wheel', this.onWheel, { passive: false });
    this.apply();
  }

  get current(): Camera {
    return this.camera;
  }

  fit(): void {
    this.fitted = true;
    this.camera = fitCamera(this.worldSize, this.viewport, FIT_PADDING, this.insets);
    this.apply();
  }

  /** The part of the viewport the HUD covers; "fit map" keeps the map out of it. */
  setInsets(insets: Insets): void {
    this.insets = insets;
    this.limits = cameraLimits(this.worldSize, this.viewport, FIT_PADDING, insets);
    if (this.fitted) {
      this.fit();
    }
  }

  resize(viewport: Size): void {
    this.viewport = viewport;
    this.limits = cameraLimits(this.worldSize, viewport, FIT_PADDING, this.insets);
    this.camera = this.fitted
      ? fitCamera(this.worldSize, viewport, FIT_PADDING, this.insets)
      : clampCamera(this.camera, this.limits);
    this.apply();
  }

  destroy(): void {
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointerup', this.onPointerUp);
    this.element.removeEventListener('pointercancel', this.onPointerUp);
    this.element.removeEventListener('wheel', this.onWheel);
    this.endPress();
  }

  private move(camera: Camera): void {
    this.fitted = false;
    this.camera = camera;
    this.apply();
  }

  private apply(): void {
    const t = worldTransform(this.camera, this.viewport);
    this.world.position.set(t.x, t.y);
    this.world.scale.set(t.scale);
    this.onchange(this.camera);
  }

  private local(event: MouseEvent): Point {
    const rect = this.element.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (
      this.press !== null ||
      (event.button !== PRIMARY_BUTTON && event.button !== MIDDLE_BUTTON)
    ) {
      return;
    }
    if (event.button === MIDDLE_BUTTON) {
      event.preventDefault(); // no autoscroll on Windows
    }
    const at = this.local(event);
    this.press = { pointerId: event.pointerId, start: at, last: at, dragging: false };
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const press = this.press;
    if (press?.pointerId !== event.pointerId) {
      return;
    }
    const at = this.local(event);
    if (!press.dragging) {
      if (Math.hypot(at.x - press.start.x, at.y - press.start.y) < DRAG_THRESHOLD) {
        return;
      }
      press.dragging = true;
      this.element.setPointerCapture(event.pointerId);
      this.element.style.cursor = 'grabbing'; // CSSOM, allowed by the CSP (csp.ts)
    }
    this.move(panBy(this.camera, at.x - press.last.x, at.y - press.last.y, this.limits));
    press.last = at;
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.press?.pointerId === event.pointerId) {
      this.endPress();
    }
  };

  private endPress(): void {
    const press = this.press;
    this.press = null;
    if (press?.dragging === true) {
      if (this.element.hasPointerCapture(press.pointerId)) {
        this.element.releasePointerCapture(press.pointerId);
      }
      this.element.style.cursor = '';
    }
  }

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault(); // the page itself never scrolls or zooms over the map
    const factor = wheelZoomFactor(event.deltaY, event.deltaMode);
    if (factor !== 1) {
      this.move(zoomAt(this.camera, this.viewport, this.local(event), factor, this.limits));
    }
  };
}
