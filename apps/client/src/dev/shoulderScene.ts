/**
 * The `shoulder` and `shoulder_far` scenes of the dev screen (#956, C2 of #954): the terrain
 * chevrons on the helmet's shoulder inside the capacity ring, together with what stands near them on
 * a city with a group of four or more: the VP lozenge, the corner ticks of a selected group, the
 * number of units (up to two digits) and a mark counted by strokes or by a number. The same
 * moment twice: the artery part at the normal zoom, and the whole map (the far zoom, where tokens
 * keep their minimum size on screen). Made from `badgesSnapshot`: a picture for the eyes, the
 * numbers only have to be plausible.
 */
import type { GroupView, MapFile, SnapshotMsg } from '../protocol.gen.ts';
import { badgesSnapshot } from './badgesScene.ts';
import type { ScenePins } from './groupScene.ts';

const id = (n: number) => (0x7000 + n).toString(16).padStart(16, '0');

/** Own cities with a group (units, charged) and the terrain mark of the defender there. */
const STANDING: readonly { node: number; units: number; charged: number; mark: number }[] = [
  { node: 0, units: 6, charged: 4, mark: 1 },
  { node: 3, units: 5, charged: 3, mark: -1 },
  { node: 4, units: 12, charged: 9, mark: 2 },
  { node: 6, units: 4, charged: 2, mark: -3 },
  { node: 12, units: 3, charged: 3, mark: 5 },
  { node: 9, units: 2, charged: 1, mark: -9 },
  { node: 13, units: 2, charged: 2, mark: 0 },
];

/** The groups of the first four cities are selected together: their corner ticks show. */
export const SHOULDER_PINS: ScenePins = {
  picks: [3, 4, 6, 0].map((node) => id(node)),
};

export function shoulderSnapshot(map: MapFile): SnapshotMsg {
  const base = badgesSnapshot(map);
  const mark = (node: number): number | null => STANDING.find((s) => s.node === node)?.mark ?? null;
  const nodes = base.view.nodes.map((n) => {
    const own = STANDING.some((s) => s.node === n.id);
    return own ? { ...n, terrain_mark: mark(n.id) } : n;
  });
  const groups: GroupView[] = STANDING.map((s) => ({
    id: id(s.node),
    units: s.units,
    charged: s.charged,
    mode: 'attack',
    location: { kind: 'node', node: s.node },
    order: null,
  }));
  return { ...base, view: { ...base.view, nodes, groups, intents: [], fights: [] } };
}
