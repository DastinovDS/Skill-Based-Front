import { describe, expect, it } from 'vitest';
import {
  hasLocaleChoice,
  initialLocale,
  LOCALE_STORAGE_KEY,
  pickLocale,
  saveLocale,
} from './locale.ts';

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
    [['en-US'], 'en'],
    [['EN'], 'en'],
    [['en-GB', 'ru'], 'en'],
    [['ru-RU', 'en-US'], 'en'],
    [['ru'], 'en'],
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
    expect(initialLocale(() => storage, ['de-DE'])).toBe('en');
  });

  it('falls back to en for a saved language that is no longer supported (ru)', () => {
    const storage = memoryStorage({ [LOCALE_STORAGE_KEY]: 'ru' });
    expect(initialLocale(() => storage, ['ru-RU'])).toBe('en');
  });

  it('falls back to the browser languages when storage throws', () => {
    expect(initialLocale(blocked, ['ru-RU', 'en-US'])).toBe('en');
  });
});

describe('saveLocale', () => {
  it('stores the choice', () => {
    const storage = memoryStorage();
    saveLocale(() => storage, 'en');
    expect(storage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
  });

  it('does not throw when storage is blocked', () => {
    expect(() => {
      saveLocale(blocked, 'en');
    }).not.toThrow();
  });
});

describe('hasLocaleChoice', () => {
  it('is false while only one language ships', () => {
    expect(hasLocaleChoice()).toBe(false);
  });
});
