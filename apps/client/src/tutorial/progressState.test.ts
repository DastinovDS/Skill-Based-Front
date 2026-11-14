// The progress of the account on the client (#806, docs/design/tutorial.md section 7.8): loaded
// from the server, the flags sent in order, the old browser key imported once.
import { describe, expect, it, vi } from 'vitest';
import type { Api, TutorialFlagsWire, TutorialProgressWire } from '../api/http.ts';
import { TutorialProgressState } from './progressState.svelte.ts';

const WIRE: TutorialProgressWire = {
  done: [],
  offer_off: false,
  first_match: false,
  first_match_id: null,
  hints: [],
  hints_off: false,
};

function memory(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  } as unknown as Storage;
}

function server(stored: TutorialProgressWire = WIRE) {
  const saved: TutorialFlagsWire[] = [];
  const api = {
    tutorialProgress: vi.fn(() => Promise.resolve(stored)),
    saveTutorialFlags: vi.fn((_token: string, flags: TutorialFlagsWire) => {
      saved.push(flags);
      return Promise.resolve(stored);
    }),
  };
  return { api: api as unknown as Api, saved, spy: api };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('TutorialProgressState', () => {
  it('shows what the server has and writes only the flags, in order', async () => {
    const { api, saved } = server({ ...WIRE, done: ['units'], hints: ['H1'] });
    const state = new TutorialProgressState(api, () => memory());
    await state.load('t');
    expect(state.current.done).toEqual(['units']);
    state.hintShown('H2');
    state.turnHintsOff();
    state.complete('economy'); // shown at once, the server records it itself
    await flush();
    expect(state.current.done).toEqual(['units', 'economy']);
    expect(saved.map((f) => [f.hints, f.hints_off, f.import_done])).toEqual([
      [['H1', 'H2'], false, []],
      [['H1', 'H2'], true, []],
    ]);
  });

  it('survives a server that cannot be reached', async () => {
    const api = {
      tutorialProgress: () => Promise.reject(new Error('down')),
      saveTutorialFlags: () => Promise.reject(new Error('down')),
    } as unknown as Api;
    const state = new TutorialProgressState(api, () => memory());
    await state.load('t');
    expect(state.current.done).toEqual([]);
    state.turnOfferOff();
    await flush();
    expect(state.current.offerOff).toBe(true);
  });

  it('sends the old browser progress once when the account has none, then drops the key', async () => {
    const storage = memory({
      'sbf.tutorial': JSON.stringify({ done: ['units', 'economy'], hintsOff: true }),
    });
    const { api, saved } = server();
    const state = new TutorialProgressState(api, () => storage);
    await state.load('t');
    expect(saved).toHaveLength(1);
    expect(saved[0]?.import_done).toEqual(['units', 'economy']);
    expect(saved[0]?.hints_off).toBe(true);
    expect(state.current.done).toEqual(['units', 'economy']);
    expect(storage.getItem('sbf.tutorial')).toBeNull();
    // A second load finds no key: nothing more is sent.
    await state.load('t');
    expect(saved).toHaveLength(1);
  });

  it('ignores the old key when the account already has progress, and drops it', async () => {
    const storage = memory({ 'sbf.tutorial': JSON.stringify({ done: ['units'] }) });
    const { api, saved } = server({ ...WIRE, offer_off: true });
    const state = new TutorialProgressState(api, () => storage);
    await state.load('t');
    expect(saved).toHaveLength(0);
    expect(state.current.done).toEqual([]);
    expect(storage.getItem('sbf.tutorial')).toBeNull();
  });

  it('keeps the old key when the server did not take the import', async () => {
    const storage = memory({ 'sbf.tutorial': JSON.stringify({ done: ['units'] }) });
    const api = {
      tutorialProgress: () => Promise.resolve(WIRE),
      saveTutorialFlags: () => Promise.reject(new Error('down')),
    } as unknown as Api;
    const state = new TutorialProgressState(api, () => storage);
    await state.load('t');
    expect(storage.getItem('sbf.tutorial')).not.toBeNull();
  });

  it('starts empty for the next account after clear', async () => {
    const { api } = server({ ...WIRE, done: ['units'] });
    const state = new TutorialProgressState(api, () => memory());
    await state.load('t');
    state.clear();
    expect(state.current.done).toEqual([]);
  });
});
