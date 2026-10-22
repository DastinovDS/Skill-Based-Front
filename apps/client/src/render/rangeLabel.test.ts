import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n/index.ts';
import { rangeLabel } from './rangeLabel.ts';

describe('rangeLabel', () => {
  afterEach(() => {
    setLocale('en');
  });

  it('writes a closed range as low-high and the last open one as low+, in both languages', () => {
    for (const locale of ['en', 'ru'] as const) {
      setLocale(locale);
      expect(rangeLabel({ low: 1, high: 2 })).toBe('1-2');
      expect(rangeLabel({ low: 11, high: 20 })).toBe('11-20');
      expect(rangeLabel({ low: 21, high: null })).toBe('21+');
    }
  });
});
