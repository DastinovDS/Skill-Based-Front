import { expect } from 'vitest';
import type { EventMsg } from '../protocol.gen.ts';
import raw from '../../../../packages/protocol/vectors/event_fields.json';

/**
 * The fields of each event kind the server sends (`packages/protocol/vectors/event_fields.json`,
 * written from `EVENT_FIELDS` of `gow_protocol.convert`, ARC-02 #457). The event tests of the
 * consumers use it the way `event_kinds.json` is used for the kinds: an event a test builds may
 * only have declared fields, and what a consumer reads must be declared, so a field the server
 * renames or drops fails here and not silently in the game.
 */
const KINDS = (raw as { kinds: Record<string, { fields: string[]; ids: string[] }> }).kinds;

type Data = EventMsg['data'];

export function eventKinds(): string[] {
  return Object.keys(KINDS);
}

export function declaredFields(kind: string): ReadonlySet<string> {
  const entry = KINDS[kind];
  expect(entry, `${kind} is not an event kind of the server`).toBeDefined();
  return new Set(entry?.fields ?? []);
}

/** The data of an event as the server sends it: every declared field, an id as an opaque string. */
export function filledData(kind: string, overrides: Data = {}): Data {
  const entry = KINDS[kind];
  const fields = declaredFields(kind);
  for (const key of Object.keys(overrides)) expect(fields.has(key), `${kind}.${key}`).toBe(true);
  const data: Data = {};
  for (const field of entry?.fields ?? []) data[field] = entry?.ids.includes(field) ? 'oid' : 1;
  return { ...data, ...overrides };
}

export interface Tracked {
  readonly data: Data;
  /** The fields read so far. */
  readonly reads: Set<string>;
}

/**
 * `data` (all of whose keys must be declared for `kind`) wrapped so every field a consumer reads is
 * recorded: a destructuring, `data.x` and `data['x']` all count.
 */
export function tracked(kind: string, data: Data): Tracked {
  const fields = declaredFields(kind);
  for (const key of Object.keys(data)) expect(fields.has(key), `${kind}.${key}`).toBe(true);
  const reads = new Set<string>();
  const proxy = new Proxy(data, {
    get(target, key, receiver): unknown {
      if (typeof key === 'string') reads.add(key);
      return Reflect.get(target, key, receiver) as unknown;
    },
  });
  return { data: proxy, reads };
}

/** Every field in `reads` is one the server sends for `kind`. */
export function expectDeclared(kind: string, reads: ReadonlySet<string>): void {
  const fields = declaredFields(kind);
  for (const key of reads) expect(fields.has(key), `${kind}: the client reads "${key}"`).toBe(true);
}
