/** Shared by the tests of the main screen (#919): a context with fake maps and recorded actions. */
import { vi } from 'vitest';
import type { Api, MapSummary } from '../api/http.ts';
import type { MapFile } from '../protocol.gen.ts';
import { MapCache } from './mapCache.svelte.ts';
import type { PlayContext } from './play.ts';

const summary = (id: string): MapSummary => ({
  id,
  version: 1,
  width: 100,
  height: 100,
  background_url: null,
  generated: id.startsWith('gen'),
  per_match: false,
});
const file = (id: string): MapFile =>
  ({
    meta: { name: id, width: 100, height: 100 },
    nodes: [{ id: 0, x: 10, y: 10, kind: 'city', capital_of: 0, start_owner: 0 }],
    edges: [],
  }) as unknown as MapFile;

export function fakeMapApi(ids: readonly string[] = ['crossroads', 'ridge']): Partial<Api> {
  return {
    maps: () => Promise.resolve(ids.map(summary)),
    map: (id: string) => Promise.resolve(file(id)),
  };
}

export function makePlay(over: Partial<PlayContext> = {}, api: Partial<Api> = fakeMapApi()) {
  const calls = {
    onresume: vi.fn(),
    onway: vi.fn(),
    onsearch: vi.fn(),
    onbot: vi.fn<PlayContext['onbot']>(() => new Promise(() => undefined)),
    oninvite: vi.fn<PlayContext['oninvite']>(() => new Promise(() => undefined)),
    onstart: vi.fn(),
    onofferbot: vi.fn(),
    onbanned: vi.fn(),
    onleave: vi.fn(),
    onhelp: vi.fn(),
    onprofile: vi.fn(),
  };
  const ctx: PlayContext = {
    api: api as Api,
    token: 't',
    nick: 'Me',
    hasPassword: false,
    map: null,
    maps: new MapCache(api as Api),
    banUntil: null,
    hasActiveMatch: false,
    ...calls,
    ...over,
  };
  return { ctx, calls };
}
