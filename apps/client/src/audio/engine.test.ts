import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_VOICES, MERGE_S, SoundEngine } from './engine.ts';

function fakeContext() {
  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });
  const node = () => ({
    connect: vi.fn(),
    gain: param(),
    frequency: param(),
    start: vi.fn(),
    stop: vi.fn(),
    type: '',
  });
  const ctx = {
    currentTime: 0,
    state: 'running',
    destination: {},
    resume: vi.fn(() => Promise.resolve()),
    createOscillator: vi.fn(node),
    createGain: vi.fn(node),
  };
  return ctx;
}

describe('SoundEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('makes no context until a sound is played, and survives a missing one', () => {
    const make = vi.fn(() => null);
    const engine = new SoundEngine(make);
    expect(make).not.toHaveBeenCalled();
    expect(() => {
      engine.play('capture');
    }).not.toThrow();
  });

  it('merges the same sound within 150 ms', () => {
    const ctx = fakeContext();
    const engine = new SoundEngine(() => ctx as unknown as AudioContext);
    engine.play('orderOk');
    ctx.currentTime = MERGE_S / 2;
    engine.play('orderOk');
    expect(ctx.createOscillator).toHaveBeenCalledTimes(1);
    ctx.currentTime = MERGE_S + 0.01;
    engine.play('orderOk');
    expect(ctx.createOscillator).toHaveBeenCalledTimes(2);
  });

  it('holds at most four sounds at once and frees a voice when it ends', () => {
    const ctx = fakeContext();
    const engine = new SoundEngine(() => ctx as unknown as AudioContext);
    const ids = ['capture', 'captureLost', 'unitLoss', 'fightRound', 'matchWin'] as const;
    for (const id of ids) engine.play(id);
    // matchWin has 3 tones, the others 1, 2 and 2 (the first four voices): the fifth was refused.
    const tones = ctx.createOscillator.mock.calls.length;
    expect(MAX_VOICES).toBe(4);
    expect(tones).toBe(2 + 2 + 1 + 2);
    vi.advanceTimersByTime(2000);
    ctx.currentTime = 5;
    engine.play('matchWin');
    expect(ctx.createOscillator.mock.calls.length).toBe(tones + 3);
  });

  it('applies the master volume, also set before the context exists', () => {
    const ctx = fakeContext();
    const engine = new SoundEngine(() => ctx as unknown as AudioContext);
    engine.setVolume(0.3);
    engine.play('orderOk');
    const master = ctx.createGain.mock.results[0]?.value as { gain: { value: number } };
    expect(master.gain.value).toBe(0.3);
    engine.setVolume(0.7);
    expect(master.gain.value).toBe(0.7);
  });
});
