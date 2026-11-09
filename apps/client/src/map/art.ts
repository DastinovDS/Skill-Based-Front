/**
 * The art of a map beside its graph: the baked background and the geography (DEC-36). The server
 * says both in the summary of any map it serves, `GET /api/maps/{id}/summary` (#884): a pool map,
 * a stored generated one and a map made for one match (`live-...`), which is never bundled and
 * never in `GET /api/maps`. The bundled vector file stays the first choice of the geography (no
 * request); `geo_url` is asked only for a map without one.
 */
import type { Api, MapSummary } from '../api/http.ts';
import type { MapFile } from '../protocol.gen.ts';
import { geoOf, usableGeo, type GeoFile } from './geography.ts';

export interface MapArt {
  /** The baked background, or null: the map is drawn with the flat terrain colours. */
  readonly backgroundUrl: string | null;
  /** The areas of the nodes, or null: the Voronoi cells of the graph. */
  readonly geo: GeoFile | null;
}

export type ArtApi = Pick<Api, 'mapSummary' | 'mapGeo'>;

/** The summary of a map, or null when it cannot be had (a map gone with its replay, no network). */
export async function summaryOf(api: ArtApi, mapId: string): Promise<MapSummary | null> {
  try {
    return await api.mapSummary(mapId);
  } catch {
    return null;
  }
}

/**
 * The art of `file` as its summary states it. `strict` (a match): a geography the summary names
 * that cannot be loaded or does not fit throws, so the screen offers to try again instead of
 * drawing Voronoi areas under a background baked for the real ones. Otherwise (a replay of an old
 * match) whatever can be had.
 */
export async function artOf(
  api: ArtApi | null,
  file: MapFile,
  summary: MapSummary | null,
  strict = false,
): Promise<MapArt> {
  const backgroundUrl = summary?.background_url ?? null;
  const bundled = await geoOf(file);
  const geoUrl = summary?.geo_url ?? null;
  if (bundled !== null || api === null || geoUrl === null) return { backgroundUrl, geo: bundled };
  let geo: GeoFile | null = null;
  try {
    geo = usableGeo(file, await api.mapGeo(geoUrl));
  } catch (error) {
    if (strict) throw error;
  }
  if (geo === null && strict) throw new Error(`the geography of ${file.meta.name} does not fit`);
  return { backgroundUrl, geo };
}

/**
 * The map of a running match with its art. The graph is needed; so is the summary of a map the
 * client does not bundle (a per-match map has its background and its areas only there). A pool
 * map whose summary fails is drawn with its bundled areas and no background, as before #884.
 */
export async function loadMatchMap(
  api: ArtApi & Pick<Api, 'map'>,
  mapId: string,
): Promise<{ readonly file: MapFile } & MapArt> {
  const summary = api.mapSummary(mapId).then(
    (found) => ({ found, error: null }),
    (error: unknown) => ({ found: null, error }),
  );
  const file = await api.map(mapId);
  const { found, error } = await summary;
  if (found !== null) return { file, ...(await artOf(api, file, found, true)) };
  // The bundled geography of a pool map is enough to play; a per-match map has none.
  if (isMatchMap(mapId)) throw error;
  return { file, backgroundUrl: null, geo: await geoOf(file) };
}

/** The id prefix the server reserves for the maps it makes for one match (#884). */
export const MATCH_MAP_PREFIX = 'live-';

export function isMatchMap(mapId: string): boolean {
  return mapId.startsWith(MATCH_MAP_PREFIX);
}
