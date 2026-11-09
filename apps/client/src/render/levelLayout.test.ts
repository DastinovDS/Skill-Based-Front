import { describe, expect, it } from 'vitest';
import { levelShare } from './levelLayout.ts';

describe('the fade of the level cells (a shift)', () => {
  const from = new Set([1, 2]);
  const to = new Set([2, 3]);

  it('a cell in both sets stays lit, one that enters grows, one that leaves shrinks', () => {
    expect(levelShare(2, from, to, 0.25)).toBe(1);
    expect(levelShare(3, from, to, 0.25)).toBe(0.25);
    expect(levelShare(1, from, to, 0.25)).toBe(0.75);
    expect(levelShare(9, from, to, 0.25)).toBe(0);
  });

  it('at the end of the fade only the new level is lit', () => {
    expect(levelShare(1, from, to, 1)).toBe(0);
    expect(levelShare(3, from, to, 1)).toBe(1);
  });
});
