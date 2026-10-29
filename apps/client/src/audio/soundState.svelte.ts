/** The mute switch and the volume, remembered per browser (#71). Markup reads `muted` and `volume`. */
import { SoundEngine } from './engine.ts';
import { clampVolume, loadPrefs, savePrefs } from './prefs.ts';
import type { SoundId } from './recipes.ts';

const storage = (): Storage => window.localStorage;

export class SoundState {
  muted = $state(false);
  /** 0..100. */
  volume = $state(60);
  readonly #engine: SoundEngine;
  readonly #storage: () => Storage;

  constructor(engine: SoundEngine, store: () => Storage = storage) {
    this.#engine = engine;
    this.#storage = store;
    const prefs = loadPrefs(store);
    this.muted = prefs.muted;
    this.volume = prefs.volume;
    this.#engine.setVolume(this.volume / 100);
  }

  toggleMute(): void {
    this.muted = !this.muted;
    this.#save();
  }

  setVolume(value: number): void {
    this.volume = clampVolume(value);
    this.#engine.setVolume(this.volume / 100);
    this.#save();
  }

  /** Plays unless muted or at volume 0. */
  play(id: SoundId): void {
    if (this.muted || this.volume === 0) return;
    this.#engine.play(id);
  }

  #save(): void {
    savePrefs(this.#storage, { muted: this.muted, volume: this.volume });
  }
}

/** The one switch of the page. */
export const sound = new SoundState(
  new SoundEngine(() => (typeof AudioContext === 'function' ? new AudioContext() : null)),
);
