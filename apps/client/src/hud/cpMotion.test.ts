import { describe, expect, it } from 'vitest';
import { DURATION } from '../theme/tokens.ts';
import {
  burinEdge,
  priceBracket,
  running,
  shownValue,
  slivers,
  type CpChange,
} from './cpMotion.ts';

// The CP gauge of ui-style 57a: spend 0.7 s, sliver 1.0 s, income 0.8 s, all easeInOutSine.
const spend = (at: number, delta: number, after: number): CpChange => ({ at, delta, after });

describe('shownValue', () => {
  it('starts at the old value and eases to the new one over the spend time', () => {
    const changes = [spend(0, -1.5, 2)];
    expect(shownValue(2, 5, changes, 0)).toBeCloseTo(3.5);
    // easeInOutSine is a half at half the time
    expect(shownValue(2, 5, changes, DURATION.cpSpend / 2)).toBeCloseTo(2.75);
    expect(shownValue(2, 5, changes, DURATION.cpSpend)).toBeCloseTo(2);
  });

  it('adds overlapping changes up, so a second spend never jumps', () => {
    const first = spend(0, -1, 3);
    const second = spend(200, -1, 2);
    const before = shownValue(3, 5, [first], 199);
    const after = shownValue(2, 5, [first, second], 200);
    expect(after).toBeCloseTo(before, 1);
  });

  it('eases an income in over the income time and stays on the scale', () => {
    const changes = [spend(0, 1, 5)];
    expect(shownValue(5, 5, changes, 0)).toBeCloseTo(4);
    expect(shownValue(5, 5, changes, DURATION.cpIncome)).toBeCloseTo(5);
    expect(shownValue(0, 5, [spend(0, -3, 0)], 0)).toBeLessThanOrEqual(5);
    expect(shownValue(5, 5, [spend(0, 9, 5)], 0)).toBeGreaterThanOrEqual(0);
  });
});

describe('running', () => {
  it('keeps a spend for its sliver and an income for its own time', () => {
    const changes = [spend(0, -1, 2), spend(0, 1, 3)];
    expect(running(changes, DURATION.cpIncome - 1)).toHaveLength(2);
    expect(running(changes, DURATION.cpIncome + 1)).toHaveLength(1);
    expect(running(changes, DURATION.cpSliver + 1)).toHaveLength(0);
  });
});

describe('slivers and the burin edge', () => {
  it('drops the spent length from the new value to the old one, sunk as it fades', () => {
    const [s] = slivers([spend(0, -1.5, 2)], DURATION.cpSliver / 2);
    expect(s).toMatchObject({ lo: 2, hi: 3.5 });
    expect(s?.drop).toBeCloseTo(0.5);
    expect(slivers([spend(0, 1, 3)], 10)).toEqual([]);
  });

  it('shows the burin edge of an income only while it sets solid', () => {
    expect(burinEdge([spend(0, 1, 3)], 0)).toBeCloseTo(1);
    expect(burinEdge([spend(0, 1, 3)], DURATION.cpIncome)).toBe(0);
    expect(burinEdge([spend(0, -1, 3)], 0)).toBe(0);
  });
});

describe('priceBracket', () => {
  it('spans the CP an order takes, or from the value to the price when short', () => {
    expect(priceBracket(3, 1)).toEqual({ from: 2, to: 3, short: false });
    expect(priceBracket(0.5, 1)).toEqual({ from: 0.5, to: 1, short: true });
  });
});
