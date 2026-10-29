import { describe, expect, it } from 'vitest';
import { columnEdge, columnKinds, columnSlots, counterLayout, markScale } from './defenseLayout.ts';
import { ringRadius } from './cityLayout.ts';
import { CITY_COLUMN, DEFENSE_PIPS, RING_SEGMENT } from './style.ts';

describe('counterLayout (D1 "Diamond pips", #349)', () => {
  const filled = (bonus: number, cap: number): boolean[] =>
    (counterLayout({ bonus, cap })?.pips ?? []).map((p) => p.filled);

  it('is a diamond per cap place: filled for a bonus gathered, hollow for room', () => {
    expect(filled(0, 3)).toEqual([false, false, false]);
    expect(filled(1, 3)).toEqual([true, false, false]);
    expect(filled(3, 3)).toEqual([true, true, true]);
  });

  it('adds a hollow diamond when the cap grows, and keeps the gathered ones', () => {
    expect(filled(1, 2)).toEqual([true, false]);
    expect(filled(1, 3)).toEqual([true, false, false]);
  });

  it('has no places for no charged units (the badge alone)', () => {
    expect(counterLayout({ bonus: 0, cap: 0 })).toBeNull();
  });

  it('keeps the bonus within the cap, whatever the data', () => {
    expect(filled(9, 2)).toEqual([true, true]);
    expect(filled(-1, 2)).toEqual([false, false]);
  });

  it('is exact up to six places and the numbers form above', () => {
    const six = counterLayout({ bonus: 2, cap: 6 });
    expect(six?.pips).toHaveLength(6);
    expect(six?.numbers).toEqual([]);
    const eight = counterLayout({ bonus: 2, cap: 8 });
    expect(eight?.numbers.map((n) => n.text)).toEqual(['×2', '×6']);
    expect(eight?.pips.map((p) => p.filled)).toEqual([true, false]);
    expect(DEFENSE_PIPS.maxPips).toBe(6);
  });

  it('grows with the cap in the row form: a place is `pitch` wide', () => {
    const a = counterLayout({ bonus: 0, cap: 2 })?.width ?? 0;
    const b = counterLayout({ bonus: 0, cap: 3 })?.width ?? 0;
    expect(b - a).toBeCloseTo(DEFENSE_PIPS.pitch);
  });
});

describe('the left column of a city (L1, #349)', () => {
  it('never gets smaller than 16 px on screen: it grows below zoom 1 and stays at one above', () => {
    expect(markScale(2)).toBe(1);
    expect(markScale(1)).toBe(1);
    expect(markScale(0.7)).toBeCloseTo(1 / 0.7);
    expect(markScale(0.45)).toBeCloseTo(1 / 0.45);
    expect(markScale(0)).toBe(1);
  });

  it('starts just outside the capacity ring', () => {
    for (const radius of [9, 11, 14, 17, 20]) {
      const outer = ringRadius(radius) + RING_SEGMENT.base / 2;
      expect(-columnEdge(radius)).toBeGreaterThan(outer);
      expect(-columnEdge(radius)).toBeLessThan(outer + 3);
    }
  });

  it('centres one entry on the height of the city and stacks two a step apart', () => {
    const [only] = columnSlots(14, ['barracks'], 1);
    expect(only?.y).toBe(0);
    const [bar, sign] = columnSlots(14, columnKinds(true, 1), 1);
    expect(bar?.kind).toBe('barracks');
    expect(sign?.kind).toBe('defense');
    expect((sign?.y ?? 0) - (bar?.y ?? 0)).toBe(CITY_COLUMN.step);
    expect((bar?.y ?? 0) + (sign?.y ?? 0)).toBe(0);
  });

  it('keeps the icons apart and clear of the ring at every scale', () => {
    for (const scale of [1, 1 / 0.7, 1 / 0.45]) {
      const [bar, sign] = columnSlots(14, ['barracks', 'defense'], scale);
      if (bar === undefined || sign === undefined) throw new Error('no slots');
      // The barracks disc (radius 8) and the badge (radius 9) do not touch.
      expect(Math.hypot(bar.x - sign.x, bar.y - sign.y)).toBeGreaterThan((8 + 9) * scale);
      // Their right edges lie left of the edge of the column.
      expect(bar.x + 8 * scale).toBeLessThanOrEqual(columnEdge(14) + 1e-9);
      expect(sign.x + 9 * scale).toBeLessThanOrEqual(columnEdge(14) + 1e-9);
    }
  });

  it('lists the barracks first, then a kind per sign', () => {
    expect(columnKinds(true, 2)).toEqual(['barracks', 'defense', 'defense']);
    expect(columnKinds(false, 1)).toEqual(['defense']);
    expect(columnKinds(false, 0)).toEqual([]);
  });
});
