import { describe, expect, it } from 'vitest';
import { atCap, cpTrack, vpShare } from './topBar.ts';

describe('cpTrack', () => {
  it('fills the track by the share of the cap', () => {
    expect(cpTrack(240, 500).share).toBeCloseTo(0.48);
    expect(cpTrack(0, 500).share).toBe(0);
    expect(cpTrack(500, 500).share).toBe(1);
  });

  it('never goes outside 0..1', () => {
    expect(cpTrack(9999, 300).share).toBe(1);
    expect(cpTrack(-5, 300).share).toBe(0);
  });

  it('has a notch at every whole CP below the cap, in percent along the track', () => {
    expect(cpTrack(0, 500).notches).toEqual([20, 40, 60, 80]);
    expect(cpTrack(0, 300).notches.map(Math.round)).toEqual([33, 67]);
  });

  it('has no notch for a cap of one CP or less', () => {
    expect(cpTrack(30, 100).notches).toEqual([]);
    expect(cpTrack(30, 50).notches).toEqual([]);
  });

  it('shows the head marker on the growing end only: not when empty, not at the cap', () => {
    expect(cpTrack(0, 500).head).toBe(false);
    expect(cpTrack(240, 500).head).toBe(true);
    expect(cpTrack(499, 500).head).toBe(true);
    expect(cpTrack(500, 500).head).toBe(false);
  });

  it('survives a cap of 0', () => {
    expect(cpTrack(10, 0)).toEqual({ share: 0, notches: [], head: false });
  });
});

describe('atCap', () => {
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
