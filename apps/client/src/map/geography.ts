/**
 * The vector file of a map with a geography (DEC-36, #544): `maps/geo/<id>.json`, written by
 * `gow-maps bake` next to the baked background (format: docs/design/map-format.md, "Format changes
 * under DEC-36"). The client reads only the shared border chains: the areas of the nodes come from
 * them instead of the Voronoi cells, so the tint, the borders, the fog veil and a click agree with
 * the ground the baker painted. Water, rivers and bridges are part of the picture and need no
 * client code.
 *
 * Pure functions, no PixiJS. The loader of the bundled files is at the end.
 */
import type { MapFile } from '../protocol.gen.ts';

/** A region on one side of a chain: a node id, a water cell `w<k>`, `river`, or `-1` (outside the map). */
export type GeoLabel = number | string;

/** A stretch of border between two regions, from junction to junction. */
export interface GeoChain {
  /** The region on the left of the walk from the first point (the y axis points down). */
  readonly l: GeoLabel;
  readonly r: GeoLabel;
  /** Flat `[x0, y0, x1, y1, ...]` in world units. */
  readonly pts: readonly number[];
}

export interface GeoFile {
  readonly map: string;
  /** `meta.version` of the map it was baked from. */
  readonly version: number;
  readonly chains: readonly GeoChain[];
}

const WATER_LABEL = /^w\d+$/;

function isLabel(value: unknown): value is GeoLabel {
  return (
    (typeof value === 'number' && Number.isInteger(value) && value >= -1) ||
    value === 'river' ||
    (typeof value === 'string' && WATER_LABEL.test(value))
  );
}

function isChain(value: unknown): value is GeoChain {
  if (typeof value !== 'object' || value === null) return false;
  const { l, r, pts } = value as Record<string, unknown>;
  return (
    isLabel(l) &&
    isLabel(r) &&
    Array.isArray(pts) &&
    pts.length >= 4 &&
    pts.length % 2 === 0 &&
    pts.every((p) => typeof p === 'number' && Number.isFinite(p))
  );
}

/**
 * The vector file of `map` from a parsed JSON value, or `null` if it is malformed, belongs to
 * another map or was baked from another `meta.version` (a stale file): the client then falls back
 * to the Voronoi cells, which never disagree with the map file itself.
 */
export function usableGeo(map: MapFile, raw: unknown): GeoFile | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { map: name, version, chains } = raw as Record<string, unknown>;
  if (name !== map.meta.name || version !== map.meta.version) return null;
  if (!Array.isArray(chains) || chains.length === 0 || !chains.every(isChain)) return null;
  return { map: name, version, chains };
}

// Lazy: one chunk per map, loaded on demand (the files are bundled at build time like the
// backgrounds, but the player needs only the map of the match). A directory without files is an
// empty record: the maps without a geography.
const files = import.meta.glob<unknown>(['../../../../maps/geo/*.json'], { import: 'default' });

/**
 * The geography of a pool map, or `null` if the map has none, its file is stale or malformed, or
 * the chunk failed to load: a missing geography is never fatal.
 */
export async function geoOf(map: MapFile): Promise<GeoFile | null> {
  const load = Object.entries(files).find(([path]) => path.endsWith(`/${map.meta.name}.json`))?.[1];
  if (load === undefined) return null;
  try {
    return usableGeo(map, await load());
  } catch {
    return null;
  }
}
