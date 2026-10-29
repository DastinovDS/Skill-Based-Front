/**
 * The `defense` scene of the dev screen (#349, ui-style 35): the `artery` moment with the sign of
 * "Defense" in every state the counter has (D1 "Diamond pips" in the left column L1): a bonus of 0 of
 * 3, 1 of 3, a full 4 of 4, 1 of 2 beside a barracks, the cap of a capital above six places
 * ("2 of 8"), no charged units (no places), the opponent seen in a city next to an own one (the
 * badge alone, with its barracks) and the opponent's public intent in the fog. Made here from the
 * artery scene, not a fixture of the protocol: it is a picture for the eyes, the numbers only have to
 * be plausible.
 */
import type { GroupView, IntentView, MapFile, NodeView, SnapshotMsg } from '../protocol.gen.ts';
import { ARTERY_TICK, arterySnapshot } from './arteryScene.ts';

export const DEFENSE_TICK = ARTERY_TICK;

/** The part of the map the scene looks at: from the left column of the capital to the opponent's cities. */
export const DEFENSE_VIEW = { x: 20, y: 140, width: 880, height: 700 } as const;

/** The own cities in "Defense": units, charged, the bonus gathered and its cap. */
const DEFENDERS: Readonly<
  Record<number, { units: number; charged: number; bonus: number; cap: number }>
> = {
  // The capital: eight charged units, 2 of 8: the numbers form, over the barracks.
  0: { units: 8, charged: 8, bonus: 2, cap: 8 },
  1: { units: 3, charged: 3, bonus: 0, cap: 3 },
  2: { units: 3, charged: 3, bonus: 1, cap: 3 },
  // Full, with a barracks.
  3: { units: 4, charged: 4, bonus: 4, cap: 4 },
  6: { units: 2, charged: 2, bonus: 1, cap: 2 },
  // Units without a charge: no places, the badge alone.
  12: { units: 2, charged: 0, bonus: 0, cap: 0 },
  13: { units: 5, charged: 5, bonus: 3, cap: 5 },
};
/** Own cities that show the barracks. */
const BARRACKS = [0, 3, 6, 13];
/** The opponent's city next to an own one, seen in "Defense" (its barracks are seen too, DEC-31). */
const SEEN_DEFENDING = 5;
/** The opponent's city in the fog: only its public intent tells that it defends. */
const FOG_DEFENDING = 15;

const id = (n: number) => n.toString(16).padStart(16, '0');

export function defenseSnapshot(map: MapFile): SnapshotMsg {
  const base = arterySnapshot(map);
  const nodes: NodeView[] = base.view.nodes.map((node) => {
    let next = node;
    if (node.owner === 0 && node.id in DEFENDERS) {
      next = { ...next, has_barracks: BARRACKS.includes(node.id) ? true : next.has_barracks };
    }
    if (node.id === SEEN_DEFENDING && node.seen !== null) {
      next = { ...next, seen: { ...node.seen, enemy_modes: ['defense'] } };
    }
    return next;
  });
  // The groups of the artery scene stay where they are not replaced: the march, the fight.
  const kept: GroupView[] = base.view.groups.filter(
    (g) => g.location.kind === 'edge' || g.location.node === 4 || g.location.node === 9,
  );
  const defenders: GroupView[] = Object.entries(DEFENDERS).map(([node, d]) => ({
    id: id(500 + Number(node)),
    units: d.units,
    charged: d.charged,
    mode: 'defense',
    location: { kind: 'node', node: Number(node) },
    order: null,
    defense_bonus: d.bonus,
    defense_cap: d.cap,
  }));
  const intents: IntentView[] = [
    ...base.view.intents.filter((i) => i.kind !== 'defense'),
    ...Object.keys(DEFENDERS).map((node) => ({
      id: id(600 + Number(node)),
      owner: 0 as const,
      kind: 'defense' as const,
      origin: Number(node),
      target: null,
      created_tick: DEFENSE_TICK - 100,
    })),
    {
      id: id(699),
      owner: 1,
      kind: 'defense',
      origin: FOG_DEFENDING,
      target: null,
      created_tick: DEFENSE_TICK - 60,
    },
  ];
  return { ...base, view: { ...base.view, nodes, groups: [...kept, ...defenders], intents } };
}
