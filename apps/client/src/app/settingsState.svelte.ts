/**
 * The display settings of the page (#871), reactive and applied to the document at once:
 *
 * - the interface scale is the root CSS variable `--ui-scale` (front.css zooms the screens before
 *   and after a match with it);
 * - the motion choice overrides `prefers-reduced-motion` for the canvas code (`render/motion.ts`)
 *   and sets `data-motion="reduced" | "full"` on the root, which the stylesheets read instead of
 *   the media query; under `system` the attribute follows the media query when it changes;
 * - the opening scene choice is read by RootApp when the entry screen shows.
 */
import { reducedMotion, setReducedMotion } from '../render/motion.ts';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  motionOverride,
  saveSettings,
  scaleValue,
  type IntroChoice,
  type Motion,
  type Settings,
  type UiScale,
} from './settings.ts';

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

export class SettingsState {
  scale = $state<UiScale>(DEFAULT_SETTINGS.scale);
  motion = $state<Motion>(DEFAULT_SETTINGS.motion);
  intro = $state<IntroChoice>(DEFAULT_SETTINGS.intro);

  readonly #storage: () => Storage;
  readonly #root: HTMLElement | null;

  constructor(
    storage: () => Storage = () => window.localStorage,
    root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement,
  ) {
    this.#storage = storage;
    this.#root = root;
    const saved = loadSettings(storage);
    this.scale = saved.scale;
    this.motion = saved.motion;
    this.intro = saved.intro;
    this.apply();
    // The system setting can change while the page is open (and the shots emulate it).
    const query = typeof matchMedia === 'function' ? matchMedia(REDUCED_QUERY) : null;
    query?.addEventListener('change', () => {
      this.apply();
    });
  }

  /** Changes some settings, remembers them and applies them to the page. */
  set(patch: Partial<Settings>): void {
    if (patch.scale !== undefined) this.scale = patch.scale;
    if (patch.motion !== undefined) this.motion = patch.motion;
    if (patch.intro !== undefined) this.intro = patch.intro;
    saveSettings(this.#storage, { scale: this.scale, motion: this.motion, intro: this.intro });
    this.apply();
  }

  /** Puts the settings on the page: the canvas override, the root attribute and variable. */
  apply(): void {
    setReducedMotion(motionOverride(this.motion));
    const root = this.#root;
    if (root === null) return;
    root.style.setProperty('--ui-scale', scaleValue(this.scale));
    root.dataset.motion = reducedMotion() ? 'reduced' : 'full';
  }
}

/** The settings of the page. */
export const settings = new SettingsState();
