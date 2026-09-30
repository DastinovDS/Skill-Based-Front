import { initialLocale, saveLocale, type Locale } from './locale.ts';

const storage = (): Storage => window.localStorage;

/** The current UI language. Reading `current` in markup re-renders the markup when it changes. */
class LocaleState {
  #current = $state<Locale>(initialLocale(storage, navigator.languages));

  get current(): Locale {
    return this.#current;
  }

  set current(locale: Locale) {
    this.#current = locale;
    saveLocale(storage, locale);
    document.documentElement.lang = locale;
  }
}

export const localeState = new LocaleState();
document.documentElement.lang = localeState.current;
