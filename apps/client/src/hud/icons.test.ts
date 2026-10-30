import { describe, expect, it } from 'vitest';
import { ICONS, MENU_ICONS, RASTER_ICONS, rasterOf, shapesOf, type IconShape } from './icons.ts';

/** The drawn icons of the radial menus (set I1, #350): group, stance, supply, and the list of the groups of a city. */
const NAMES = [
  'split',
  'defense',
  'cancel',
  'merge',
  'stanceEconomy',
  'stanceBalance',
  'stanceWar',
  'transfer',
  'front1',
  'front2',
  'stackGroup',
] as const;

const signature = (shapes: readonly IconShape[]): string => JSON.stringify(shapes);

describe('the icons of the radial menus (I1)', () => {
  it('are the 10 of the mockup and the group of the city list, each with shapes', () => {
    expect(Object.keys(MENU_ICONS).sort()).toEqual([...NAMES].sort());
    for (const name of NAMES) expect(MENU_ICONS[name].length).toBeGreaterThan(0);
  });

  it('differ from each other and from the Lucide icons of the HUD', () => {
    const seen = new Set<string>();
    for (const shapes of [...Object.values(MENU_ICONS), ...Object.values(ICONS)]) {
      const key = signature(shapes);
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('stay on the 24 x 24 grid with room for the 2 px stroke', () => {
    for (const name of NAMES) {
      for (const shape of MENU_ICONS[name]) {
        if (shape.tag === 'rect') {
          expect(shape.x).toBeGreaterThanOrEqual(1);
          expect(shape.y).toBeGreaterThanOrEqual(1);
          expect(shape.x + shape.width).toBeLessThanOrEqual(23);
          expect(shape.y + shape.height).toBeLessThanOrEqual(23);
        } else if (shape.tag === 'circle') {
          expect(shape.cx - shape.r).toBeGreaterThanOrEqual(1);
          expect(shape.cx + shape.r).toBeLessThanOrEqual(23);
          expect(shape.cy - shape.r).toBeGreaterThanOrEqual(1);
          expect(shape.cy + shape.r).toBeLessThanOrEqual(23);
        }
      }
    }
  });

  it('tell the two markers apart by their digit', () => {
    const digits = (name: 'front1' | 'front2'): string[] =>
      MENU_ICONS[name].flatMap((shape) => (shape.tag === 'text' ? [shape.content] : []));
    expect(digits('front1')).toEqual(['1']);
    expect(digits('front2')).toEqual(['2']);
  });

  it('are found by name together with the Lucide ones', () => {
    expect(shapesOf('split')).toBe(MENU_ICONS.split);
    expect(shapesOf('check')).toBe(ICONS.check);
    expect(rasterOf('split')).toBeNull();
  });
});

describe('the city menu icons (R5 "Chevrons", #627)', () => {
  it('are the three raster files of recruit, barracks and warehouse, with no drawn shapes', () => {
    expect(Object.keys(RASTER_ICONS).sort()).toEqual(['barracks', 'recruit', 'warehouse']);
    for (const name of ['recruit', 'barracks', 'warehouse'] as const) {
      expect(rasterOf(name)).toMatch(/\.png$|^data:image\/png/);
      expect(shapesOf(name)).toEqual([]);
    }
    expect(new Set(Object.values(RASTER_ICONS)).size).toBe(3);
  });
});
