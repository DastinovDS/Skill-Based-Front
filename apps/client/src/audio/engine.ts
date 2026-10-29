/**
 * Plays the recipes with the Web Audio API (#71). The context is made on the first sound (a
 * browser lets it run after a click or a key, and the player has pressed one to start a match).
 * At most `MAX_VOICES` sounds at once; the same sound again within `MERGE_S` is dropped.
 */
import { RECIPES, type SoundId } from './recipes.ts';

export const MAX_VOICES = 4;
export const MERGE_S = 0.15;

export class SoundEngine {
  #ctx: AudioContext | null = null;
  #master: GainNode | null = null;
  #volume = 1;
  #voices = 0;
  readonly #last = new Map<SoundId, number>();
  readonly #make: () => AudioContext | null;

  constructor(make: () => AudioContext | null) {
    this.#make = make;
  }

  /** Master volume 0..1. */
  setVolume(volume: number): void {
    this.#volume = volume;
    if (this.#master !== null) this.#master.gain.value = volume;
  }

  play(id: SoundId): void {
    const ctx = this.#context();
    if (ctx === null || this.#master === null) return;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    const now = ctx.currentTime;
    const last = this.#last.get(id);
    if (last !== undefined && now - last < MERGE_S) return;
    if (this.#voices >= MAX_VOICES) return;
    this.#last.set(id, now);
    this.#voices += 1;
    let end = now;
    for (const tone of RECIPES[id]) {
      const start = now + tone.at;
      const stop = start + tone.dur;
      end = Math.max(end, stop);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = tone.wave;
      osc.frequency.setValueAtTime(tone.from, start);
      if (tone.to !== undefined) osc.frequency.exponentialRampToValueAtTime(tone.to, stop);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(tone.gain, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, stop);
      osc.connect(gain);
      gain.connect(this.#master);
      osc.start(start);
      osc.stop(stop + 0.02);
    }
    // The voice is free when the last tone is over.
    setTimeout(
      () => {
        this.#voices = Math.max(0, this.#voices - 1);
      },
      Math.ceil((end - now) * 1000) + 30,
    );
  }

  #context(): AudioContext | null {
    if (this.#ctx !== null) return this.#ctx;
    let ctx: AudioContext | null;
    try {
      ctx = this.#make();
    } catch {
      ctx = null;
    }
    if (ctx === null) return null;
    this.#ctx = ctx;
    this.#master = ctx.createGain();
    this.#master.gain.value = this.#volume;
    this.#master.connect(ctx.destination);
    return ctx;
  }
}
