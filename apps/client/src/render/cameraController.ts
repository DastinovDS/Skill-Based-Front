import type { Container } from 'pixi.js';
import { reducedMotion } from './motion.ts';
import { easeOutCubic } from './tween.ts';
import {
  cameraLimits,
  centerOn,
  clampCamera,
  fitScale,
  fitCamera,
  glideCamera,
  smoothShare,
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

/** Time constant of the wheel zoom's smoothing, ms: the scale covers 63% of the way to the goal in this time. */
const ZOOM_TAU_MS = 80;
/** A zoom this close to its goal (as a ratio of scales) is done. */
const ZOOM_DONE = 0.002;
/** How long "fit map" and the jump to an alert glide, ms. */
const GLIDE_MS = 380;

/** A press that moves less than this (CSS px) stays a click, for selection (CLI-06, #62). */
const DRAG_THRESHOLD = 6;
const PRIMARY_BUTTON = 0;
const MIDDLE_BUTTON = 1;
const SECONDARY_BUTTON = 2;
/** The buttons that start a press: the left one clicks, the right and middle ones pan. */
const PRESS_BUTTONS: Readonly<Record<number, true>> = {
  [PRIMARY_BUTTON]: true,
  [MIDDLE_BUTTON]: true,
  [SECONDARY_BUTTON]: true,
};

/** Pointer events that are not camera moves: a click (press without a drag) and hovering. */
export interface PointerHandlers {
  /** A primary click at `at` (CSS px in the canvas); `shift` was held. */
  onclick?: (at: Point, shift: boolean) => void;
  /** The pointer is at `at` with no button pressed; `null`: it left the canvas. */
  onhover?: (at: Point | null) => void;
}

interface Press {
  readonly pointerId: number;
  readonly button: number;
  readonly start: Point;
  last: Point;
  dragging: boolean;
}

/**
 * Camera input on the canvas element: dragging with the RIGHT (or middle) button pans, the wheel
 * zooms around the cursor, `fit()` shows the whole map. The left button only clicks (select and
 * order), it never moves the camera; the context menu of the canvas is suppressed so the right
 * button is free for panning (UI round 2). DOM listeners, not PixiJS events: the camera works in
 * screen space and does not need hit testing.
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
  private handlers: PointerHandlers = {};
  /** The wheel zoom still easing: the scale it is heading for and the screen point it keeps in place (#508). */
  private zoom: { anchor: Point; scale: number } | null = null;
  /** A glide of the camera to another one ("fit map", the jump to an alert). */
  private glide: { from: Camera; to: Camera; elapsed: number } | null = null;

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
    element.addEventListener('pointerleave', this.onPointerLeave);
    element.addEventListener('contextmenu', this.onContextMenu);
    element.addEventListener('wheel', this.onWheel, { passive: false });
    this.apply();
  }

  setHandlers(handlers: PointerHandlers): void {
    this.handlers = handlers;
  }

  get current(): Camera {
    return this.camera;
  }

  /** "Fit map": the camera glides to the whole map. */
  fit(): void {
    this.fitted = true;
    this.goTo(fitCamera(this.worldSize, this.viewport, FIT_PADDING, this.insets));
  }

  /** Fits at once (the first frame, a changed HUD, a resized window): nothing to glide from. */
  private fitNow(): void {
    this.fitted = true;
    this.stopEasing();
    this.camera = fitCamera(this.worldSize, this.viewport, FIT_PADDING, this.insets);
    this.apply();
  }

  /** Eases the camera toward the goal of a wheel zoom or a glide, `dtMs` of real time; once per frame. */
  step(dtMs: number): void {
    if (this.glide !== null) {
      const glide = this.glide;
      glide.elapsed += Math.max(0, dtMs);
      const t = Math.min(1, glide.elapsed / GLIDE_MS);
      this.camera = t >= 1 ? glide.to : glideCamera(glide.from, glide.to, easeOutCubic(t));
      if (t >= 1) this.glide = null;
      this.apply();
      return;
    }
    if (this.zoom === null) return;
    const { anchor, scale: goal } = this.zoom;
    const ratio = goal / this.camera.scale;
    if (Math.abs(ratio - 1) < ZOOM_DONE) {
      this.zoom = null;
      return;
    }
    const step = Math.pow(ratio, smoothShare(dtMs, ZOOM_TAU_MS));
    this.camera = zoomAt(this.camera, this.viewport, anchor, step, this.limits);
    if (Math.abs(goal / this.camera.scale - 1) < ZOOM_DONE) this.zoom = null;
    this.apply();
  }

  /** True while the camera is still moving by itself. */
  get easing(): boolean {
    return this.glide !== null || this.zoom !== null;
  }

  private stopEasing(): void {
    this.zoom = null;
    this.glide = null;
  }

  /** Moves to `camera`: a glide, or at once when it is the same place or the player wants less motion. */
  private goTo(camera: Camera): void {
    this.stopEasing();
    const now = this.camera;
    const same =
      Math.abs(camera.x - now.x) < 0.5 &&
      Math.abs(camera.y - now.y) < 0.5 &&
      Math.abs(camera.scale / now.scale - 1) < ZOOM_DONE;
    if (same || reducedMotion()) {
      this.camera = camera;
      this.apply();
      return;
    }
    this.glide = { from: now, to: camera, elapsed: 0 };
  }

  /** Shows a rectangle of the map (world units) in the free part of the viewport. */
  showRect(rect: { x: number; y: number; width: number; height: number }): void {
    const scale = fitScale(rect, this.viewport, FIT_PADDING, this.insets);
    this.moveNow(
      clampCamera(
        {
          x: rect.x + rect.width / 2 - (this.insets.left - this.insets.right) / (2 * scale),
          y: rect.y + rect.height / 2 - (this.insets.top - this.insets.bottom) / (2 * scale),
          scale,
        },
        this.limits,
      ),
    );
  }

  /** Moves the camera to `point` (world), keeping the scale: the jump to an alert. */
  focus(point: Point): void {
    this.fitted = false;
    this.goTo(centerOn(this.camera, point, this.insets, this.limits));
  }

  /** The part of the viewport the HUD covers; "fit map" keeps the map out of it. */
  setInsets(insets: Insets): void {
    this.insets = insets;
    this.limits = cameraLimits(this.worldSize, this.viewport, FIT_PADDING, insets);
    if (this.fitted) {
      this.fitNow();
    }
  }

  resize(viewport: Size): void {
    this.viewport = viewport;
    this.limits = cameraLimits(this.worldSize, viewport, FIT_PADDING, this.insets);
    this.stopEasing();
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
    this.element.removeEventListener('pointerleave', this.onPointerLeave);
    this.element.removeEventListener('contextmenu', this.onContextMenu);
    this.element.removeEventListener('wheel', this.onWheel);
    this.endPress();
  }

  /** A move the player makes by hand (a drag): it takes over from any glide or zoom. */
  private move(camera: Camera): void {
    this.stopEasing();
    this.moveNow(camera);
  }

  private moveNow(camera: Camera): void {
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
    if (this.press !== null || !(event.button in PRESS_BUTTONS)) {
      return;
    }
    if (event.button === MIDDLE_BUTTON) {
      event.preventDefault(); // no autoscroll on Windows
    }
    const at = this.local(event);
    this.press = {
      pointerId: event.pointerId,
      button: event.button,
      start: at,
      last: at,
      dragging: false,
    };
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const press = this.press;
    if (press === null) {
      this.handlers.onhover?.(this.local(event));
      return;
    }
    if (press.pointerId !== event.pointerId) {
      return;
    }
    const at = this.local(event);
    if (!press.dragging) {
      if (Math.hypot(at.x - press.start.x, at.y - press.start.y) < DRAG_THRESHOLD) {
        return;
      }
      press.dragging = true;
      this.element.setPointerCapture(event.pointerId);
      // Only the right and middle buttons move the camera; a left press that wandered off is no
      // click either (it neither selects nor orders).
      if (press.button !== PRIMARY_BUTTON) {
        this.element.style.cursor = 'grabbing'; // CSSOM, allowed by the CSP (csp.ts)
      }
    }
    if (press.button !== PRIMARY_BUTTON) {
      this.move(panBy(this.camera, at.x - press.last.x, at.y - press.last.y, this.limits));
    }
    press.last = at;
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const press = this.press;
    if (press?.pointerId === event.pointerId) {
      this.endPress();
      // Only a finished primary press that never became a drag is a click.
      if (event.type === 'pointerup' && event.button === PRIMARY_BUTTON && !press.dragging) {
        this.handlers.onclick?.(this.local(event), event.shiftKey);
      }
    }
  };

  /** The right button pans: the browser menu must not open on top of the map. */
  private readonly onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  private readonly onPointerLeave = (): void => {
    this.handlers.onhover?.(null);
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
    if (factor === 1) return;
    if (reducedMotion()) {
      this.move(zoomAt(this.camera, this.viewport, this.local(event), factor, this.limits));
      return;
    }
    // The wheel sets a goal and the camera eases toward it (`step`), around the point under the
    // pointer; a notch while one is under way adds to the goal, so a fast spin still zooms fast.
    const base = this.zoom?.scale ?? this.camera.scale;
    const scale = Math.min(this.limits.maxScale, Math.max(this.limits.minScale, base * factor));
    this.glide = null;
    this.fitted = false;
    this.zoom = { anchor: this.local(event), scale };
  };
}
