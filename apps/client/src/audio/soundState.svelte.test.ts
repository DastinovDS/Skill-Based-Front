import { describe, expect, it, vi } from 'vitest';
import { SoundEngine } from './engine.ts';
import { DEFAULT_PREFS, SOUND_STORAGE_KEY, loadPrefs } from './prefs.ts';
import { SoundState } from './soundState.svelte.ts';

function memory(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  } as unknown as Storage;
}

function engineSpy() {
  const engine = new SoundEngine(() => null);
  const play = vi.spyOn(engine, 'play');
  const volume = vi.spyOn(engine, 'setVolume');
  return { engine, play, volume };
}

describe('SoundState', () => {
  it('starts from the defaults and plays', () => {
    const { engine, play } = engineSpy();
    const state = new SoundState(engine, () => memory());
    expect(state.muted).toBe(false);
    expect(state.volume).toBe(DEFAULT_PREFS.volume);
    state.play('capture');
    expect(play).toHaveBeenCalledWith('capture');
  });

  it('plays nothing when muted or at volume 0', () => {
    const { engine, play } = engineSpy();
    const state = new SoundState(engine, () => memory());
    state.toggleMute();
    state.play('capture');
    state.toggleMute();
    state.setVolume(0);
    state.play('capture');
    expect(play).not.toHaveBeenCalled();
  });

  it('remembers the mute and the volume per browser', () => {
    const store = memory();
    const first = new SoundState(engineSpy().engine, () => store);
    first.toggleMute();
    first.setVolume(35);
    const { engine, volume } = engineSpy();
    const second = new SoundState(engine, () => store);
    expect([second.muted, second.volume]).toEqual([true, 35]);
    expect(volume).toHaveBeenCalledWith(0.35);
  });

  it('clamps the volume', () => {
    const state = new SoundState(engineSpy().engine, () => memory());
    state.setVolume(250);
    expect(state.volume).toBe(100);
    state.setVolume(-3);
    expect(state.volume).toBe(0);
  });

  it('works without a usable storage', () => {
    const broken = (): Storage => {
      throw new Error('blocked');
    };
    const state = new SoundState(engineSpy().engine, broken);
    expect(() => {
      state.toggleMute();
      state.setVolume(10);
    }).not.toThrow();
    expect(state.muted).toBe(true);
  });
});

describe('loadPrefs', () => {
  it('ignores garbage', () => {
    for (const raw of ['not json', 'null', '"x"', '{"muted":"yes","volume":"loud"}']) {
      const store = memory();
      store.setItem(SOUND_STORAGE_KEY, raw);
      expect(loadPrefs(() => store)).toEqual(DEFAULT_PREFS);
    }
  });
});
