/**
 * The keys the settings list (#871): the mockup's short list (out-of-game-style-r2.html, `help`),
 * every one a real binding of the client in every ruleset: `Enter` the main action of a screen
 * (the plinth of PlayScreen, ResultScreen), `Esc` back or close (the screens, the overlays, the HUD),
 * `?` the help of a match and `M` the sound (hud/hudKeys.ts), `Space` the camera to the alert and
 * `S` the split of a group (match/orderController.ts, hud/AlertStack.svelte). The whole list of a
 * match is its help (`?`). The key names are not translated, as in the help of a match.
 *
 * `M`, `Space` and `S` are rebindable (#966): their row names the action and shows its current
 * key; the full list is the keys dialog (`KeysDialog.svelte`).
 */
import type { MessageKey } from '../i18n/index.ts';
import type { KeyAction } from './keyBindings.ts';

/** A row: a fixed key by its name, or a rebindable action shown with its binding. */
export type SettingsKey = readonly [string | { readonly action: KeyAction }, MessageKey];

export const SETTINGS_KEYS: readonly SettingsKey[] = [
  ['Enter', 'settings.key.enter'],
  ['Esc', 'settings.key.escape'],
  ['?', 'settings.key.help'],
  [{ action: 'mute' }, 'settings.key.mute'],
  [{ action: 'alert' }, 'settings.key.alert'],
  [{ action: 'split' }, 'settings.key.split'],
];

/** The fixed keys the keys dialog lists under the rebindable ones (names, not translations). */
export const FIXED_KEYS: readonly (readonly [string, MessageKey])[] = [
  ['Shift + LMB', 'keys.fixed.select'],
  ['1 … 9', 'keys.fixed.menu'],
  ['? F1', 'keys.fixed.help'],
  ['Esc', 'keys.fixed.escape'],
  ['Enter', 'keys.fixed.enter'],
];
