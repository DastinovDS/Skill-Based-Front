import { describe, expect, it } from 'vitest';
import { barTop, capacityRing, cityRadius, ringRadius, warehouseSegments } from './cityLayout.ts';

describe('cityRadius', () => {
  it.each([
    [0, 13],
    [2, 13],
    [3, 17],
    [4, 17],
    [5, 21],
    [6, 21],
    [7, 25],
    [12, 25],
  ])('capacity %i gives radius %i (ui-style.md 9.4)', (capacity, radius) => {
    expect(cityRadius(capacity)).toBe(radius);
  });

  it('puts the ring 8 outside the body', () => {
    expect(ringRadius(17)).toBe(25);
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
    expect(barTop(13)).toBeGreaterThan(ringRadius(13));
  });
});
