import { describe, expect, it } from 'vitest';
import { chargeDots, formatCentis, formatClock } from './format.ts';

describe('formatCentis', () => {
  it('turns hundredths into units with the locale separator', () => {
    expect(formatCentis(350, 'en')).toBe('3.5');
    expect(formatCentis(350, 'de')).toBe('3,5');
    expect(formatCentis(500, 'en')).toBe('5');
    expect(formatCentis(20, 'en')).toBe('0.2');
  });
});

describe('formatClock', () => {
  it('formats m:ss and never goes below zero', () => {
    expect(formatClock(720)).toBe('12:00');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(-3)).toBe('0:00');
  });
});

describe('chargeDots', () => {
  it('fills one dot per charged unit', () => {
    expect(chargeDots(3, 2)).toBe('●●○');
    expect(chargeDots(0, 0)).toBe('');
  });

  it('gives no dots for a huge group', () => {
    expect(chargeDots(40, 10)).toBe('');
  });
});
