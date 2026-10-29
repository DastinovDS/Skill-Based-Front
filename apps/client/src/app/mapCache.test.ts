import { describe, expect, it, vi } from 'vitest';
import { ApiError, type Api, type MapSummary } from '../api/http.ts';
import type { MapFile } from '../protocol.gen.ts';
import { MapCache } from './mapCache.svelte.ts';

const summary = (id: string): MapSummary => ({
  id,
  version: 1,
  width: 10,
  height: 10,
  background_url: null,
});
const file = (id: string): MapFile => ({ meta: { name: id } }) as MapFile;

describe('MapCache (#473)', () => {
  it('asks for the pool once and shares the answer', async () => {
    const maps = vi.fn(() => Promise.resolve([summary('a'), summary('b')]));
    const cache = new MapCache({ maps } as unknown as Api);
    await Promise.all([cache.load(), cache.load()]);
    await cache.load();
    expect(maps).toHaveBeenCalledTimes(1);
    expect(cache.list?.map((m) => m.id)).toEqual(['a', 'b']);
    expect(cache.failed).toBe(false);
  });

  it('says the list failed and asks again on the next call', async () => {
    const maps = vi
      .fn<() => Promise<MapSummary[]>>()
      .mockRejectedValueOnce(new ApiError('network', 0))
      .mockResolvedValue([summary('a')]);
    const cache = new MapCache({ maps } as unknown as Api);
    await cache.load();
    expect(cache.failed).toBe(true);
    expect(cache.list).toBeNull();
    await cache.load();
    expect(cache.failed).toBe(false);
    expect(cache.list).toHaveLength(1);
  });

  it('fetches each file once, also when two screens ask at the same time', async () => {
    const map = vi.fn((id: string) => Promise.resolve(file(id)));
    const cache = new MapCache({ map } as unknown as Api);
    const [one, two] = await Promise.all([cache.ensure('a'), cache.ensure('a')]);
    expect(one).toBe(two);
    await cache.ensure('a');
    expect(map).toHaveBeenCalledTimes(1);
    expect(cache.get('a')).toBe(one);
    expect(cache.get('b')).toBeNull();
  });

  it('gives null for a file it cannot load and tries again later', async () => {
    const map = vi
      .fn<(id: string) => Promise<MapFile>>()
      .mockRejectedValueOnce(new ApiError('network', 0))
      .mockResolvedValue(file('a'));
    const cache = new MapCache({ map } as unknown as Api);
    expect(await cache.ensure('a')).toBeNull();
    expect(cache.get('a')).toBeNull();
    expect(await cache.ensure('a')).not.toBeNull();
  });
});
