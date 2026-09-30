import { en } from './en.ts';
import type { Locale } from './locale.ts';
import { localeState } from './localeState.svelte.ts';
import type { MessageKey, Messages } from './messages.ts';
import { ru } from './ru.ts';

export type { Locale } from './locale.ts';
export { isLocale, LOCALES } from './locale.ts';
export type { MessageKey } from './messages.ts';

export const DICTIONARIES: Readonly<Record<Locale, Messages>> = { ru, en };

/** The UI string for `key` in `locale`. An unknown key is a type error, not a runtime fallback. */
export function translate(locale: Locale, key: MessageKey): string {
  return DICTIONARIES[locale][key];
}

/** The UI string for `key` in the current language; markup that calls it follows a switch. */
export function t(key: MessageKey): string {
  return translate(localeState.current, key);
}

/** The current UI language. */
export function getLocale(): Locale {
  return localeState.current;
}

/** Switches the UI language and remembers the choice for the next visit. */
export function setLocale(locale: Locale): void {
  localeState.current = locale;
}
