import type { MapFile } from '../protocol.gen.ts';

// Maps bundled into the client for the dev screen, until the lobby loads them from the server
// (`GET /api/maps/{id}`). The maps of the server pool `maps/*.json` (DEC-27) and the MVP maps that
// stay as test fixtures in `maps/fixtures/` (#372) come first (all sorted by name), then the tiny
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
// The server serves the pool ones at `/api/maps/{id}/background.webp`; the dev screen takes them
// from the repository through Vite.
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
