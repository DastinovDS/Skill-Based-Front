import { describe, expect, it } from 'vitest';
import { BUNDLED_MAPS } from '../map/bundledMaps.ts';
import { MAX_ZOOM, MIN_ZOOM } from './camera.ts';
import {
  CAPTION,
  CAPTION_MIN_PX,
  captionKind,
  captionScale,
  captionTop,
  captionVisible,
} from './nameLayout.ts';
import { PROVINCE } from './style.ts';

describe('captionVisible', () => {
  it('shows a caption from its zoom threshold up, and hides it below', () => {
    for (const kind of ['city', 'province'] as const) {
      const at = CAPTION[kind].minScale;
      expect(captionVisible(kind, at), kind).toBe(true);
      expect(captionVisible(kind, at * 3), kind).toBe(true);
      expect(captionVisible(kind, at * 0.99), kind).toBe(false);
    }
  });

  it('hides the provinces before the cities when the map is zoomed out', () => {
    expect(CAPTION.province.minScale).toBeGreaterThan(CAPTION.city.minScale);
    const between = (CAPTION.city.minScale + CAPTION.province.minScale) / 2;
    expect(captionVisible('city', between)).toBe(true);
    expect(captionVisible('province', between)).toBe(false);
  });

  it('hides everything at the furthest zoom out of a fitted map', () => {
    const fit = Math.min(...[1280 - 64].map((w) => w / 2000));
    expect(captionVisible('city', fit * MIN_ZOOM)).toBe(false);
    expect(captionVisible('city', fit * MAX_ZOOM)).toBe(true);
  });
});

describe('captions', () => {
  it('are never smaller than 12 px on screen, a province smaller and lighter than a city', () => {
    for (const kind of ['city', 'province'] as const) {
      expect(CAPTION[kind].fontSize).toBeGreaterThanOrEqual(CAPTION_MIN_PX);
    }
    expect(CAPTION.province.fontSize).toBeLessThanOrEqual(CAPTION.city.fontSize);
    expect(CAPTION.province.alpha).toBeLessThan(CAPTION.city.alpha);
  });

  it('keep their size on screen: the container scale is the inverse of the camera', () => {
    for (const scale of [0.4, 1, 3.3]) expect(captionScale(scale) * scale).toBeCloseTo(1);
    expect(captionScale(0)).toBe(1);
  });

  it('take a province for a province and the other kinds for cities', () => {
    expect(captionKind('province')).toBe('province');
    for (const kind of ['capital', 'city_large', 'city_medium', 'city_small'] as const) {
      expect(captionKind(kind)).toBe('city');
    }
  });

  it('sit under the signs: under the bar of a city (lower for a bigger one) and the ring of a province', () => {
    expect(captionTop('city', 20)).toBeGreaterThan(captionTop('city', 11));
    expect(captionTop('city', 11)).toBeGreaterThan(11);
    expect(captionTop('province', 0)).toBeGreaterThan(PROVINCE.radius);
  });

  it('every node of the bundled maps has a name to show', () => {
    for (const map of BUNDLED_MAPS) {
      for (const node of map.nodes)
        expect(node.name, `${map.meta.name} ${String(node.id)}`).not.toBe('');
    }
  });
});
