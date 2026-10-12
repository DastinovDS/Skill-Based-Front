import { describe, expect, it } from 'vitest';
import { atCap, cpSegments, isPartial, vpShare } from './topBar.ts';

describe('cpSegments', () => {
  it('has one segment per whole CP of the cap, filled left to right', () => {
    expect(cpSegments(240, 500)).toEqual([100, 100, 40, 0, 0]);
    expect(cpSegments(0, 500)).toEqual([0, 0, 0, 0, 0]);
    expect(cpSegments(500, 500)).toEqual([100, 100, 100, 100, 100]);
  });

  it('never goes outside 0..100 per segment', () => {
    expect(cpSegments(9999, 300)).toEqual([100, 100, 100]);
    expect(cpSegments(-5, 300)).toEqual([0, 0, 0]);
  });

  it('keeps one segment for a cap below one CP', () => {
    expect(cpSegments(30, 50)).toEqual([30]);
  });

  it('marks only the part-filled segment as partial (hatched)', () => {
    expect(cpSegments(240, 500).map(isPartial)).toEqual([false, false, true, false, false]);
  });

  it('knows the cap', () => {
    expect(atCap(500, 500)).toBe(true);
    expect(atCap(499, 500)).toBe(false);
  });
});

describe('vpShare', () => {
  it('is half and half while nobody scored', () => {
    expect(vpShare(0, 0)).toBe(50);
  });

  it('is the share of my VP of both sides, in percent', () => {
    expect(vpShare(4, 6)).toBe(40);
    expect(vpShare(6, 0)).toBe(100);
    expect(vpShare(0, 6)).toBe(0);
  });
});
