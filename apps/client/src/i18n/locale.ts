/** UI languages of the client. The first one is the fallback for any other browser language. */
export const LOCALES = ['en', 'ru'] as const;

export type Locale = (typeof LOCALES)[number];

/** localStorage key of the language the viewer picked. */
export const LOCALE_STORAGE_KEY = 'sbf.locale';

export function isLocale(value: unknown): value is Locale {
  return LOCALES.some((locale) => locale === value);
}

/** The first supported language in the browser's preference list (`ru-RU` → `ru`), else `en`. */
export function pickLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const base = language.toLowerCase().split('-')[0];
    if (isLocale(base)) {
      return base;
    }
  }
  return LOCALES[0];
}

/**
 * The viewer's language: the saved choice, else the browser's languages. Storage may be missing or
 * throw (private mode, blocked site data), then the browser's languages decide.
 */
export function initialLocale(storage: () => Storage, languages: readonly string[]): Locale {
  try {
    const saved = storage().getItem(LOCALE_STORAGE_KEY);
    if (isLocale(saved)) {
      return saved;
    }
  } catch {
    // No storage: fall through to the browser's languages.
  }
  return pickLocale(languages);
}

/** Remembers the viewer's choice; a failing storage only means it is not remembered. */
export function saveLocale(storage: () => Storage, locale: Locale): void {
  try {
    storage().setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Not remembered: the next visit detects the language from the browser again.
  }
}
