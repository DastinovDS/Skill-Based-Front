import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale } from '../i18n/index.ts';
import type { IncomingAlert } from '../match/incoming.ts';
import type { OverflowAlert } from '../match/overflow.ts';
import { alertRows, alertRowText } from './alertRows.ts';

const overflow = (node: number, over: Partial<OverflowAlert> = {}): OverflowAlert => ({
  kind: 'overflow',
  node,
  units: 6,
  capacity: 4,
  attritionIn: 24,
  graceLeft: null,
  ...over,
});
const incoming = (node: number, over: Partial<IncomingAlert> = {}): IncomingAlert => ({
  kind: 'incoming',
  node,
  count: 1,
  ticksLeft: 32,
  ...over,
});

describe('alertRows', () => {
  const initial = getLocale();
  afterEach(() => {
    setLocale(initial);
  });

  it('has one row per kind: overcrowding first, then the attacks', () => {
    const rows = alertRows([overflow(7), overflow(9)], [incoming(3), incoming(4, { count: 2 })]);
    expect(rows.map((r) => r.kind)).toEqual(['overflow', 'incoming']);
    expect(rows[0]).toMatchObject({ cities: 2 });
    expect(rows[1]).toMatchObject({ cities: 2, orders: 3 });
  });

  it('has no rows without alerts', () => {
    expect(alertRows([], [])).toEqual([]);
  });

  it('writes the overcrowding row of one city like ui-style 12.3', () => {
    setLocale('ru');
    const [row] = alertRows([overflow(7)], []);
    if (row === undefined) throw new Error('no row');
    expect(alertRowText(row, 10)).toBe('Переполнен город 7: 6 из 4. Минус юнит через 2,4 с');
  });

  it('shows the grace instead of the loss while it lasts', () => {
    setLocale('en');
    const [row] = alertRows([overflow(7, { attritionIn: null, graceLeft: 30 })], []);
    if (row === undefined) throw new Error('no row');
    expect(alertRowText(row, 10)).toBe('City 7 is overcrowded: 6 of 4. grace 3.0 s');
  });

  it('folds several cities into one line with the count and the nearest one', () => {
    setLocale('en');
    const [row] = alertRows([overflow(7), overflow(9, { attritionIn: 50 })], []);
    if (row === undefined) throw new Error('no row');
    expect(alertRowText(row, 10)).toBe(
      'Overcrowded cities: 2. Nearest, city 7: a unit is lost in 2.4 s',
    );
  });

  it('writes the incoming rows, also when the orders have left already', () => {
    setLocale('en');
    const [row] = alertRows([], [incoming(3, { count: 2 })]);
    if (row === undefined) throw new Error('no row');
    expect(alertRowText(row, 10)).toBe(
      'They are coming for city 3 (orders: 2): they leave in 3.2 s',
    );
    const [gone] = alertRows([], [incoming(3, { ticksLeft: null })]);
    if (gone === undefined) throw new Error('no row');
    expect(alertRowText(gone, 10)).toContain('already on the way');
  });
});
