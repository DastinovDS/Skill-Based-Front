import { describe, expect, it } from 'vitest';
import { HINT_MATCHES, hintsVisible, registerMatch } from './hints.ts';

function memory(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
    key: () => null,
    get length() {
      return data.size;
    },
  };
}

describe('the key-hint bar', () => {
  it('counts a match once, also after a reload of the page', () => {
    const storage = memory();
    expect(registerMatch('a', () => storage)).toBe(1);
    expect(registerMatch('a', () => storage)).toBe(1);
    expect(registerMatch('b', () => storage)).toBe(2);
    expect(registerMatch('b', () => storage)).toBe(2);
  });

  it('shows in the first three matches and hides from the fourth', () => {
    const storage = memory();
    const shown = ['a', 'b', 'c', 'd', 'e'].map((id) =>
      hintsVisible(registerMatch(id, () => storage)),
    );
    expect(HINT_MATCHES).toBe(3);
    expect(shown).toEqual([true, true, true, false, false]);
  });

  it('shows the bar when the storage is blocked or holds garbage', () => {
    expect(
      registerMatch('a', () => {
        throw new Error('blocked');
      }),
    ).toBe(1);
    const storage = memory();
    storage.setItem('sbf.hints.matches', 'many');
    expect(registerMatch('a', () => storage)).toBe(1);
  });
});
