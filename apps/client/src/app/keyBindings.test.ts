import { describe, expect, it } from 'vitest';
import {
  actionOf,
  bindable,
  bindKey,
  DEFAULT_KEYS,
  KEY_ACTIONS,
  keyLabel,
  keyNames,
  KEYS_STORAGE_KEY,
  loadKeys,
  resetKey,
  saveKeys,
  type KeyMap,
} from './keyBindings.ts';

/** A `localStorage` stand-in over a plain map. */
function memory(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
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

const saved = (value: unknown): (() => Storage) => {
  const storage = memory({ [KEYS_STORAGE_KEY]: JSON.stringify(value) });
  return () => storage;
};

describe('the default keys (#966)', () => {
  it('are the keys of the help: E F X R P B S G Q T Space H M F8', () => {
    expect(DEFAULT_KEYS).toEqual({
      planned: 'KeyE',
      release: 'KeyF',
      cancel: 'KeyX',
      recruit: 'KeyR',
      rally: 'KeyP',
      fortify: 'KeyB',
      split: 'KeyS',
      merge: 'KeyG',
      stance: 'KeyQ',
      terrain: 'KeyT',
      alert: 'Space',
      fit: 'KeyH',
      mute: 'KeyM',
      mark: 'F8',
    });
  });

  it('are all bindable and all different', () => {
    const codes = KEY_ACTIONS.map((action) => DEFAULT_KEYS[action]);
    expect(codes.every(bindable)).toBe(true);
    expect(new Set(codes).size).toBe(KEY_ACTIONS.length);
  });
});

describe('bindable', () => {
  it('takes letters, 0, the numpad, punctuation, Space and the free function keys', () => {
    for (const code of ['KeyA', 'KeyZ', 'Digit0', 'Numpad7', 'NumpadAdd', 'Comma', 'Slash']) {
      expect(bindable(code), code).toBe(true);
    }
    for (const code of ['Space', 'Backspace', 'PageUp', 'End', 'F2', 'F6', 'F10']) {
      expect(bindable(code), code).toBe(true);
    }
  });

  it('refuses the keys of the menus, the browser and the system', () => {
    for (const code of ['Escape', 'Enter', 'NumpadEnter', 'Tab', 'ArrowUp', 'ArrowLeft']) {
      expect(bindable(code), code).toBe(false);
    }
    for (const code of ['Digit1', 'Digit5', 'Digit9', 'ShiftLeft', 'ControlRight', 'AltLeft']) {
      expect(bindable(code), code).toBe(false);
    }
    for (const code of ['MetaLeft', 'CapsLock', 'F1', 'F5', 'F11', 'F12', 'Home', '']) {
      expect(bindable(code), code).toBe(false);
    }
    for (const code of ['AudioVolumeUp', 'MediaPlayPause', 'ContextMenu', 'Unidentified']) {
      expect(bindable(code), code).toBe(false);
    }
  });
});

describe('keyLabel', () => {
  it('names a key by its place on a US keyboard', () => {
    expect(keyLabel('KeyE')).toBe('E');
    expect(keyLabel('Digit0')).toBe('0');
    expect(keyLabel('Space')).toBe('Space');
    expect(keyLabel('Numpad5')).toBe('Num 5');
    expect(keyLabel('NumpadAdd')).toBe('Num +');
    expect(keyLabel('PageUp')).toBe('PgUp');
    expect(keyLabel('F4')).toBe('F4');
    expect(keyLabel('Semicolon')).toBe(';');
    expect(keyLabel('Escape')).toBe('Escape');
  });

  it("names a character key by the viewer's layout when the browser tells it", () => {
    // AZERTY: the key at the place of Q types A; a German keyboard has ö at the place of ;.
    const layout = new Map([
      ['KeyQ', 'a'],
      ['Semicolon', 'ö'],
      ['Space', ' '],
    ]);
    expect(keyLabel('KeyQ', layout)).toBe('A');
    expect(keyLabel('Semicolon', layout)).toBe('Ö');
    expect(keyLabel('KeyE', layout)).toBe('E');
    expect(keyLabel('Space', layout)).toBe('Space');
  });
});

describe('loadKeys', () => {
  it('gives the defaults without a store, without the entry, or when the store throws', () => {
    expect(loadKeys(() => memory())).toEqual(DEFAULT_KEYS);
    expect(
      loadKeys(() => {
        throw new Error('blocked');
      }),
    ).toEqual(DEFAULT_KEYS);
  });

  it('gives the defaults for damaged data', () => {
    for (const raw of ['{not json', 'null', '42', '"KeyE"', '[1,2]']) {
      const storage = memory({ [KEYS_STORAGE_KEY]: raw });
      expect(
        loadKeys(() => storage),
        raw,
      ).toEqual(DEFAULT_KEYS);
    }
  });

  it('keeps the saved keys and gives the default to a missing, unknown or refused one', () => {
    const keys = loadKeys(
      saved({ recruit: 'KeyY', cancel: 'Escape', merge: 42, split: 'Digit3', nonsense: 'KeyK' }),
    );
    expect(keys).toEqual({ ...DEFAULT_KEYS, recruit: 'KeyY' });
  });

  it('gives the defaults for all when two actions are on one key', () => {
    expect(loadKeys(saved({ ...DEFAULT_KEYS, recruit: 'KeyX' }))).toEqual(DEFAULT_KEYS);
    // A saved key that lands on the default of a missing action is a clash too.
    expect(loadKeys(saved({ recruit: 'KeyX' }))).toEqual(DEFAULT_KEYS);
  });

  it('reads back what saveKeys wrote', () => {
    const storage = memory();
    const keys: KeyMap = { ...DEFAULT_KEYS, recruit: 'KeyY', alert: 'KeyV' };
    saveKeys(() => storage, keys);
    expect(JSON.parse(storage.getItem(KEYS_STORAGE_KEY) ?? '')).toEqual(keys);
    expect(loadKeys(() => storage)).toEqual(keys);
  });

  it('saveKeys survives a store that throws', () => {
    expect(() => {
      saveKeys(() => {
        throw new Error('quota');
      }, DEFAULT_KEYS);
    }).not.toThrow();
  });
});

describe('bindKey and resetKey', () => {
  it('puts an action on a free key', () => {
    expect(bindKey(DEFAULT_KEYS, 'recruit', 'KeyY')).toEqual({
      kind: 'bound',
      keys: { ...DEFAULT_KEYS, recruit: 'KeyY' },
      swapped: null,
    });
  });

  it('swaps with the action that had the key', () => {
    // Recruit takes X: cancel moves to R.
    expect(bindKey(DEFAULT_KEYS, 'recruit', 'KeyX')).toEqual({
      kind: 'bound',
      keys: { ...DEFAULT_KEYS, recruit: 'KeyX', cancel: 'KeyR' },
      swapped: 'cancel',
    });
  });

  it('refuses a key no binding may take and says when nothing changes', () => {
    expect(bindKey(DEFAULT_KEYS, 'recruit', 'Escape')).toEqual({ kind: 'refused' });
    expect(bindKey(DEFAULT_KEYS, 'recruit', 'Digit2')).toEqual({ kind: 'refused' });
    expect(bindKey(DEFAULT_KEYS, 'recruit', 'KeyR')).toEqual({ kind: 'same' });
  });

  it('resets one action, swapping with the action that holds its default now', () => {
    const moved: KeyMap = { ...DEFAULT_KEYS, recruit: 'KeyY' };
    expect(resetKey(moved, 'recruit')).toEqual({
      kind: 'bound',
      keys: DEFAULT_KEYS,
      swapped: null,
    });
    // Recruit on X and cancel on R: resetting recruit gives R back and cancel its X.
    const swapped: KeyMap = { ...DEFAULT_KEYS, recruit: 'KeyX', cancel: 'KeyR' };
    expect(resetKey(swapped, 'recruit')).toEqual({
      kind: 'bound',
      keys: DEFAULT_KEYS,
      swapped: 'cancel',
    });
    expect(resetKey(DEFAULT_KEYS, 'recruit')).toEqual({ kind: 'same' });
  });

  it('finds the action of a key', () => {
    expect(actionOf(DEFAULT_KEYS, 'KeyQ')).toBe('stance');
    expect(actionOf(DEFAULT_KEYS, 'Space')).toBe('alert');
    expect(actionOf(DEFAULT_KEYS, 'KeyK')).toBeNull();
    expect(actionOf({ ...DEFAULT_KEYS, stance: 'KeyK' }, 'KeyK')).toBe('stance');
  });
});

describe('keyNames', () => {
  it('names every key for the dictionary strings', () => {
    const names = keyNames({ ...DEFAULT_KEYS, cancel: 'KeyC', alert: 'Numpad0' });
    expect(names.cancelKey).toBe('C');
    expect(names.alertKey).toBe('Num 0');
    expect(names.plannedKey).toBe('E');
    expect(Object.keys(names)).toHaveLength(KEY_ACTIONS.length);
  });
});
