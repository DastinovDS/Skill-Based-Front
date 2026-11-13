/**
 * The tutorial chapters (#806, `docs/design/tutorial.md`, section 7.3): the chapter files of
 * `tutorial/chapters/` and their maps of `maps/tutorial/`, bundled at build time like the menu maps
 * (`app/menuMap.ts`). The server reads the same files and walks the beats; the client draws the
 * beat it names (`tutorial` message), so nothing here decides a trigger or a goal.
 */
import type { Beat, Chapter, ChapterId, MapFile } from '../protocol.gen.ts';

const files = import.meta.glob<Chapter>('../../../../tutorial/chapters/*.json', {
  eager: true,
  import: 'default',
});
const maps = import.meta.glob<MapFile>('../../../../maps/tutorial/*.json', {
  eager: true,
  import: 'default',
});
// The baked grounds of the chapter maps (fetched when an intro shows its map, not bundled inline).
const grounds = import.meta.glob<string>('../../../../maps/tutorial/*.bg.webp', {
  eager: true,
  import: 'default',
  query: '?url',
});

/** The chapters of the main road, I to V, in order. */
export const MAIN_CHAPTERS = ['units', 'economy', 'building', 'attack', 'defence'] as const;
/** The Advanced chapters, I to III; they open when V is done (Q8). */
export const ADVANCED_CHAPTERS = ['group-orders', 'rally-points', 'supply-distribution'] as const;
/** Every chapter, main road first. */
export const CHAPTER_IDS: readonly ChapterId[] = [...MAIN_CHAPTERS, ...ADVANCED_CHAPTERS];

const byId = new Map<string, Chapter>();
for (const chapter of Object.values(files)) byId.set(chapter.id, chapter);

/** The chapter file of `id`; a chapter id always has one (the build bundles them all). */
export function chapterOf(id: ChapterId): Chapter {
  const chapter = byId.get(id);
  if (chapter === undefined)
    throw new Error(`the chapter file tutorial/chapters/${id}.json is missing`);
  return chapter;
}

export function isChapterId(value: unknown): value is ChapterId {
  return typeof value === 'string' && CHAPTER_IDS.some((id) => id === value);
}

/** The map of a chapter (`maps/tutorial/<map>.json`). */
export function chapterMap(chapter: Chapter): MapFile {
  const found = Object.entries(maps).find(([path]) => path.endsWith(`/${chapter.map}.json`));
  if (found === undefined)
    throw new Error(`the chapter map maps/tutorial/${chapter.map}.json is missing`);
  return found[1];
}

/** The URL of the baked ground of a chapter map, or null. */
export function chapterGround(chapter: Chapter): string | null {
  const found = Object.entries(grounds).find(([path]) => path.endsWith(`/${chapter.map}.bg.webp`));
  return found === undefined ? null : found[1];
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V'] as const;

/** The numeral of a chapter on its road: I to V, or I to III on the Advanced road. */
export function numeral(chapter: Chapter): string {
  return ROMAN[chapter.number - 1] ?? String(chapter.number);
}

/**
 * What the intro (Sheet) shows of a chapter's map: the crop in world units (x0, y0, x1, y1) and
 * the places of its goals, ringed. The walkthrough's crops (`mockups/tutorial-walkthrough.html`).
 */
export const SHEET_CROP: Readonly<
  Record<
    ChapterId,
    { readonly crop: readonly [number, number, number, number]; readonly goals: readonly string[] }
  >
> = {
  units: { crop: [140, 120, 820, 600], goals: ['Ashford', 'Elmstead', 'Fordham'] },
  economy: { crop: [120, 110, 920, 620], goals: ['Coldwell', 'Westmarch'] },
  building: { crop: [130, 120, 820, 640], goals: ['Millbrook', 'Fernhill'] },
  attack: { crop: [170, 140, 1130, 650], goals: ['Ashwood', 'Stormcrown'] },
  defence: { crop: [130, 120, 960, 700], goals: ['Flatford', 'Highcrag'] },
  'group-orders': { crop: [150, 60, 860, 680], goals: ['Ashwood'] },
  'rally-points': { crop: [150, 160, 880, 640], goals: ['Highhold', 'Fernhold'] },
  'supply-distribution': { crop: [130, 150, 980, 640], goals: ['Fernhold', 'Ashwood'] },
};

/** How many goals the intro lists (`tutorial.<id>.goal<n>` for n = 1..count). */
export const GOAL_COUNT: Readonly<Record<ChapterId, number>> = {
  units: 1,
  economy: 1,
  building: 3,
  attack: 2,
  defence: 2,
  'group-orders': 1,
  'rally-points': 2,
  'supply-distribution': 1,
};

/** Where a beat stands in its chapter: its index in `beats`, or the failure beat. */
export interface BeatAt {
  readonly beat: Beat;
  /** Index in `chapter.beats`; -1 for a failure beat. */
  readonly index: number;
  readonly fail: boolean;
}

export function beatAt(chapter: Chapter, id: string | null): BeatAt | null {
  if (id === null) return null;
  const index = chapter.beats.findIndex((b) => b.id === id);
  if (index >= 0) return { beat: chapter.beats[index] as Beat, index, fail: false };
  const fail = chapter.fails?.find((b) => b.id === id);
  return fail === undefined ? null : { beat: fail, index: -1, fail: true };
}

/** The node id of a place named in a chapter file, or undefined. */
export function nodeNamed(map: MapFile, name: string): number | undefined {
  return map.nodes.find((n) => n.name === name)?.id;
}
