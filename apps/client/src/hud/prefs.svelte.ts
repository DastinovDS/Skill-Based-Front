/**
 * Small per-player settings the match HUD reads and writes: for now the sound switch of the top
 * bar (package F builds the sound itself and the settings screen on top of this). Stored in
 * `localStorage`; every access is guarded, the HUD works without it.
 */
const SOUND_KEY = 'gow.sound';

function load(storage: () => Storage): boolean {
  try {
    return storage().getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

export class HudPrefs {
  /** The sound switch of the top bar; on by default (owner decision). */
  soundOn = $state(true);

  readonly #storage: () => Storage;

  constructor(storage: () => Storage = () => localStorage) {
    this.#storage = storage;
    this.soundOn = load(storage);
  }

  toggleSound(): void {
    this.soundOn = !this.soundOn;
    try {
      this.#storage().setItem(SOUND_KEY, this.soundOn ? 'on' : 'off');
    } catch {
      // A blocked storage only forgets the choice.
    }
  }
}
