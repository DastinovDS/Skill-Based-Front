import { describe, expect, it } from 'vitest';
import {
  cameraLimits,
  clampCamera,
  fitCamera,
  fitScale,
  labelResolution,
  panBy,
  screenToWorld,
  wheelZoomFactor,
  worldToScreen,
  worldTransform,
  zoomAt,
  type Camera,
  type CameraLimits,
} from './camera.ts';

const WORLD = { width: 1000, height: 500 };
const VIEWPORT = { width: 800, height: 600 };

describe('screen <-> world', () => {
  // Centre (500, 250), 0.8 px per unit: world x 0..1000 -> screen 0..800,
  // world y 0..500 -> screen 100..500.
  const camera: Camera = { x: 500, y: 250, scale: 0.8 };

  it('maps the map corners and centre to the expected screen points', () => {
    expect(worldToScreen(camera, VIEWPORT, { x: 0, y: 0 })).toEqual({ x: 0, y: 100 });
    expect(worldToScreen(camera, VIEWPORT, { x: 1000, y: 500 })).toEqual({ x: 800, y: 500 });
    expect(worldToScreen(camera, VIEWPORT, { x: 500, y: 250 })).toEqual({ x: 400, y: 300 });
  });

  it('maps screen points back to world points', () => {
    expect(screenToWorld(camera, VIEWPORT, { x: 0, y: 100 })).toEqual({ x: 0, y: 0 });
    expect(screenToWorld(camera, VIEWPORT, { x: 400, y: 300 })).toEqual({ x: 500, y: 250 });
  });

  it('round-trips arbitrary points', () => {
    const odd: Camera = { x: 123.5, y: -40, scale: 2.75 };
    for (const p of [
      { x: 0, y: 0 },
      { x: 17, y: 590 },
      { x: 799, y: 3.25 },
    ]) {
      const back = worldToScreen(odd, VIEWPORT, screenToWorld(odd, VIEWPORT, p));
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    }
  });

  it('gives the container transform that puts the world origin on screen', () => {
    expect(worldTransform(camera, VIEWPORT)).toEqual({ x: 0, y: 100, scale: 0.8 });
  });
});

describe('fit map', () => {
  it('fits the tighter side with padding and centres the map', () => {
    // Width is tighter: (800 - 2*50) / 1000 = 0.7 < (600 - 2*50) / 500 = 1.
    expect(fitCamera(WORLD, VIEWPORT, 50)).toEqual({ x: 500, y: 250, scale: 0.7 });
    // Height is tighter for a tall map: (600 - 0) / 1200 = 0.5 < 800 / 400 = 2.
    expect(fitScale({ width: 400, height: 1200 }, VIEWPORT, 0)).toBe(0.5);
  });

  it('keeps a positive scale for a viewport smaller than the padding', () => {
    expect(fitScale(WORLD, { width: 0, height: 0 }, 32)).toBeGreaterThan(0);
  });

  it('derives zoom limits from the fit scale', () => {
    // fit = 0.8 without padding; limits are 0.5x and 6x of it.
    const limits = cameraLimits(WORLD, VIEWPORT, 0);
    expect(limits.minScale).toBeCloseTo(0.4, 12);
    expect(limits.maxScale).toBeCloseTo(4.8, 12);
    expect(limits.world).toEqual(WORLD);
  });
});

const LIMITS: CameraLimits = { world: WORLD, minScale: 0.5, maxScale: 4 };

describe('zoom around the cursor', () => {
  const camera: Camera = { x: 500, y: 250, scale: 1 };

  it('keeps the world point under the cursor in place', () => {
    const cursor = { x: 100, y: 500 };
    const before = screenToWorld(camera, VIEWPORT, cursor);
    const zoomed = zoomAt(camera, VIEWPORT, cursor, 2, LIMITS);
    expect(zoomed.scale).toBe(2);
    const after = worldToScreen(zoomed, VIEWPORT, before);
    expect(after.x).toBeCloseTo(cursor.x, 9);
    expect(after.y).toBeCloseTo(cursor.y, 9);
  });

  it('zooming at the viewport centre only changes the scale', () => {
    expect(zoomAt(camera, VIEWPORT, { x: 400, y: 300 }, 1.5, LIMITS)).toEqual({
      x: 500,
      y: 250,
      scale: 1.5,
    });
  });

  it('stops at the maximum scale and still keeps the cursor point', () => {
    const cursor = { x: 600, y: 200 };
    const before = screenToWorld(camera, VIEWPORT, cursor);
    const zoomed = zoomAt(camera, VIEWPORT, cursor, 100, LIMITS);
    expect(zoomed.scale).toBe(4);
    const after = worldToScreen(zoomed, VIEWPORT, before);
    expect(after.x).toBeCloseTo(cursor.x, 9);
    expect(after.y).toBeCloseTo(cursor.y, 9);
  });

  it('stops at the minimum scale', () => {
    expect(zoomAt(camera, VIEWPORT, { x: 400, y: 300 }, 0.01, LIMITS).scale).toBe(0.5);
  });

  it('keeps the viewport centre inside the map when zooming out at the edge', () => {
    // The centre is on the map's left border, the cursor on the right edge of the viewport
    // (world x = 200). Zooming out to scale 1 with the cursor fixed would put the centre at
    // 200 - 400 / 1 = -200; the clamp puts it back to 0.
    const atEdge: Camera = { x: 0, y: 250, scale: 2 };
    expect(zoomAt(atEdge, VIEWPORT, { x: 800, y: 300 }, 0.5, LIMITS)).toEqual({
      x: 0,
      y: 250,
      scale: 1,
    });
  });
});

describe('pan and clamping', () => {
  it('moves the map with the pointer', () => {
    // Dragging 100 px right at 2 px/unit moves the centre 50 units left.
    const camera: Camera = { x: 500, y: 250, scale: 2 };
    expect(panBy(camera, 100, -40, LIMITS)).toEqual({ x: 450, y: 270, scale: 2 });
  });

  it('keeps the viewport centre inside the map rectangle', () => {
    const camera: Camera = { x: 10, y: 490, scale: 1 };
    expect(panBy(camera, 500, -500, LIMITS)).toEqual({ x: 0, y: 500, scale: 1 });
  });

  it('clamps the scale and the centre together', () => {
    expect(clampCamera({ x: -5, y: 9999, scale: 99 }, LIMITS)).toEqual({
      x: 0,
      y: 500,
      scale: 4,
    });
  });
});

describe('wheel', () => {
  it('zooms in on wheel up and out on wheel down, symmetrically', () => {
    const zoomIn = wheelZoomFactor(-100, 0);
    const zoomOut = wheelZoomFactor(100, 0);
    expect(zoomIn).toBeGreaterThan(1);
    expect(zoomOut).toBeLessThan(1);
    expect(zoomIn * zoomOut).toBeCloseTo(1, 12);
    expect(wheelZoomFactor(0, 0)).toBe(1);
  });

  it('treats line and page deltas as larger than pixel deltas', () => {
    expect(wheelZoomFactor(-3, 1)).toBeGreaterThan(wheelZoomFactor(-3, 0));
    expect(wheelZoomFactor(-1, 2)).toBeGreaterThan(wheelZoomFactor(-1, 1));
  });

  it('bounds the zoom of a single event', () => {
    expect(wheelZoomFactor(-1e6, 0)).toBe(wheelZoomFactor(-1e9, 0));
    expect(wheelZoomFactor(-1e6, 0)).toBeLessThan(2);
  });
});

describe('label resolution', () => {
  it('rounds scale x device pixel ratio up to a power of two, between 1 and 8', () => {
    expect(labelResolution(0.3, 1)).toBe(1);
    expect(labelResolution(1, 1)).toBe(1);
    expect(labelResolution(1.5, 1)).toBe(2);
    expect(labelResolution(1.5, 2)).toBe(4);
    expect(labelResolution(3, 2)).toBe(8);
    expect(labelResolution(40, 2)).toBe(8);
  });
});
