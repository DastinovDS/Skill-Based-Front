import { describe, expect, it } from 'vitest';
import { initialLocale, LOCALE_STORAGE_KEY, pickLocale, saveLocale } from './locale.ts';

function memoryStorage(entries: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(entries));
  return {
    get length() {
      return data.size;
    },
    clear: () => {
      data.clear();
    },
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => {
      data.delete(key);
    },
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

const blocked = (): Storage => {
  throw new DOMException('The operation is insecure.', 'SecurityError');
};

describe('pickLocale', () => {
  it.each([
    [['ru-RU', 'en-US'], 'ru'],
    [['RU'], 'ru'],
    [['en-GB', 'ru'], 'en'],
    [['de-DE', 'ru-RU'], 'ru'],
    [['de-DE', 'fr'], 'en'],
    [[], 'en'],
  ] as const)('%j → %s', (languages, expected) => {
    expect(pickLocale(languages)).toBe(expected);
  });
});

describe('initialLocale', () => {
  it('prefers the saved choice over the browser languages', () => {
    const storage = memoryStorage({ [LOCALE_STORAGE_KEY]: 'en' });
    expect(initialLocale(() => storage, ['ru-RU'])).toBe('en');
  });

  it('ignores an unknown saved value', () => {
    const storage = memoryStorage({ [LOCALE_STORAGE_KEY]: 'uk' });
    expect(initialLocale(() => storage, ['ru-RU'])).toBe('ru');
  });

  it('falls back to the browser languages when storage throws', () => {
    expect(initialLocale(blocked, ['ru-RU'])).toBe('ru');
  });
});

describe('saveLocale', () => {
  it('stores the choice', () => {
    const storage = memoryStorage();
    saveLocale(() => storage, 'ru');
    expect(storage.getItem(LOCALE_STORAGE_KEY)).toBe('ru');
  });

  it('does not throw when storage is blocked', () => {
    expect(() => {
      saveLocale(blocked, 'ru');
    }).not.toThrow();
  });
});
