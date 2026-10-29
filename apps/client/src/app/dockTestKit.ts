/** Shared by the tests of the Dock screens (#473): a context with fake maps and recorded exits. */
import { vi } from 'vitest';
import type { Api, MapSummary } from '../api/http.ts';
import type { MapFile } from '../protocol.gen.ts';
import type { DockContext } from './dock.ts';
import { MapCache } from './mapCache.svelte.ts';

const summary = (id: string): MapSummary => ({
  id,
  version: 1,
  width: 100,
  height: 100,
  background_url: null,
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

export function makeDock(over: Partial<DockContext> = {}, api: Partial<Api> = fakeMapApi()) {
  const calls = {
    onbot: vi.fn(),
    oncreate: vi.fn(),
    onlobby: vi.fn(),
    onmenu: vi.fn(),
    onpassword: vi.fn(),
    onlogout: vi.fn(),
  };
  const dock: DockContext = {
    nick: 'Me',
    hasPassword: true,
    calibration: null,
    banUntil: null,
    map: null,
    maps: new MapCache(api as Api),
    ...calls,
    ...over,
  };
  return { dock, calls };
}
