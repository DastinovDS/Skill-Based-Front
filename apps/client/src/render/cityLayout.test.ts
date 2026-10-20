import { describe, expect, it } from 'vitest';
import {
  BARRACKS_HOUSE,
  barracksAt,
  barTop,
  capacityRing,
  cityRadius,
  queueSlots,
  queueTop,
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
  it('has a segment per unit of capacity, filled by the charges in the warehouse', () => {
    const bar = warehouseSegments(2, 5);
    expect(bar.segments).toHaveLength(5);
    expect(bar.segments.filter((s) => s.filled)).toHaveLength(2);
  });

  it('is centred and clamps the fill', () => {
    const bar = warehouseSegments(9, 3);
    expect(bar.segments.filter((s) => s.filled)).toHaveLength(3);
    expect(bar.segments[0]?.x).toBeCloseTo(-bar.width / 2 + 1);
  });

  it('sits under the ring', () => {
    expect(barTop(11)).toBeGreaterThan(ringRadius(11));
  });
});

describe('queueSlots (DEC-25)', () => {
  it('has a slot per queued unit and fills the first by the progress', () => {
    const mark = queueSlots(3, 15, 30);
    expect(mark.slots.map((slot) => slot.fill)).toEqual([0.5, 0, 0]);
    expect(mark.slots[0]?.x).toBeCloseTo(-mark.width / 2 + 1);
  });

  it('shows a ready unit waiting for a place as a full slot', () => {
    expect(queueSlots(1, 30, 30).slots.map((slot) => slot.fill)).toEqual([1]);
  });

  it('is empty without a queue', () => {
    expect(queueSlots(0, 0, 30)).toEqual({ width: 0, slots: [] });
  });

  it('sits above the ring, the warehouse bar below it', () => {
    expect(queueTop(17)).toBeLessThan(-ringRadius(17));
    expect(barTop(17)).toBeGreaterThan(ringRadius(17));
  });
});

describe('the barracks mark (DEC-26)', () => {
  it('is drawn only for a city that is known to have one, and only with the city development on', () => {
    expect(showsBarracks(true, true)).toBe(true);
    expect(showsBarracks(false, true)).toBe(false);
    // A foreign city: the enemy's barracks are hidden, the snapshot says `null`.
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
