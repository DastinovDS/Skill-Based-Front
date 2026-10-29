/**
 * Camera math: pure functions, no PixiJS and no DOM, so it is unit-tested directly.
 *
 * Units: "world" is the map coordinate space (docs/design/map-format.md, y grows down);
 * "screen" is CSS pixels relative to the top-left corner of the canvas. The renderer runs with
 * `autoDensity`, so the device pixel ratio never shows up here.
 */

import { UNIT_MIN_HIT_PX, UNIT_MIN_SIDE_PX } from './style.ts';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** `x`, `y`: the world point in the centre of the viewport; `scale`: CSS pixels per world unit. */
export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

export interface CameraLimits {
  /** The map rectangle `[0, width] × [0, height]`; the viewport centre stays inside it. */
  readonly world: Size;
  readonly minScale: number;
  readonly maxScale: number;
}

/** Screen margins covered by the HUD, CSS pixels: "fit map" keeps the map out of them. */
export interface Insets {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export const NO_INSETS: Insets = { left: 0, top: 0, right: 0, bottom: 0 };

/** Empty margin around the map in "fit map", CSS pixels. */
export const FIT_PADDING = 32;
/** How far out and in the player can zoom, relative to the "fit map" scale. */
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 6;

export function worldToScreen(camera: Camera, viewport: Size, point: Point): Point {
  return {
    x: (point.x - camera.x) * camera.scale + viewport.width / 2,
    y: (point.y - camera.y) * camera.scale + viewport.height / 2,
  };
}

export function screenToWorld(camera: Camera, viewport: Size, point: Point): Point {
  return {
    x: (point.x - viewport.width / 2) / camera.scale + camera.x,
    y: (point.y - viewport.height / 2) / camera.scale + camera.y,
  };
}

/**
 * Scale at which the whole map fits the free part of the viewport (the viewport minus `insets`)
 * with `padding` on the tighter side.
 */
export function fitScale(
  world: Size,
  viewport: Size,
  padding: number = FIT_PADDING,
  insets: Insets = NO_INSETS,
): number {
  // A viewport smaller than the padding (or not laid out yet) still gets a positive scale.
  const width = Math.max(viewport.width - insets.left - insets.right - 2 * padding, 1);
  const height = Math.max(viewport.height - insets.top - insets.bottom - 2 * padding, 1);
  return Math.min(width / world.width, height / world.height);
}

/**
 * The camera that shows the whole map centred in the free part of the viewport. With insets the
 * camera centre is not the map centre: the viewport centre is shifted away from the HUD.
 */
export function fitCamera(
  world: Size,
  viewport: Size,
  padding: number = FIT_PADDING,
  insets: Insets = NO_INSETS,
): Camera {
  const scale = fitScale(world, viewport, padding, insets);
  return {
    x: world.width / 2 - (insets.left - insets.right) / 2 / scale,
    y: world.height / 2 - (insets.top - insets.bottom) / 2 / scale,
    scale,
  };
}

export function cameraLimits(
  world: Size,
  viewport: Size,
  padding: number = FIT_PADDING,
  insets: Insets = NO_INSETS,
): CameraLimits {
  const fit = fitScale(world, viewport, padding, insets);
  return { world, minScale: fit * MIN_ZOOM, maxScale: fit * MAX_ZOOM };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** Scale into `[minScale, maxScale]`, viewport centre into the map rectangle. */
export function clampCamera(camera: Camera, limits: CameraLimits): Camera {
  return {
    x: clamp(camera.x, 0, limits.world.width),
    y: clamp(camera.y, 0, limits.world.height),
    scale: clamp(camera.scale, limits.minScale, limits.maxScale),
  };
}

/**
 * The camera with `point` in the middle of the part of the viewport the HUD leaves free (the
 * scale stays): the jump of the camera to an alert.
 */
export function centerOn(
  camera: Camera,
  point: Point,
  insets: Insets,
  limits: CameraLimits,
): Camera {
  return clampCamera(
    {
      x: point.x - (insets.left - insets.right) / (2 * camera.scale),
      y: point.y - (insets.top - insets.bottom) / (2 * camera.scale),
      scale: camera.scale,
    },
    limits,
  );
}

/** Drag by a screen delta: the map follows the pointer. */
export function panBy(camera: Camera, dx: number, dy: number, limits: CameraLimits): Camera {
  return clampCamera(
    { x: camera.x - dx / camera.scale, y: camera.y - dy / camera.scale, scale: camera.scale },
    limits,
  );
}

/**
 * Multiply the scale by `factor` keeping the world point under `anchor` (screen) in place.
 * The scale is clamped first and the anchor is kept for the clamped scale; only clamping of the
 * centre (zooming out next to the map edge) can move the anchor.
 */
export function zoomAt(
  camera: Camera,
  viewport: Size,
  anchor: Point,
  factor: number,
  limits: CameraLimits,
): Camera {
  const target = screenToWorld(camera, viewport, anchor);
  const scale = clamp(camera.scale * factor, limits.minScale, limits.maxScale);
  return clampCamera(
    {
      x: target.x - (anchor.x - viewport.width / 2) / scale,
      y: target.y - (anchor.y - viewport.height / 2) / scale,
      scale,
    },
    limits,
  );
}

/**
 * The camera `t` of the way from `from` to `to` (`t` already eased, 0..1): the centre moves in a
 * straight line and the scale geometrically, so a zoom feels even whatever the scales are.
 */
export function glideCamera(from: Camera, to: Camera, t: number): Camera {
  const k = clamp(t, 0, 1);
  return {
    x: from.x + (to.x - from.x) * k,
    y: from.y + (to.y - from.y) * k,
    scale: from.scale * Math.pow(to.scale / from.scale, k),
  };
}

/**
 * The share of the remaining way an exponential smoothing with time constant `tauMs` covers in
 * `dtMs` (frame-rate independent: two steps of 8 ms equal one of 16 ms).
 */
export function smoothShare(dtMs: number, tauMs: number): number {
  return 1 - Math.exp(-Math.max(0, dtMs) / tauMs);
}

/** `WheelEvent.deltaMode` values. */
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const LINE_PX = 16;
const PAGE_PX = 800;
/** Zoom speed: a 100 px wheel notch zooms by e^0.2 ≈ 1.22. */
const ZOOM_PER_PX = 0.002;
/** One event never zooms by more than e^0.5 ≈ 1.65, whatever the device reports. */
const MAX_WHEEL_PX = 250;

/** Scale factor for one wheel event: wheel up (negative `deltaY`) zooms in. */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const unit = deltaMode === DOM_DELTA_LINE ? LINE_PX : deltaMode === DOM_DELTA_PAGE ? PAGE_PX : 1;
  const px = clamp(deltaY * unit, -MAX_WHEEL_PX, MAX_WHEEL_PX);
  return Math.exp(-px * ZOOM_PER_PX);
}

/** Position and uniform scale of the world container for this camera. */
export function worldTransform(camera: Camera, viewport: Size): Camera {
  const origin = worldToScreen(camera, viewport, { x: 0, y: 0 });
  return { x: origin.x, y: origin.y, scale: camera.scale };
}

const MAX_LABEL_RESOLUTION = 8;

/**
 * Resolution for text drawn in world space: texture pixels per text unit. Rounded up to a power
 * of two so that zooming re-renders the labels only a few times, capped to bound texture memory.
 */
export function labelResolution(scale: number, devicePixelRatio: number): number {
  const needed = Math.max(scale * devicePixelRatio, 1);
  return Math.min(2 ** Math.ceil(Math.log2(needed)), MAX_LABEL_RESOLUTION);
}

/** Size of a symbol on screen: `scale` for a triangle of `side` so that it is >= `minPx` wide. */
export function symbolScale(side: number, cameraScale: number, minPx = UNIT_MIN_SIDE_PX): number {
  if (cameraScale <= 0 || side <= 0) return 1;
  return Math.max(1, minPx / (side * cameraScale));
}

/** Half width of the click area of a triangle of `side` (world units): >= 28 px on screen. */
export function hitHalf(side: number, cameraScale: number): number {
  const drawn = side * symbolScale(side, cameraScale);
  return Math.max(drawn, cameraScale > 0 ? UNIT_MIN_HIT_PX / cameraScale : drawn) / 2;
}
