import { describe, expect, it } from 'vitest';
import { ringRadius } from './cityLayout.ts';
import { buildProgress, lozengeRow, lozengeRowY } from './pieceLayout.ts';
import { LOZENGE } from './style.ts';

/** Item `i` of `xs` (NaN when missing, so a check fails). */
const at = (xs: readonly number[], i: number): number => xs[i] ?? Number.NaN;

describe('lozengeRow: the warehouse as marks (ui-style 57u)', () => {
  it('sets a row of up to four marks as one run, centred, a pitch apart', () => {
    expect(lozengeRow(0)).toEqual([]);
    expect(lozengeRow(1)).toEqual([0]);
    const four = lozengeRow(4);
    expect(four).toHaveLength(4);
    expect(at(four, 1) - at(four, 0)).toBeCloseTo(LOZENGE.pitch);
    expect(at(four, 3) - at(four, 2)).toBeCloseTo(LOZENGE.pitch);
    expect(at(four, 0) + at(four, 3)).toBeCloseTo(0);
  });

  it('sets six in two threes: the gap between the threes is wider', () => {
    const six = lozengeRow(6);
    expect(at(six, 2) - at(six, 1)).toBeCloseTo(LOZENGE.pitch);
    expect(at(six, 3) - at(six, 2)).toBeCloseTo(LOZENGE.pitch + LOZENGE.groupGap);
    expect(at(six, 0) + at(six, 5)).toBeCloseTo(0);
  });

  it('hangs the row under the capacity ring', () => {
    expect(lozengeRowY(14)).toBe(ringRadius(14) + LOZENGE.drop);
  });
});

describe('buildProgress: a build from the snapshot', () => {
  it('counts what is paid from the price while charges are owed; the time has not started', () => {
    expect(buildProgress(2, 3, null, 100, 50)).toEqual({
      cost: 3,
      paid: 1,
      time: 0,
      running: false,
    });
  });

  it('shows only the owed charges when the price is not known', () => {
    expect(buildProgress(2, null, null, 100, 50)).toMatchObject({ cost: 2, paid: 0 });
  });

  it('runs the time from the full payment to `done_tick`, by the render tick', () => {
    expect(buildProgress(0, 3, 200, 100, 150)).toEqual({
      cost: 3,
      paid: 3,
      time: 0.5,
      running: true,
    });
    expect(buildProgress(0, 3, 200, 100, 150.5).time).toBeCloseTo(0.505);
  });

  it('clamps a time past its end or before its start', () => {
    expect(buildProgress(0, 3, 200, 100, 260).time).toBe(1);
    expect(buildProgress(0, 3, 200, 100, 50).time).toBe(0);
  });
});
