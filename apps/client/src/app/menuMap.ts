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
