import { en } from './en.ts';
import type { Locale } from './locale.ts';
import { localeState } from './localeState.svelte.ts';
import type { MessageKey, Messages } from './messages.ts';

export type { Locale } from './locale.ts';
export { hasLocaleChoice, isLocale, LOCALES } from './locale.ts';
export type { MessageKey } from './messages.ts';

export const DICTIONARIES: Readonly<Record<Locale, Messages>> = { en };

/** The UI string for `key` in `locale`. An unknown key is a type error, not a runtime fallback. */
export function translate(locale: Locale, key: MessageKey): string {
  return DICTIONARIES[locale][key];
}

/** The UI string for `key` in the current language; markup that calls it follows a switch. */
export function t(key: MessageKey): string {
  return translate(localeState.current, key);
}

/**
 * `t(key)` with `{name}` placeholders filled from `values`. A placeholder without a value stays
 * as it is. Whole sentences take values, so a language can order the words its own way.
 */
export function tf(key: MessageKey, values: Readonly<Record<string, string | number>>): string {
  return t(key).replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

/** The current UI language. */
export function getLocale(): Locale {
  return localeState.current;
}

/** Switches the UI language and remembers the choice for the next visit. */
export function setLocale(locale: Locale): void {
  localeState.current = locale;
}
