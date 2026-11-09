/**
 * The display settings of the viewer (#871), kept per browser: the interface scale, the motion
 * choice and the opening scene. Plain TypeScript: loading, saving and the values the document takes.
 * `localStorage` may be missing or throw (private mode, blocked site data): then the defaults hold
 * until the page closes. The sound has its own store (`audio/prefs.ts`), the language its own
 * (`i18n/locale.ts`).
 */

/** The interface scale in percent. */
export const UI_SCALES = [100, 125, 150] as const;
export type UiScale = (typeof UI_SCALES)[number];

/** `system` follows `prefers-reduced-motion`; the other two override it. */
export const MOTIONS = ['system', 'full', 'reduced'] as const;
export type Motion = (typeof MOTIONS)[number];

/** The opening scene of the entry screen: once a browser session, or never. */
export const INTRO_CHOICES = ['session', 'off'] as const;
export type IntroChoice = (typeof INTRO_CHOICES)[number];

export interface Settings {
  readonly scale: UiScale;
  readonly motion: Motion;
  readonly intro: IntroChoice;
}

export const SETTINGS_STORAGE_KEY = 'sbf.settings';
export const DEFAULT_SETTINGS: Settings = { scale: 100, motion: 'system', intro: 'session' };

function oneOf<T>(choices: readonly T[], value: unknown, fallback: T): T {
  return choices.find((choice) => choice === value) ?? fallback;
}

/** The saved settings; a missing, damaged or unknown value takes its default. */
export function loadSettings(storage: () => Storage): Settings {
  try {
    const raw = storage().getItem(SETTINGS_STORAGE_KEY);
    if (raw === null) return DEFAULT_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_SETTINGS;
    const { scale, motion, intro } = parsed as Record<string, unknown>;
    return {
      scale: oneOf(UI_SCALES, scale, DEFAULT_SETTINGS.scale),
      motion: oneOf(MOTIONS, motion, DEFAULT_SETTINGS.motion),
      intro: oneOf(INTRO_CHOICES, intro, DEFAULT_SETTINGS.intro),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(storage: () => Storage, settings: Settings): void {
  try {
    storage().setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Not remembered: the next visit starts from the defaults.
  }
}

/** The override of `render/motion.ts`: `null` leaves the system setting in charge. */
export function motionOverride(motion: Motion): boolean | null {
  return motion === 'system' ? null : motion === 'reduced';
}

/** The value of the root CSS variable `--ui-scale` (a plain number, 1.25 for 125 %). */
export function scaleValue(scale: UiScale): string {
  return String(scale / 100);
}
