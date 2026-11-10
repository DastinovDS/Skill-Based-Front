/**
 * The keys the settings list (#871): the mockup's short list (out-of-game-style-r2.html, `help`),
 * every one a real binding of the client in every ruleset: `Enter` the main action of a screen
 * (the plinth of PlayScreen, ResultScreen), `Esc` back or close (the screens, the overlays, the HUD),
 * `?` the help of a match and `M` the sound (hud/hudKeys.ts), `Space` the camera to the alert and
 * `S` the split of a group (match/orderController.ts, hud/AlertStack.svelte). The whole list of a
 * match is its help (`?`). The key names are not translated, as in the help of a match.
 */
import type { MessageKey } from '../i18n/index.ts';

export const SETTINGS_KEYS: readonly (readonly [string, MessageKey])[] = [
  ['Enter', 'settings.key.enter'],
  ['Esc', 'settings.key.escape'],
  ['?', 'settings.key.help'],
  ['M', 'settings.key.mute'],
  ['Space', 'settings.key.alert'],
  ['S', 'settings.key.split'],
];
