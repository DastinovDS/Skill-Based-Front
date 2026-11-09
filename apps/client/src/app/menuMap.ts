import { usableGeo, type GeoFile } from '../map/geography.ts';
import type { MapFile } from '../protocol.gen.ts';

// The map behind the screens before a match (#474, MM1 "Valley" of docs/design/mockups/menu-background.html):
// `maps/menu/valley.json`, built from its half `maps/menu/src/valley.half.json` with `gow-maps mirror` and
// validated like the pool maps, but outside the server pool (the server reads `maps/*.json` only). It is
// bundled at build time (about 10 KB), so the picture is there on the first frame, without a request.
const files = import.meta.glob<MapFile>('../../../../maps/menu/valley.json', {
  eager: true,
  import: 'default',
});

/** The menu map; its file name and `meta.name` are `valley`. */
export const MENU_MAP: MapFile = (() => {
  const map = Object.values(files)[0];
  if (map === undefined) throw new Error('the menu map maps/menu/valley.json is missing');
  return map;
})();

// Its baked ground (`maps/menu/valley.bg.webp`, the Intaglio of #842, about 80 KB) and its vector
// file (`maps/menu/geo/valley.json`, the areas of the nodes), the same as a match on it would draw
// (#839): the ground is a URL fetched by the picture, the areas are bundled (about 12 KB).
const grounds = import.meta.glob<string>('../../../../maps/menu/valley.bg.webp', {
  eager: true,
  import: 'default',
  query: '?url',
});
const geographies = import.meta.glob<unknown>('../../../../maps/menu/geo/valley.json', {
  eager: true,
  import: 'default',
});

/** The URL of the menu map's baked ground, or null when it is missing (a flat stone then). */
export const MENU_GROUND: string | null = Object.values(grounds)[0] ?? null;

/** The menu map's vector file, or null when it is missing or does not fit the map. */
export const MENU_GEO: GeoFile | null = (() => {
  const raw = Object.values(geographies)[0];
  return raw === undefined ? null : usableGeo(MENU_MAP, raw);
})();
