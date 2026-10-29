import { describe, expect, it } from 'vitest';
import {
  BARRACKS_HOUSE,
  barracksAt,
  barTop,
  capacityRing,
  cityRadius,
  lockedPlaces,
  ringRadius,
  showsBarracks,
  warehouseSegments,
} from './cityLayout.ts';

describe('cityRadius', () => {
  it.each([
    [0, 11],
    [2, 11],
    [3, 14],
    [4, 14],
    [5, 17],
    [6, 17],
    [7, 20],
    [12, 20],
  ])('capacity %i gives radius %i (round 3: smaller than ui-style.md 9.4)', (capacity, radius) => {
    expect(cityRadius(capacity)).toBe(radius);
  });

  it('puts the ring 7 outside the body', () => {
    expect(ringRadius(17)).toBe(24);
  });
});

describe('capacityRing', () => {
  it('has a segment per unit of capacity and fills as many as the garrison', () => {
    const ring = capacityRing(4, 3);
    expect(ring.solid).toBe(false);
    expect(ring.arcs).toHaveLength(4);
    expect(ring.arcs.filter((a) => a.filled)).toHaveLength(3);
    expect(ring.arcs.every((a) => a.to > a.from)).toBe(true);
  });

  it('does not fill more than the capacity (the rest goes to the overflow ring)', () => {
    expect(capacityRing(3, 9).arcs.filter((a) => a.filled)).toHaveLength(3);
  });

  it('shows an enemy or neutral city as grey segments only', () => {
    expect(capacityRing(5, 0).arcs.some((a) => a.filled)).toBe(false);
  });

  it('becomes one solid arc with a notch every fifth unit above ten', () => {
    const ring = capacityRing(12, 6);
    expect(ring.solid).toBe(true);
    expect(ring.arcs).toHaveLength(2);
    expect(ring.notches).toHaveLength(2);
    expect(capacityRing(12, 0).arcs).toHaveLength(1);
    expect(capacityRing(10, 0).solid).toBe(false);
  });

  it('is empty for capacity 0', () => {
    expect(capacityRing(0, 0).arcs).toEqual([]);
  });
});

describe('warehouseSegments', () => {
  const states = (bar: ReturnType<typeof warehouseSegments>) => bar.segments.map((s) => s.state);

  it('has a place per unit of capacity, filled by the charges in the warehouse, the rest a frame', () => {
    const bar = warehouseSegments(2, 5);
    expect(bar.segments).toHaveLength(5);
    expect(bar.segments.filter((s) => s.filled)).toHaveLength(2);
    expect(states(bar)).toEqual(['filled', 'filled', 'frame', 'frame', 'frame']);
  });

  it('is centred and clamps the fill', () => {
    const bar = warehouseSegments(9, 3);
    expect(bar.segments.filter((s) => s.filled)).toHaveLength(3);
    expect(bar.segments[0]?.x).toBeCloseTo(-bar.width / 2 + 1);
  });

  it('sits under the ring', () => {
    expect(barTop(11)).toBeGreaterThan(ringRadius(11));
  });

  it('adds dashed places after the frames for the levels not built yet (C1)', () => {
    const bar = warehouseSegments(1, 2, 2);
    expect(states(bar)).toEqual(['filled', 'frame', 'dashed', 'dashed']);
    // The dashed places are part of the bar: it is as wide as one with that many places.
    expect(bar.width).toBe(warehouseSegments(0, 4).width);
  });

  it('keeps the dashed places last even when the warehouse is full or empty', () => {
    expect(states(warehouseSegments(2, 2, 1))).toEqual(['filled', 'filled', 'dashed']);
    expect(states(warehouseSegments(0, 1, 2))).toEqual(['frame', 'dashed', 'dashed']);
  });

  it('shows only the charges of a foreign warehouse: capacity = charges, nothing locked', () => {
    expect(states(warehouseSegments(3, 3, 0))).toEqual(['filled', 'filled', 'filled']);
  });
});

describe('lockedPlaces (the warehouse levels of DEC-26, from the view and ruleset_public)', () => {
  // warehouse.max_level = 2 and gain_per_level = 1 of rulesets/mvp-1.toml, then a made-up pair.
  const mvp1 = { warehouseMaxLevel: 2, warehouseGainPerLevel: 1 };

  it.each([
    [0, 2],
    [1, 1],
    [2, 0],
  ])('level %i of 2 leaves %i dashed places', (level, locked) => {
    expect(lockedPlaces(level, mvp1)).toBe(locked);
  });

  it('is gain places per level not built yet', () => {
    const levels = { warehouseMaxLevel: 3, warehouseGainPerLevel: 2 };
    expect([0, 1, 2, 3].map((level) => lockedPlaces(level, levels))).toEqual([6, 4, 2, 0]);
  });

  it('is never negative and never above the top', () => {
    expect(lockedPlaces(5, mvp1)).toBe(0);
    expect(lockedPlaces(-1, mvp1)).toBe(2);
  });

  it('is 0 where the view gives no level (a foreign city, a province) or the development is off', () => {
    expect(lockedPlaces(null, mvp1)).toBe(0);
    expect(lockedPlaces(0, null)).toBe(0);
  });
});

describe('barTop', () => {
  it('puts the warehouse bar under the ring', () => {
    expect(barTop(17)).toBeGreaterThan(ringRadius(17));
  });
});

describe('the barracks mark (DEC-26)', () => {
  it('is drawn only for a city that is known to have one, and only with the city development on', () => {
    expect(showsBarracks(true, true)).toBe(true);
    expect(showsBarracks(false, true)).toBe(false);
    // A foreign city not next to an own node (DEC-31): the snapshot says `null`.
    expect(showsBarracks(null, true)).toBe(false);
    // Without the city development every city may recruit: no mark.
    expect(showsBarracks(true, false)).toBe(false);
  });

  it('sits outside the capacity ring on the left, clear of the queue above and the warehouse bar below', () => {
    for (const radius of [11, 14, 17, 20]) {
      const at = barracksAt(radius);
      expect(at.x).toBeLessThan(-(ringRadius(radius) + 7.5));
      expect(at.y).toBe(0);
    }
  });

  it('the house glyph fits the badge', () => {
    for (const [x, y] of BARRACKS_HOUSE) expect(Math.hypot(x, y)).toBeLessThanOrEqual(6.5);
  });
});
