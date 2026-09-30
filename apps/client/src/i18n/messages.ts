import type { ru } from './ru.ts';

/** A UI string key. The ru dictionary is the reference set of keys. */
export type MessageKey = keyof typeof ru;

/** The shape every dictionary must have: exactly the keys of ru. */
export type Messages = Readonly<Record<MessageKey, string>>;
