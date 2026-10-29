import type { MapSummary } from '../api/http.ts';

/**
 * The URL of the baked background of a pool map, as the server states it
 * (`MapSummary.background_url`, `/api/maps/{id}/background.webp`), or `null` if the map has none,
 * left the pool (an old replay) or the list could not be loaded. A missing picture is not fatal:
 * the map is drawn with the flat terrain colours.
 */
export async function backgroundUrlOf(
  api: { maps: () => Promise<MapSummary[]> },
  mapId: string,
): Promise<string | null> {
  try {
    const pool = await api.maps();
    return pool.find((m) => m.id === mapId)?.background_url ?? null;
  } catch {
    return null;
  }
}
