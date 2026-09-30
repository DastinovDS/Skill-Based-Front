import { describe, expect, it } from 'vitest';
import { ageLabel, fogDashes, hatchChords } from './fogLayout.ts';

describe('ageLabel', () => {
  it('shows minutes and seconds since the sighting', () => {
    expect(ageLabel(210, 10)).toBe('-0:21');
    expect(ageLabel(0, 10)).toBe('-0:00');
    expect(ageLabel(1250, 10)).toBe('-2:05');
  });

  it('treats a sighting from the future as just now', () => {
    expect(ageLabel(-30, 10)).toBe('-0:00');
  });

  it('does not divide by a zero tick rate', () => {
    expect(ageLabel(100, 0)).toBe('-0:00');
  });
});

describe('hatchChords', () => {
  it('keeps every chord end on or inside the circle', () => {
    for (const [from, to] of hatchChords(20, 5)) {
      expect(Math.hypot(from.x, from.y)).toBeLessThanOrEqual(20 + 1e-9);
      expect(Math.hypot(to.x, to.y)).toBeLessThanOrEqual(20 + 1e-9);
    }
  });

  it('runs at 45 degrees and is spaced evenly', () => {
    const chords = hatchChords(20, 5);
    expect(chords.length).toBeGreaterThan(4);
    for (const [from, to] of chords) {
      expect(to.x - from.x).toBeCloseTo(from.y - to.y);
    }
    const sums = chords.map(([from]) => from.x + from.y);
    const steps = sums.slice(1).map((value, i) => value - (sums[i] ?? 0));
    for (const step of steps) expect(step).toBeCloseTo(steps[0] ?? 0);
  });
});

describe('fogDashes', () => {
  it('breaks a road into dashes with gaps and clips the last one to the road', () => {
    expect(fogDashes(50, 10, 10)).toEqual([
      [0, 10],
      [20, 30],
      [40, 50],
    ]);
    expect(fogDashes(35, 10, 10)).toEqual([
      [0, 10],
      [20, 30],
    ]);
    expect(fogDashes(25, 10, 10)).toEqual([
      [0, 10],
      [20, 25],
    ]);
  });

  it('gives nothing for an empty road', () => {
    expect(fogDashes(0, 10, 10)).toEqual([]);
  });
});
