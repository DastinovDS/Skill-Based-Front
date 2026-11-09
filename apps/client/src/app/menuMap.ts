import { usableGeo, type GeoFile } from '../map/geography.ts';
import type { MapFile } from '../protocol.gen.ts';
import type { CaptureScript } from './menuCaptures.ts';

// The maps behind the screens before a match (#474, #866): two maps of `maps/menu/`, validated like
// the pool maps but outside the server pool (the server reads `maps/*.json` only), bundled at build
// time so the picture is there on the first frame:
// - `marches` (#866, generated from seed 112 and renamed), 48 nodes, behind the main screen, the
//   queue, the Dock screens, the result and the boards: laid out over the whole window, cropped;
// - `valley` (#474, built from its half `maps/menu/src/valley.half.json`), 25 nodes, behind the
//   entry screen and its opening scene (the five fights of `introBattles.ts` stand on its roads).
const files = import.meta.glob<MapFile>('../../../../maps/menu/*.json', {
  eager: true,
  import: 'default',
});
// Their baked grounds (the Intaglio of #842, fetched by the picture) and their vector files (the
// areas of the nodes, bundled), as a match on them would draw them (#839).
const grounds = import.meta.glob<string>('../../../../maps/menu/*.bg.webp', {
  eager: true,
  import: 'default',
  query: '?url',
});
const geographies = import.meta.glob<unknown>('../../../../maps/menu/geo/*.json', {
  eager: true,
  import: 'default',
});

const byName = <T>(record: Record<string, T>, name: string, suffix: string): T | undefined =>
  Object.entries(record).find(([path]) => path.endsWith(`/${name}${suffix}`))?.[1];

function mapNamed(name: string): MapFile {
  const map = byName(files, name, '.json');
  if (map === undefined) throw new Error(`the menu map maps/menu/${name}.json is missing`);
  return map;
}

/**
 * One map of the backdrop and what the picture plays on it: its baked ground, its areas, the
 * owners between captures and the loop of captures (`menuCaptures.ts`).
 */
export interface MenuWorld {
  readonly map: MapFile;
  /** The URL of the baked ground, or null when it is missing (a flat stone then). */
  readonly ground: string | null;
  /** The vector file, or null when it is missing or does not fit the map. */
  readonly geo: GeoFile | null;
  /**
   * The owners of the picture by node id, a front in mid game: the captures swing nodes of it
   * back and forth and always return to it. Decoration, not the start of a match.
   */
  readonly owners: readonly (0 | 1 | null)[];
  readonly script: CaptureScript;
}

/** A world of `map` whose owners are its start owners with `own`, `enemy` and `neutral` set. */
function world(
  map: MapFile,
  front: {
    readonly own: readonly number[];
    readonly enemy: readonly number[];
    readonly neutral?: readonly number[];
  },
  script: CaptureScript,
): MenuWorld {
  const name = map.meta.name;
  const raw = byName(geographies, name, '.json');
  const owners = map.nodes.map((n): 0 | 1 | null => {
    if (front.own.includes(n.id)) return 0;
    if (front.enemy.includes(n.id)) return 1;
    if (front.neutral?.includes(n.id) === true) return null;
    return n.start_owner === 0 || n.start_owner === 1 ? n.start_owner : null;
  });
  return {
    map,
    ground: byName(grounds, name, '.bg.webp') ?? null,
    geo: raw === undefined ? null : usableGeo(map, raw),
    owners,
    script,
  };
}

/**
 * The main menu (#866): the front runs north to south right of the middle of the window, where the
 * shade is lightest and the fog not yet in; the own land lies behind it under the shade, the
 * enemy's in the fog. Wheatgate stays neutral: the two orders of a found pair meet there
 * (`menuStory.ts`). Raven Rise and Amber Common (provinces) and Haywell (a city) change hands
 * twice each in a loop of 48 s: the front swings forward, back and forward again.
 */
export const MENU_WORLD: MenuWorld = world(
  mapNamed('marches'),
  {
    own: [
      47, 32, 2, 43, 0, 46, 39, 38, 18, 3, 9, 12, 45, 17, 5, 33, 22, 41, 6, 27, 14, 23, 25, 19, 16,
      7,
    ],
    enemy: [13, 26, 10, 34, 35, 42, 40],
    neutral: [8],
  },
  {
    period: 48,
    captures: [
      { node: 21, from: 16, by: 0, at: 1 },
      { node: 21, from: 11, by: 1, at: 9 },
      { node: 16, from: 21, by: 1, at: 17 },
      { node: 27, from: 16, by: 1, at: 25 },
      { node: 27, from: 14, by: 0, at: 33 },
      { node: 16, from: 27, by: 0, at: 41 },
    ],
  },
);

/**
 * The entry screen (#866): the valley with a front down its middle, Ridgeway and Fordham neutral;
 * Long Meadow and Barley (provinces) and Cold Pass (a city) change hands twice each in a loop of
 * 48 s (of the entry's slower clock).
 */
export const ENTRY_WORLD: MenuWorld = world(
  mapNamed('valley'),
  { own: [8, 9, 11], enemy: [13, 14, 15, 16] },
  {
    period: 48,
    captures: [
      { node: 16, from: 9, by: 0, at: 1 },
      { node: 8, from: 15, by: 1, at: 9 },
      { node: 14, from: 11, by: 0, at: 17 },
      { node: 16, from: 21, by: 1, at: 25 },
      { node: 8, from: 3, by: 0, at: 33 },
      { node: 14, from: 19, by: 1, at: 41 },
    ],
  },
);

/** The map behind the screens before a match (all but the entry). */
export const MENU_MAP: MapFile = MENU_WORLD.map;
/** The map behind the entry screen and its opening scene. */
export const ENTRY_MAP: MapFile = ENTRY_WORLD.map;

/** The world of a menu map, or null for any other map (drawn on the flat stone, no captures). */
export function menuWorldOf(map: MapFile): MenuWorld | null {
  const name = map.meta.name;
  if (name === MENU_WORLD.map.meta.name) return MENU_WORLD;
  if (name === ENTRY_WORLD.map.meta.name) return ENTRY_WORLD;
  return null;
}
