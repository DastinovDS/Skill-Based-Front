import { describe, expect, it } from 'vitest';
import { ringRadius } from './cityLayout.ts';
import {
  buildProgress,
  crownArc,
  lozengeRow,
  lozengeRowY,
  quantize,
  recruitPip,
  towerPoint,
  towerScale,
} from './pieceLayout.ts';
import { CROWN, LOZENGE, RECRUIT_PIPS, TOWER } from './style.ts';

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

describe('towers on the ring (ui-style 53g, 55k)', () => {
  it('stands the barracks at the upper left and the factory at the left, on the ring', () => {
    const barracks = towerPoint(14, 'barracks');
    const factory = towerPoint(14, 'factory');
    expect(barracks.x).toBeLessThan(0);
    expect(barracks.y).toBeLessThan(0);
    expect(factory.x).toBeLessThan(0);
    expect(Math.abs(factory.y)).toBeLessThan(Math.abs(factory.x) / 4);
    expect(Math.hypot(barracks.x, barracks.y)).toBeCloseTo(ringRadius(14) + TOWER.out);
  });

  it('keeps its scale at least the minimum, and shrinks on screen slower than the map zoomed out', () => {
    expect(towerScale(2)).toBeGreaterThanOrEqual(TOWER.minScale);
    expect(towerScale(2)).toBeLessThan(TOWER.minScale * 1.2);
    // Where `minScale` gives `TOWER.screen` css px per unit the tower is at its minimum.
    expect(towerScale(TOWER.screen / TOWER.minScale)).toBe(towerScale(2));
    // At half zoom it grows by the square root only (#869): about 2.1, not 3.4, so it is smaller on
    // screen than near zoom 1 but larger than the map shrinks it.
    expect(towerScale(0.5)).toBeGreaterThanOrEqual(
      TOWER.minScale * Math.sqrt(TOWER.screen / TOWER.minScale / 0.5),
    );
    expect(towerScale(0.5) * 0.5).toBeLessThan(TOWER.screen);
    expect(towerScale(0.5)).toBeGreaterThan(towerScale(1));
  });

  it('rounds the scale up to a quarter octave, so a zoom redraws the towers now and then', () => {
    expect(towerScale(0.9)).toBe(towerScale(0.88));
  });
});

describe('crownArc: the Crown arc of a build (57k)', () => {
  it('lies over the tower, concentric with the ring, past the top of the tower', () => {
    const crown = crownArc(14, 'barracks', 3, TOWER.minScale);
    const top = ringRadius(14) + TOWER.out + TOWER.halfHeight * TOWER.minScale;
    expect(crown.radius).toBeCloseTo(top + CROWN.lift);
    const middle = crown.from + crown.span / 2;
    expect(middle).toBeCloseTo(TOWER.barracksAngle);
    expect(crown.span).toBeGreaterThanOrEqual(CROWN.minSpan);
  });

  it('puts one lozenge per charge on the arc, a step apart, round the tower', () => {
    const crown = crownArc(17, 'factory', 4, TOWER.minScale);
    expect(crown.lozenges).toHaveLength(4);
    for (const p of crown.lozenges) expect(Math.hypot(p.x, p.y)).toBeCloseTo(crown.radius);
    const [a = { x: 0, y: 0 }, b = { x: 0, y: 0 }] = crown.lozenges;
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(CROWN.step, 0);
    const mean = crown.lozenges.reduce((s, p) => s + p.angle, 0) / 4;
    expect(mean).toBeCloseTo(TOWER.factoryAngle);
  });

  it('grows with the tower when the map is zoomed out', () => {
    expect(crownArc(14, 'barracks', 3, 3).radius).toBeGreaterThan(
      crownArc(14, 'barracks', 3, TOWER.minScale).radius,
    );
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

describe('quantize', () => {
  it('rounds a share down to the step, keeps 0 and 1', () => {
    expect(quantize(0, 48)).toBe(0);
    expect(quantize(1, 48)).toBe(1);
    expect(quantize(0.51, 4)).toBe(0.5);
    expect(quantize(Number.NaN, 4)).toBe(0);
  });
});

describe('recruitPip: the recruit queue on the ring (55k)', () => {
  it('starts after the barracks tower and goes clockwise over the top of the ring', () => {
    const first = recruitPip(14, 0);
    const second = recruitPip(14, 1);
    expect(first.angle).toBeCloseTo(TOWER.barracksAngle + RECRUIT_PIPS.first);
    expect(second.angle - first.angle).toBeCloseTo(RECRUIT_PIPS.step);
    expect(Math.hypot(first.x, first.y)).toBeCloseTo(ringRadius(14) + TOWER.out);
    expect(first.y).toBeLessThan(0);
  });
});
