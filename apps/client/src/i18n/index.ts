import { ru } from './ru.ts';

export type MessageKey = keyof typeof ru;

const dictionary: Readonly<Record<MessageKey, string>> = ru;

/** Returns the UI string for `key`. An unknown key is a type error, not a runtime fallback. */
export function t(key: MessageKey): string {
  return dictionary[key];
}
