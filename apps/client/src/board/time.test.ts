import { describe, expect, it } from 'vitest';
import { agoText, lengthText } from './time.ts';

const NOW = Date.parse('2026-10-29T12:00:00Z');
const at = (offsetMs: number): string => new Date(NOW - offsetMs).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('agoText', () => {
  it('speaks minutes, hours and days in the UI language', () => {
    expect(agoText(at(12 * MIN), NOW, 'en')).toBe('12 min. ago');
    expect(agoText(at(2 * HOUR + 5 * MIN), NOW, 'en')).toBe('2 hr. ago');
    expect(agoText(at(DAY + HOUR), NOW, 'en')).toBe('yesterday');
    expect(agoText(at(3 * DAY), NOW, 'en')).toBe('3 days ago');
  });

  it('says now for a fresh or a future match', () => {
    expect(agoText(at(5_000), NOW, 'en')).toBe('now');
    expect(agoText(at(-HOUR), NOW, 'en')).toBe('now');
  });

  it('shows the date once it is a month old', () => {
    expect(agoText(at(45 * DAY), NOW, 'en')).toMatch(/2026/);
  });

  it('has nothing for a missing or damaged date', () => {
    expect(agoText(null, NOW, 'en')).toBeNull();
    expect(agoText('yesterday-ish', NOW, 'en')).toBeNull();
  });
});

describe('lengthText', () => {
  it('turns ticks (10 per second) into m:ss', () => {
    expect(lengthText(7240)).toBe('12:04');
    expect(lengthText(9000)).toBe('15:00');
    expect(lengthText(null)).toBeNull();
  });
});
