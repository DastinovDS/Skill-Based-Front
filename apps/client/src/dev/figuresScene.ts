/**
 * The `figures` scene of the dev screen (#354): the `artery` moment with enemy figures on roads
 * (EF2 "Pointer", DEC-33): an exact figure (plate «4 · 3●»), a range one («3-5»), one seen without
 * numbers (dashed token, no plate), one just out of the haze that is half dissolved, and the memory of
 * a half in the fog with the dashed tick on its border point. Made here from the artery scene, not a
 * fixture of the protocol: it is a picture for the eyes, the numbers only have to be plausible.
 */
import type {
  Detail,
  EdgeView,
  EnemyGroup,
  HalfView,
  MapFile,
  Seen,
  SnapshotMsg,
} from '../protocol.gen.ts';
import { ARTERY_TICK, arterySnapshot } from './arteryScene.ts';

const FIGURES_TICK = ARTERY_TICK;

function seen(level: Detail, ago: number, extra: Partial<Seen> = {}): Seen {
  return {
    tick: FIGURES_TICK - ago,
    level,
    enemy_modes: [],
    enemy_units: null,
    enemy_charged: null,
    enemy_range: null,
    ...extra,
  };
}

const half = (detail: Detail, memory: Seen | null = seen(detail, 0)): HalfView => ({
  detail,
  seen: memory,
});

const figure = (
  id: string,
  pos: number,
  detail: Detail,
  fields: Partial<EnemyGroup>,
): EnemyGroup => ({
  id,
  pos,
  toward_b: false,
  detail,
  mode: 'attack',
  units: null,
  charged: null,
  units_range: null,
  ...fields,
});

/** The part of the map (world units) the camera looks at: the middle, where the own and the enemy halves meet. */
export const FIGURES_VIEW = { x: 260, y: 170, width: 640, height: 520 } as const;

/** What the scene puts on each road: the two halves (a, b) and the figures. */
const ROADS: Readonly<Record<number, { halves: [HalfView, HalfView]; figures: EnemyGroup[] }>> = {
  // 4-5: an exact figure on the half of the own city 4, going to it.
  2: {
    halves: [half('exact'), half('presence', seen('presence', 0, { enemy_modes: ['attack'] }))],
    figures: [figure('e-exact', 380, 'exact', { units: 4, charged: 3 })],
  },
  // 6-7: a figure seen as a range on the half of the city 7, going to 6.
  10: {
    halves: [
      half('exact'),
      half(
        'range',
        seen('range', 0, { enemy_modes: ['attack'], enemy_range: { low: 3, high: 5 } }),
      ),
    ],
    figures: [figure('e-range', 650, 'range', { units_range: { low: 3, high: 5 } })],
  },
  // 12-7: a figure seen without numbers.
  15: {
    halves: [
      half('presence', seen('presence', 0, { enemy_modes: ['attack'] })),
      half('presence', seen('presence', 0, { enemy_modes: ['attack'] })),
    ],
    figures: [figure('e-presence', 300, 'presence', { toward_b: true })],
  },
  // 4-13: just out of the haze of 13, near the border point: half dissolved.
  16: {
    halves: [half('exact'), half('exact')],
    figures: [figure('e-new', 575, 'exact', { units: 2, charged: 2 })],
  },
  // 4-12: the half of 12 is in the fog and remembers a figure 12 s ago: its memory ghost and the
  // dashed tick on the border point.
  14: {
    halves: [half('exact'), half('fog', seen('presence', 120, { enemy_modes: ['attack'] }))],
    figures: [],
  },
};

export function figuresSnapshot(map: MapFile): SnapshotMsg {
  const base = arterySnapshot(map);
  const edges: EdgeView[] = base.view.edges.map((edge) => {
    const road = ROADS[edge.id];
    if (road === undefined) return edge;
    return { ...edge, halves: road.halves, enemy_groups: road.figures };
  });
  // No fight, no orders and no group on a road: they would cover the figures.
  const groups = base.view.groups
    .filter((g) => g.location.kind === 'node')
    .map((g) => ({ ...g, order: null }));
  return { ...base, view: { ...base.view, edges, groups, fights: [], intents: [], packets: [] } };
}
