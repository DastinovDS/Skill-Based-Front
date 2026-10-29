import { describe, expect, it } from 'vitest';
import { setLocale } from '../i18n/index.ts';
import type { EnemyGroup } from '../protocol.gen.ts';
import {
  cameOutOfFog,
  dissolveAlpha,
  entryMarks,
  FIGURE,
  headCorners,
  heading,
  plateText,
} from './figureLayout.ts';

const figure = (fields: Partial<EnemyGroup>): EnemyGroup => ({
  id: 'f',
  pos: 300,
  toward_b: true,
  detail: 'exact',
  mode: 'attack',
  units: 4,
  charged: 3,
  units_range: null,
  ...fields,
});

describe('plateText: the level of the figure', () => {
  setLocale('en');

  it('writes units and charged where the half is seen exactly', () => {
    expect(plateText(figure({}))).toBe('4 · 3●');
  });

  it('writes the range where the half is seen as a range, never charges', () => {
    const range = figure({
      detail: 'range',
      units: null,
      charged: 9,
      units_range: { low: 3, high: 5 },
    });
    expect(plateText(range)).toBe('3-5');
    expect(plateText({ ...range, units_range: { low: 21, high: null } })).toBe('21+');
  });

  it('has no plate at presence: the dashed token with its question mark says it', () => {
    expect(plateText(figure({ detail: 'presence', units: null, charged: null }))).toBeNull();
  });

  it('does not make up numbers the level does not carry', () => {
    expect(plateText(figure({ units: null, charged: null }))).toBeNull();
    expect(plateText(figure({ detail: 'range', units_range: null }))).toBeNull();
  });
});

describe('dissolveAlpha: in over 24 units from the border point', () => {
  it('is 0 on the border point and 1 from 24 units on', () => {
    expect(dissolveAlpha(0)).toBe(0);
    expect(dissolveAlpha(FIGURE.dissolve)).toBe(1);
    expect(dissolveAlpha(500)).toBe(1);
  });

  it('grows evenly between them', () => {
    expect(dissolveAlpha(FIGURE.dissolve / 2)).toBeCloseTo(0.5);
    expect(dissolveAlpha(6)).toBeLessThan(dissolveAlpha(12));
  });

  it('never goes below 0', () => {
    expect(dissolveAlpha(-3)).toBe(0);
  });
});

describe('heading and the pointer head', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 0 };

  it('points along the road to the end the figure goes to', () => {
    expect(heading(a, b, true)).toEqual({ x: 1, y: 0 });
    expect(heading(a, b, false)).toEqual({ x: -1, y: 0 });
  });

  it('survives a road of no length', () => {
    expect(heading(a, a, true)).toEqual({ x: 1, y: 0 });
  });

  it('puts the tip in front of the token and the base behind it, on the road', () => {
    const [tip, left, right] = headCorners({ x: 1, y: 0 });
    expect(tip).toEqual({ x: FIGURE.head.tip, y: 0 });
    expect(left.x).toBeCloseTo(FIGURE.head.tip - FIGURE.head.length);
    expect(right.x).toBeCloseTo(left.x);
    expect(left.y).toBeCloseTo(-right.y);
    expect(Math.abs(left.y - right.y)).toBeCloseTo(FIGURE.head.width);
  });

  it('turns with the direction: the head of a figure going the other way points the other way', () => {
    const [forward] = headCorners({ x: 1, y: 0 });
    const [back] = headCorners({ x: -1, y: 0 });
    expect(back.x).toBe(-forward.x);
    const [down] = headCorners({ x: 0, y: 1 });
    expect(down).toEqual({ x: 0, y: FIGURE.head.tip });
  });
});

describe('entryMarks: a figure that came out of the fog', () => {
  it('spreads one ring and fades it within 0.8 s', () => {
    const start = entryMarks(0, false).ring;
    const mid = entryMarks(0.4, false).ring;
    expect(start?.radius).toBeCloseTo(FIGURE.entry.from);
    expect(mid?.radius).toBeGreaterThan(start?.radius ?? Infinity);
    expect(mid?.alpha).toBeLessThan(start?.alpha ?? 0);
    expect(entryMarks(0.8, false).ring).toBeNull();
  });

  it('keeps the tick for 2 s, fading over the last second', () => {
    expect(entryMarks(0, false).tick?.alpha).toBe(1);
    expect(entryMarks(1, false).tick?.alpha).toBe(1);
    expect(entryMarks(1.5, false).tick?.alpha).toBeCloseTo(0.5);
    expect(entryMarks(2, false).tick).toBeNull();
  });

  it('has no ring with "less motion", but keeps the tick', () => {
    const marks = entryMarks(0.2, true);
    expect(marks.ring).toBeNull();
    expect(marks.tick).not.toBeNull();
  });

  it('has nothing before the figure was seen', () => {
    expect(entryMarks(-0.1, false)).toEqual({ ring: null, tick: null });
  });
});

describe('cameOutOfFog', () => {
  it('is a figure first seen close to the border point, not one already deep in its half', () => {
    expect(cameOutOfFog(5)).toBe(true);
    expect(cameOutOfFog(FIGURE.entryNear)).toBe(true);
    expect(cameOutOfFog(FIGURE.entryNear + 1)).toBe(false);
  });
});
