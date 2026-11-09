import { describe, expect, it } from 'vitest';
import { ENTRY_WORLD, MENU_WORLD } from './menuMap.ts';
import { MENU_RING, arcPath, menuCity, menuLand, segmentsPath } from './menuPieces.ts';
import { groundMatrix } from './menuSeason.ts';

describe('the pieces of the menu map in the Engraved look (#839)', () => {
  it('bundles the baked ground and the areas of the menu map', () => {
    for (const world of [MENU_WORLD, ENTRY_WORLD]) expect(world.ground).not.toBeNull();
    for (const world of [MENU_WORLD, ENTRY_WORLD]) expect(world.geo).not.toBeNull();
  });

  it('draws the start territory of both sides: areas, band, border and the inner lines', () => {
    const land = menuLand(MENU_WORLD.map, MENU_WORLD.geo);
    for (const side of [land.own, land.enemy]) {
      expect(side.cells.startsWith('M')).toBe(true);
      expect(side.band.length).toBeGreaterThan(0);
      expect(side.cut.length).toBeGreaterThan(0);
      expect(side.rule.length).toBeGreaterThan(0);
      expect(side.inner.length).toBeGreaterThan(0);
    }
    // The band stops at the water (a coast is not where an owner ends): it is shorter than the cut.
    expect(land.own.band.length).toBeLessThan(land.own.cut.length);
  });

  it('falls back to the Voronoi areas without a vector file', () => {
    const land = menuLand(MENU_WORLD.map, null);
    expect(land.own.band.length).toBeGreaterThan(0);
  });

  it('joins segments that meet into one polyline', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    const c = { x: 10, y: 10 };
    expect(
      segmentsPath([
        { a, b },
        { a: b, b: c },
      ]),
    ).toBe('M0.0 0.0L10.0 0.0L10.0 10.0');
    expect(
      segmentsPath([
        { a, b },
        { a: c, b: a },
      ]),
    ).toBe('M0.0 0.0L10.0 0.0M10.0 10.0L0.0 0.0');
  });

  it('lays a city on its ring of places, as many as the capacity of its kind', () => {
    const capital = menuCity('capital', { x: 100, y: 100 });
    expect(capital.radius).toBe(20);
    expect(capital.ring.radius).toBe(27);
    expect(capital.ring.cut.match(/M/g)).toHaveLength(10);
    // Room: two hairlines either side of the ring, per place.
    expect(capital.ring.room.match(/M/g)).toHaveLength(20);
    expect(MENU_RING.room.offset).toBe(1.5);
    expect(menuCity('city_small', { x: 0, y: 0 }).ring.cut.match(/M/g)).toHaveLength(4);
  });

  it('draws a short arc with the small flag and a long one with the large flag', () => {
    expect(arcPath({ x: 0, y: 0 }, 10, 0, 1)).toContain(' 0 0 1 ');
    expect(arcPath({ x: 0, y: 0 }, 10, 0, 4)).toContain(' 0 1 1 ');
  });
});

describe('groundMatrix', () => {
  it('darkens the ground and keeps its alpha, per season', () => {
    for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
      const values = groundMatrix(season).split(' ').map(Number);
      expect(values).toHaveLength(20);
      // A white pixel stays under its full light (each colour row sums below 1).
      for (const row of [0, 1, 2]) {
        const sum = values.slice(row * 5, row * 5 + 3).reduce((a, b) => a + b, 0);
        expect(sum).toBeGreaterThan(0.4);
        expect(sum).toBeLessThan(0.8);
      }
      expect(values.slice(15)).toEqual([0, 0, 0, 1, 0]);
    }
  });
});
