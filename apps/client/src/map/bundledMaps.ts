import type { MapFile } from '../protocol.gen.ts';
import { usableGeo, type GeoFile } from './geography.ts';

// Maps bundled into the client for the dev screen and the tests (CLI-05, #496: only they import this
// module, so a production build contains none of it; the game takes the map and its background
// from the server, `GET /api/maps/{id}` and `MapSummary.background_url`).
// The maps of the server pool `maps/*.json` (DEC-27) and the MVP maps that stay as test fixtures in `maps/fixtures/` (#372) come first (all sorted by name), then the tiny
// test maps of the simulation (MAP-01, #13). The files stay where they are, Vite bundles them from
// there (see `server.fs.allow` in vite.config.ts).
const mvpFiles = import.meta.glob<MapFile>(
  ['../../../../maps/*.json', '../../../../maps/fixtures/*.json'],
  {
    eager: true,
    import: 'default',
  },
);
const testFiles = import.meta.glob<MapFile>('../../../../packages/sim/tests/maps/*.json', {
  eager: true,
  import: 'default',
});

function byName(files: Record<string, MapFile>): MapFile[] {
  return Object.values(files).sort((a, b) => a.meta.name.localeCompare(b.meta.name));
}

const mvpMaps = byName(mvpFiles);
const testMaps = byName(testFiles);

export const BUNDLED_MAPS: readonly MapFile[] = [...mvpMaps, ...testMaps];

/** The map the dev screen opens with: the first MVP map, or the "choke" test map before MAP-04. */
export const DEFAULT_MAP: MapFile = (() => {
  const map = mvpMaps[0] ?? testMaps.find((m) => m.meta.name === 'choke') ?? testMaps[0];
  if (map === undefined) {
    throw new Error(
      'no maps are bundled: maps/*.json and packages/sim/tests/maps/*.json are empty',
    );
  }
  return map;
})();

// Baked backgrounds `maps/<id>.bg.webp` (MAP-05, #70, #344), those of the fixtures in `maps/fixtures/`.
// The dev screen takes them from the repository through Vite.
const backgrounds = import.meta.glob<string>(
  ['../../../../maps/*.bg.webp', '../../../../maps/fixtures/*.bg.webp'],
  {
    eager: true,
    import: 'default',
    query: '?url',
  },
);

/** URL of the baked background of a bundled map, or `null` if it has none (the test maps). */
export function backgroundUrl(mapName: string): string | null {
  const found = Object.entries(backgrounds).find(([path]) => path.endsWith(`/${mapName}.bg.webp`));
  return found === undefined ? null : found[1];
}

// The vector files `maps/geo/<id>.json` of the maps with a geography (DEC-36, #544), eagerly for
// the dev screen (the game loads them lazily, `geography.ts`).
const geographies = import.meta.glob<unknown>('../../../../maps/geo/*.json', {
  eager: true,
  import: 'default',
});

/** The vector file of a bundled map, or `null` if it has none or the file does not fit the map. */
export function bundledGeo(map: MapFile): GeoFile | null {
  const found = Object.entries(geographies).find(([path]) =>
    path.endsWith(`/${map.meta.name}.json`),
  );
  return found === undefined ? null : usableGeo(map, found[1]);
}
