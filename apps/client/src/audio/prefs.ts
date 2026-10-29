/** The sound choice of the viewer, kept per browser (#71). Storage may be missing or throw. */

export interface SoundPrefs {
  muted: boolean;
  /** 0..100. */
  volume: number;
}

export const SOUND_STORAGE_KEY = 'sbf.sound';
export const DEFAULT_PREFS: SoundPrefs = { muted: false, volume: 60 };

export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PREFS.volume;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function loadPrefs(storage: () => Storage): SoundPrefs {
  try {
    const raw = storage().getItem(SOUND_STORAGE_KEY);
    if (raw === null) return DEFAULT_PREFS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_PREFS;
    const { muted, volume } = parsed as Record<string, unknown>;
    return {
      muted: muted === true,
      volume: typeof volume === 'number' ? clampVolume(volume) : DEFAULT_PREFS.volume,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(storage: () => Storage, prefs: SoundPrefs): void {
  try {
    storage().setItem(SOUND_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Not remembered: the next visit starts from the defaults.
  }
}
