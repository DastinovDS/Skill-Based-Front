/**
 * A hand-made geography for the tests (DEC-36, #544): two nodes on a 200 x 100 map. A river runs
 * between them in the top 60 units (a strip from x = 90 to 110), below it the areas touch along
 * the road, so there is one stretch of land border and two river banks:
 *
 *     0 ........ 90 | 110 ........ 200      y = 0
 *     area 0   river   area 1
 *     0 ........ 90 |100| 110 ...          y = 60   the river ends, the areas touch
 *     area 0 ......... | area 1 .........   y = 100
 *
 * The chains follow the vector file: `l` is the region on the left of the walk (y points down).
 */
import type { GeoFile } from '../map/geography.ts';
import type { MapFile } from '../protocol.gen.ts';

export const GEO_MAP = {
  meta: { name: 'rivertest', version: 4, symmetry: 'rot180', width: 200, height: 100 },
  nodes: [
    { id: 0, name: 'West', x: 45, y: 50, terrain: 'plains' },
    { id: 1, name: 'East', x: 155, y: 50, terrain: 'forest' },
  ],
  edges: [{ id: 0, a: 0, b: 1, max_level: 3, travel_ticks: 30, border_permille: 500 }],
} as unknown as MapFile;

const chain = (l: number | string, r: number | string, pts: number[]) => ({ l, r, pts });

export const GEO_FILE: GeoFile = {
  map: 'rivertest',
  version: 4,
  chains: [
    chain(-1, 0, [0, 0, 90, 0]),
    chain(-1, 'river', [90, 0, 110, 0]),
    chain(-1, 1, [110, 0, 200, 0]),
    chain(-1, 1, [200, 0, 200, 100]),
    chain(-1, 1, [200, 100, 100, 100]),
    chain(-1, 0, [100, 100, 0, 100]),
    chain(-1, 0, [0, 100, 0, 0]),
    chain('river', 0, [90, 0, 90, 60]),
    chain('river', 0, [90, 60, 100, 60]),
    chain(1, 0, [100, 60, 100, 100]),
    chain('river', 1, [100, 60, 110, 60]),
    chain(1, 'river', [110, 0, 110, 60]),
  ],
};
