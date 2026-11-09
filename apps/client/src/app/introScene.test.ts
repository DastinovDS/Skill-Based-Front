import { describe, expect, it } from 'vitest';
import {
  EMERGE,
  INTRO,
  INTRO_END,
  INTRO_SEEN_KEY,
  claimIntro,
  emergeEnd,
  introFrame,
  letterTimes,
} from './introScene.ts';

/** A sessionStorage stand-in. */
function memory(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => {
      items.clear();
    },
    getItem: (key) => items.get(key) ?? null,
    key: (i) => [...items.keys()][i] ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

describe('the opening scene timeline (#826, intro B Grain)', () => {
  const times = letterTimes(12);

  it('lets the letters of "Fines Imperii" come in the mockup order, never left to right', () => {
    const order = [...times.keys()].sort((a, b) => (times[a]?.[0] ?? 0) - (times[b]?.[0] ?? 0));
    expect(order).toEqual(EMERGE.map(([i]) => i));
    // M, N, R, F, S, I ...: the first three are neither the first letters nor in reading order.
    expect(order.slice(0, 3)).toEqual([6, 2, 9]);
  });

  it('starts the letters unevenly and overlaps them', () => {
    const onsets = EMERGE.map(([, start]) => start);
    const gaps = onsets.slice(1).map((s, i) => s - (onsets[i] ?? 0));
    expect(new Set(gaps.map((g) => g.toFixed(2))).size).toBeGreaterThan(4);
    // Every letter is still forming when the next one starts (1.6 to 2.2 s each).
    for (const [, start, length] of EMERGE) {
      expect(length).toBeGreaterThanOrEqual(1.6);
      expect(length).toBeLessThanOrEqual(2.2);
      expect(start + length).toBeGreaterThan(start + Math.max(...gaps));
    }
  });

  it('shows the dark stage alone first, then forms the letters through the grain', () => {
    const start = introFrame(times, 0);
    expect(start.letters.every((p) => p === 0)).toBe(true);
    expect(start.grain).toBe(true);
    expect(start.cover).toBe(1);
    expect(start.move).toBe(0);
    expect(start.menu).toEqual([0, 0]);
    const mid = introFrame(times, INTRO.title + 1);
    expect(mid.letters.filter((p) => p > 0 && p < 1).length).toBeGreaterThan(3);
  });

  it('rises more slowly than the mockup (0.7 s) once the letters are nearly solid', () => {
    expect(INTRO.moveDur).toBeGreaterThan(0.7 * 2);
    expect(INTRO.move).toBeGreaterThan(emergeEnd(times) - 0.5);
    expect(introFrame(times, INTRO.move).move).toBe(0);
    const half = introFrame(times, INTRO.move + INTRO.moveDur / 2).move;
    expect(half).toBeCloseTo(0.5, 5);
  });

  it('ends exactly in the still entry screen', () => {
    const end = introFrame(times, INTRO_END);
    expect(end.done).toBe(true);
    expect(end.grain).toBe(false);
    expect(end.letters.every((p) => p === 1)).toBe(true);
    expect(end.rule).toBe(1);
    expect(end.move).toBe(1);
    expect(end.menu).toEqual([1, 1]);
    expect(end.cover).toBe(0);
    expect(end.skip).toBe(false);
    expect(introFrame(times, INTRO_END - 0.01).done).toBe(false);
  });

  it('gives any other title a full set of times, in a jumping order', () => {
    for (const n of [1, 5, 9, 14]) {
      const other = letterTimes(n);
      expect(other).toHaveLength(n);
      expect(other.every((row) => row[1] > 0)).toBe(true);
    }
    const nine = letterTimes(9);
    const first = [...nine.keys()].sort((a, b) => (nine[a]?.[0] ?? 0) - (nine[b]?.[0] ?? 0));
    expect(first.slice(0, 3)).not.toEqual([0, 1, 2]);
  });
});

describe('claimIntro', () => {
  it('plays once a session and marks it', () => {
    const store = memory();
    expect(claimIntro(() => store, false)).toBe(true);
    expect(store.getItem(INTRO_SEEN_KEY)).toBe('1');
    expect(claimIntro(() => store, false)).toBe(false);
  });

  it('never plays under reduced motion', () => {
    const store = memory();
    expect(claimIntro(() => store, true)).toBe(false);
    expect(store.getItem(INTRO_SEEN_KEY)).toBeNull();
  });

  it('shows the still screen when the storage throws', () => {
    expect(
      claimIntro(() => {
        throw new DOMException('denied', 'SecurityError');
      }, false),
    ).toBe(false);
    const broken = memory();
    broken.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError');
    };
    expect(claimIntro(() => broken, false)).toBe(false);
  });
});
