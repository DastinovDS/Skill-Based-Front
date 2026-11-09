import { describe, expect, it } from 'vitest';
import {
  BATTLES,
  BATTLES_END,
  anyLight,
  battleLight,
  battlePlace,
  drawStage,
} from './introBattles.ts';
import { INTRO } from './introScene.ts';
import { ENTRY_MAP as MENU_MAP } from './menuMap.ts';
import { FALLBACK_PALETTE } from './menuMotion.ts';
import { layoutEntry } from './menuScene.ts';

describe('the fights at the edges of the opening scene (#839, the mockup TL.battles)', () => {
  it('lights five fights at staggered moments before the letters, each rising, holding, fading', () => {
    expect(BATTLES).toHaveLength(5);
    const onsets = BATTLES.map((b) => b.at);
    expect([...onsets].sort((a, b) => a - b)).toEqual(onsets);
    expect(Math.max(...onsets)).toBeLessThan(INTRO.title);
    for (const b of BATTLES) {
      expect(battleLight(b, b.at)).toBeNull();
      const full = battleLight(b, b.at + b.rise + b.hold / 2);
      expect(full).toEqual({ r: b.radius, a: 1 });
      const fading = battleLight(b, b.at + b.rise + b.hold + b.fade / 2);
      expect(fading?.a).toBeGreaterThan(0);
      expect(fading?.a).toBeLessThan(1);
      expect(fading?.r).toBeLessThan(b.radius);
      expect(battleLight(b, b.at + b.rise + b.hold + b.fade + 0.01)).toBeNull();
    }
  });

  it('puts every light out before the map dims for the entry screen', () => {
    expect(BATTLES_END).toBeLessThan(INTRO.ambient[0]);
    expect(anyLight(BATTLES_END + 0.01)).toBe(false);
    expect(anyLight(1)).toBe(true);
  });

  it('stands at the edges of the window (the sides or the top), on roads of the menu map', () => {
    const scene = layoutEntry(MENU_MAP, 1280, 800);
    for (const b of BATTLES) {
      const place = battlePlace(scene, b);
      expect(place).not.toBeNull();
      if (place === null) continue;
      const edge = place.x < 1280 * 0.3 || place.x > 1280 * 0.7 || place.y < 800 * 0.2;
      expect(edge).toBe(true);
      expect(place.y).toBeGreaterThan(0);
      expect(place.y).toBeLessThan(800);
    }
  });

  it('draws the dark everywhere, and the pools and fights only while a light is up', () => {
    const calls: string[] = [];
    const recorder = new Proxy(
      {},
      {
        get(_target, name: string) {
          if (name === 'createRadialGradient' || name === 'createLinearGradient') {
            return () => ({ addColorStop: () => undefined });
          }
          return () => {
            calls.push(name);
          };
        },
        set() {
          return true;
        },
      },
    ) as CanvasRenderingContext2D;
    const scene = layoutEntry(MENU_MAP, 1280, 800);
    expect(drawStage(recorder, FALLBACK_PALETTE, scene, 0, '#0b0a08')).toBe(false);
    expect(calls).toContain('fillRect');
    calls.length = 0;
    expect(drawStage(recorder, FALLBACK_PALETTE, scene, 1.8, '#0b0a08')).toBe(true);
    // A pool per light, then the two helmets of each fight.
    expect(calls.filter((c) => c === 'fillRect').length).toBeGreaterThan(2);
    expect(calls).toContain('fill');
  });
});
