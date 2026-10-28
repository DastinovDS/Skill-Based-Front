import { afterEach, describe, expect, it } from 'vitest';
import { en } from './en.ts';
import {
  DICTIONARIES,
  getLocale,
  LOCALES,
  setLocale,
  t,
  tf,
  translate,
  type Locale,
} from './index.ts';
import type { Messages } from './messages.ts';

describe('dictionaries', () => {
  it('have the same set of keys in every language', () => {
    const reference = Object.keys(en).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(DICTIONARIES[locale]).sort(), locale).toEqual(reference);
    }
  });

  it('have no empty strings', () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(DICTIONARIES[locale])) {
        expect(value.trim(), `${locale}: ${key}`).not.toBe('');
      }
    }
  });

  it('use the same {placeholders} in every language', () => {
    const names = (text: string): string[] =>
      [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '');
    for (const [key, value] of Object.entries(en)) {
      const reference = names(value).sort();
      for (const locale of LOCALES) {
        const text = DICTIONARIES[locale][key as keyof typeof en];
        expect(names(text).sort(), `${locale}: ${key}`).toEqual(reference);
      }
    }
  });

  it('reject a missing or an extra key at compile time (svelte-check fails otherwise)', () => {
    const { 'hud.map': dropped, ...rest } = en;
    // @ts-expect-error `hud.map` is missing: a dictionary of another language ends in `satisfies Messages`.
    const missing = { ...rest } satisfies Messages;
    // @ts-expect-error `hud.extra` is not a key of en.
    const extra = { ...en, 'hud.extra': 'x' } satisfies Messages;
    expect([dropped, Object.keys(missing).length, Object.keys(extra).length]).toEqual([
      'Map',
      Object.keys(en).length - 1,
      Object.keys(en).length + 1,
    ]);
  });
});

describe('translate', () => {
  it('returns the string of the given language', () => {
    expect(translate('en', 'error.renderer')).toBe('The map could not be drawn.');
  });
});

describe('t', () => {
  const initial: Locale = getLocale();

  afterEach(() => {
    setLocale(initial);
  });

  it('follows the current language', () => {
    setLocale('en');
    expect(t('hud.map')).toBe('Map');
  });

  it('remembers the choice and marks the document language', () => {
    setLocale('en');
    expect(window.localStorage.getItem('sbf.locale')).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });
});

describe('tf', () => {
  const initial = getLocale();
  afterEach(() => {
    setLocale(initial);
  });

  it('fills placeholders in the current language and keeps unknown ones', () => {
    setLocale('en');
    expect(tf('bar.cpLabel', { value: 1, cap: 2 })).toBe('CP: 1 of 2');
    expect(tf('bar.cpLabel', { value: 1 })).toBe('CP: 1 of {cap}');
  });
});
