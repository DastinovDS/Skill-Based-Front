import { describe, expect, it } from 'vitest';
import { ageLabel, ghostAlpha } from './fogLayout.ts';

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

describe('ghostAlpha (9.8)', () => {
  it('stays at 0.6 for the first minute, fades linearly, and is gone after two minutes', () => {
    expect(ghostAlpha(0)).toBe(0.6);
    expect(ghostAlpha(60)).toBe(0.6);
    expect(ghostAlpha(90)).toBeCloseTo(0.3);
    expect(ghostAlpha(119)).toBeGreaterThan(0);
    expect(ghostAlpha(119)).toBeLessThan(0.02);
    expect(ghostAlpha(120)).toBe(0);
    expect(ghostAlpha(500)).toBe(0);
  });
});
