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
import { ru } from './ru.ts';

describe('dictionaries', () => {
  it('have the same set of keys in every language', () => {
    const reference = Object.keys(ru).sort();
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
    for (const [key, value] of Object.entries(ru)) {
      const reference = names(value).sort();
      for (const locale of LOCALES) {
        const text = DICTIONARIES[locale][key as keyof typeof ru];
        expect(names(text).sort(), `${locale}: ${key}`).toEqual(reference);
      }
    }
  });

  it('reject a missing or an extra key at compile time (svelte-check fails otherwise)', () => {
    const { 'hud.map': dropped, ...rest } = en;
    // @ts-expect-error `hud.map` is missing: en.ts uses the same `satisfies Messages`.
    const missing = { ...rest } satisfies Messages;
    // @ts-expect-error `hud.extra` is not a key of ru.
    const extra = { ...en, 'hud.extra': 'x' } satisfies Messages;
    expect([dropped, Object.keys(missing).length, Object.keys(extra).length]).toEqual([
      'Map',
      Object.keys(ru).length - 1,
      Object.keys(ru).length + 1,
    ]);
  });
});

describe('translate', () => {
  it('returns the string of the given language', () => {
    expect(translate('ru', 'error.renderer')).toBe('Не удалось запустить отрисовку карты');
    expect(translate('en', 'error.renderer')).toBe('Could not start the map renderer');
  });
});

describe('t', () => {
  const initial: Locale = getLocale();

  afterEach(() => {
    setLocale(initial);
  });

  it('follows the current language', () => {
    setLocale('ru');
    expect(t('hud.map')).toBe('Карта');
    setLocale('en');
    expect(t('hud.map')).toBe('Map');
  });

  it('remembers the choice and marks the document language', () => {
    setLocale('ru');
    expect(window.localStorage.getItem('sbf.locale')).toBe('ru');
    expect(document.documentElement.lang).toBe('ru');
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
    setLocale('ru');
    expect(tf('bar.cpLabel', { value: 1 })).toBe('CP: 1 из {cap}');
  });
});
