import { describe, expect, it, vi } from 'vitest';
import { ApiError, type MapSummary } from '../api/http.ts';
import type { MapFile } from '../protocol.gen.ts';
import { BUNDLED_MAPS, bundledGeo } from './bundledMaps.ts';
import { artOf, isMatchMap, loadMatchMap, summaryOf } from './art.ts';

// A pool map with a bundled geography, and the same map under a per-match id (the server makes
// one like a generated map and renames it, #884): its vector file is not bundled.
const pool = BUNDLED_MAPS.find((m) => bundledGeo(m) !== null);
if (pool === undefined) throw new Error('no bundled map has a geography');
const LIVE = 'live-0123456789ab';
const live: MapFile = { ...pool, meta: { ...pool.meta, name: LIVE } };
const liveGeo = { ...bundledGeo(pool), map: LIVE };

const summaryFor = (id: string, over: Partial<MapSummary> = {}): MapSummary => ({
  id,
  version: 1,
  width: 100,
  height: 100,
  background_url: `/api/maps/${id}/background.webp`,
  generated: false,
  geo_url: `/api/maps/${id}/geo.json`,
  thumb_url: `/api/maps/${id}/thumb.webp`,
  per_match: isMatchMap(id),
  ...over,
});

function fakeApi(over: Partial<Record<'map' | 'mapSummary' | 'mapGeo', unknown>> = {}) {
  return {
    map: vi.fn((id: string) =>
      id === LIVE ? Promise.resolve(live) : Promise.resolve(pool as MapFile),
    ),
    mapSummary: vi.fn((id: string) => Promise.resolve(summaryFor(id))),
    mapGeo: vi.fn(() => Promise.resolve<unknown>(liveGeo)),
    ...over,
  } as {
    map: (id: string) => Promise<MapFile>;
    mapSummary: (id: string) => Promise<MapSummary>;
    mapGeo: (url: string) => Promise<unknown>;
  };
}

describe('loadMatchMap', () => {
  it('draws a per-match map with the background and the geography of its summary', async () => {
    const api = fakeApi();
    const loaded = await loadMatchMap(api, LIVE);
    expect(loaded.file.meta.name).toBe(LIVE);
    expect(loaded.backgroundUrl).toBe(`/api/maps/${LIVE}/background.webp`);
    expect(loaded.geo?.map).toBe(LIVE);
    expect(loaded.geo?.chains.length).toBeGreaterThan(0);
    expect(api.mapGeo).toHaveBeenCalledWith(`/api/maps/${LIVE}/geo.json`);
  });

  it('keeps the bundled geography of a pool map: no request for its vector file', async () => {
    const api = fakeApi();
    const loaded = await loadMatchMap(api, pool.meta.name);
    expect(loaded.backgroundUrl).toBe(`/api/maps/${pool.meta.name}/background.webp`);
    expect(loaded.geo).toEqual(bundledGeo(pool));
    expect(api.mapGeo).not.toHaveBeenCalled();
  });

  it('plays a pool map without its background when the summary fails', async () => {
    const api = fakeApi({ mapSummary: () => Promise.reject(new ApiError('network', 0)) });
    const loaded = await loadMatchMap(api, pool.meta.name);
    expect(loaded.backgroundUrl).toBeNull();
    expect(loaded.geo).toEqual(bundledGeo(pool));
  });

  it('fails (the screen offers to try again) rather than draw a per-match map with Voronoi areas', async () => {
    await expect(
      loadMatchMap(fakeApi({ mapSummary: () => Promise.reject(new ApiError('network', 0)) }), LIVE),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      loadMatchMap(fakeApi({ mapGeo: () => Promise.reject(new ApiError('not_found', 404)) }), LIVE),
    ).rejects.toBeInstanceOf(ApiError);
    // A vector file of another map, or of another version of it, does not fit.
    await expect(
      loadMatchMap(fakeApi({ mapGeo: () => Promise.resolve({ ...liveGeo, version: -1 }) }), LIVE),
    ).rejects.toThrow(/does not fit/);
  });

  it('fails when the map file itself fails', async () => {
    const api = fakeApi({ map: () => Promise.reject(new ApiError('not_found', 404)) });
    await expect(loadMatchMap(api, LIVE)).rejects.toBeInstanceOf(ApiError);
  });
});

describe('artOf (the replay viewer)', () => {
  it('takes the art of a per-match map from its summary', async () => {
    const api = fakeApi();
    const art = await artOf(api, live, summaryFor(LIVE));
    expect(art.backgroundUrl).toBe(`/api/maps/${LIVE}/background.webp`);
    expect(art.geo?.map).toBe(LIVE);
  });

  it('draws whatever it can when the map is gone or the server is away', async () => {
    const api = fakeApi({ mapGeo: () => Promise.reject(new ApiError('not_found', 404)) });
    expect(await artOf(api, live, summaryFor(LIVE))).toEqual({
      backgroundUrl: `/api/maps/${LIVE}/background.webp`,
      geo: null,
    });
    expect(await artOf(api, live, null)).toEqual({ backgroundUrl: null, geo: null });
    expect(await artOf(null, pool, null)).toEqual({ backgroundUrl: null, geo: bundledGeo(pool) });
  });

  it('is null for a summary that cannot be had', async () => {
    const api = fakeApi({ mapSummary: () => Promise.reject(new ApiError('not_found', 404)) });
    expect(await summaryOf(api, LIVE)).toBeNull();
    expect(await summaryOf(fakeApi(), LIVE)).toEqual(summaryFor(LIVE));
  });
});
