import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYS, KEYS_STORAGE_KEY } from './keyBindings.ts';
import { KeyBindingsState } from './keyBindingsState.svelte.ts';

function memory(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => {
      data.clear();
    },
    getItem: (key) => data.get(key) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (key) => {
      data.delete(key);
    },
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe('KeyBindingsState (#966)', () => {
  it('starts from the defaults when nothing is saved or the store is missing', () => {
    expect(new KeyBindingsState(() => memory(), null).keys).toEqual(DEFAULT_KEYS);
    const blocked = new KeyBindingsState(() => {
      throw new Error('blocked');
    }, null);
    expect(blocked.keys).toEqual(DEFAULT_KEYS);
    // Without a store a change still holds until the page closes.
    blocked.bind('recruit', 'KeyY');
    expect(blocked.keys.recruit).toBe('KeyY');
  });

  it('remembers a change for the next visit, swaps and resets', () => {
    const storage = memory();
    const page = new KeyBindingsState(() => storage, null);
    expect(page.bind('recruit', 'KeyX')).toMatchObject({ kind: 'bound', swapped: 'cancel' });
    expect(page.label('recruit')).toBe('X');
    expect(page.label('cancel')).toBe('R');
    expect(new KeyBindingsState(() => storage, null).keys).toEqual({
      ...DEFAULT_KEYS,
      recruit: 'KeyX',
      cancel: 'KeyR',
    });

    page.reset('recruit');
    expect(page.keys).toEqual(DEFAULT_KEYS);
    page.bind('alert', 'KeyV');
    page.resetAll();
    expect(page.keys).toEqual(DEFAULT_KEYS);
    expect(JSON.parse(storage.getItem(KEYS_STORAGE_KEY) ?? '')).toEqual(DEFAULT_KEYS);
  });

  it('a refused key changes nothing and is not saved', () => {
    const storage = memory();
    const page = new KeyBindingsState(() => storage, null);
    expect(page.bind('recruit', 'Escape')).toEqual({ kind: 'refused' });
    expect(page.keys).toEqual(DEFAULT_KEYS);
    expect(storage.getItem(KEYS_STORAGE_KEY)).toBeNull();
  });

  it("names the keys by the viewer's layout once the browser tells it", async () => {
    const page = new KeyBindingsState(() => memory(), {
      getLayoutMap: () => Promise.resolve(new Map([['KeyQ', 'a']])),
    });
    expect(page.label('stance')).toBe('Q');
    await Promise.resolve();
    await Promise.resolve();
    expect(page.label('stance')).toBe('A');
    expect(page.names().stanceKey).toBe('A');
  });

  it('keeps the US names when the layout map is refused', async () => {
    const page = new KeyBindingsState(() => memory(), {
      getLayoutMap: () => Promise.reject(new Error('not allowed')),
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(page.label('stance')).toBe('Q');
  });
});
