import type { en } from './en.ts';

/** A UI string key. The en dictionary is the reference set of keys. */
export type MessageKey = keyof typeof en;

/** The shape every dictionary must have: exactly the keys of en. */
export type Messages = Readonly<Record<MessageKey, string>>;
