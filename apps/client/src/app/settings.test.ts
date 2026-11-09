import { afterEach, describe, expect, it } from 'vitest';
import { reducedMotion, setReducedMotion } from '../render/motion.ts';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  motionOverride,
  saveSettings,
  scaleValue,
  SETTINGS_STORAGE_KEY,
} from './settings.ts';
import { SettingsState } from './settingsState.svelte.ts';

function memory(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  } as unknown as Storage;
}

const broken = (): Storage => {
  throw new Error('blocked');
};

afterEach(() => {
  setReducedMotion(null);
});

describe('loadSettings and saveSettings', () => {
  it('starts from the defaults: 100 %, the system motion, the scene once a session', () => {
    expect(loadSettings(() => memory())).toEqual({
      scale: 100,
      motion: 'system',
      intro: 'session',
    });
  });

  it('reads back what it saved', () => {
    const store = memory();
    saveSettings(() => store, { scale: 150, motion: 'reduced', intro: 'off' });
    expect(loadSettings(() => store)).toEqual({ scale: 150, motion: 'reduced', intro: 'off' });
  });

  it('takes the default for a damaged or unknown value, field by field', () => {
    const store = memory({
      [SETTINGS_STORAGE_KEY]: JSON.stringify({ scale: 175, motion: 'full', intro: 7 }),
    });
    expect(loadSettings(() => store)).toEqual({ scale: 100, motion: 'full', intro: 'session' });
    expect(loadSettings(() => memory({ [SETTINGS_STORAGE_KEY]: '{not json' }))).toEqual(
      DEFAULT_SETTINGS,
    );
    expect(loadSettings(() => memory({ [SETTINGS_STORAGE_KEY]: 'null' }))).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it('works without a storage: the defaults, and saving does not throw', () => {
    expect(loadSettings(broken)).toEqual(DEFAULT_SETTINGS);
    expect(() => {
      saveSettings(broken, DEFAULT_SETTINGS);
    }).not.toThrow();
  });
});

describe('the values the page takes', () => {
  it('motion: system leaves the media query in charge, the others override it', () => {
    expect(motionOverride('system')).toBeNull();
    expect(motionOverride('full')).toBe(false);
    expect(motionOverride('reduced')).toBe(true);
  });

  it('scale: the root variable is a plain number', () => {
    expect(scaleValue(100)).toBe('1');
    expect(scaleValue(125)).toBe('1.25');
    expect(scaleValue(150)).toBe('1.5');
  });
});

describe('SettingsState', () => {
  it('applies the saved settings to the root and the canvas code at once', () => {
    const root = document.createElement('div');
    const store = memory({
      [SETTINGS_STORAGE_KEY]: JSON.stringify({ scale: 125, motion: 'reduced', intro: 'off' }),
    });
    const state = new SettingsState(() => store, root);
    expect(state.intro).toBe('off');
    expect(root.style.getPropertyValue('--ui-scale')).toBe('1.25');
    expect(root.dataset.motion).toBe('reduced');
    expect(reducedMotion()).toBe(true);
  });

  it('a change is remembered and applied', () => {
    const root = document.createElement('div');
    const store = memory();
    const state = new SettingsState(() => store, root);
    expect(root.dataset.motion).toBe('full');
    state.set({ motion: 'reduced', scale: 150 });
    expect(root.dataset.motion).toBe('reduced');
    expect(root.style.getPropertyValue('--ui-scale')).toBe('1.5');
    expect(loadSettings(() => store)).toEqual({ scale: 150, motion: 'reduced', intro: 'session' });
    state.set({ motion: 'full' });
    expect(reducedMotion()).toBe(false);
    expect(root.dataset.motion).toBe('full');
  });

  it('keeps working without a storage', () => {
    const root = document.createElement('div');
    const state = new SettingsState(broken, root);
    state.set({ intro: 'off' });
    expect(state.intro).toBe('off');
  });
});
