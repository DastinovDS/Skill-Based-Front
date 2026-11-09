/**
 * The `badges` scene of the dev screen (#791, variant 8 "Chevrons" of #776): the artery moment with
 * the advantage and disadvantage badges in every case the server sends them. On the map only the
 * terrain mark of a node's defender (`NodeView.terrain_mark`, written here as the server would): own
 * groups on mountains (Stonegate, up) and on plains (Watchpost, Meadowvale with a planned order
 * waiting: down, the plan has no badge on the map), a discharged one on plains (Ford: none), the
 * enemy seen exactly on mountains (West Shoulder, up) and on plains (Archway, down), the enemy seen
 * as a range on plains (Heart: none). In the arenas the badges are on the chips: in Forkway the
 * enemy attacks with a planned order (two chevrons up on two chips) an own plains defender (one
 * chip pinned with chevrons down, silent); in Bluff an own planned attack (two up) meets an enemy
 * mountain defender (one up). Made here, not a fixture of the protocol.
 */
import type {
  FightView,
  GroupView,
  MapFile,
  NodeView,
  Seen,
  SnapshotMsg,
} from '../protocol.gen.ts';
import { ARTERY_TICK, arterySnapshot } from './arteryScene.ts';

const T = ARTERY_TICK;
const id = (n: number) => n.toString(16).padStart(16, '0');

/** The terrain marks the server would send for this moment, by node. */
const MARKS: Readonly<Record<number, number>> = { 0: 1, 3: -1, 9: -1, 5: -1, 14: 1 };

function exact(units: number, charged: number): Seen {
  return {
    tick: T,
    level: 'exact',
    enemy_modes: ['attack'],
    enemy_units: units,
    enemy_charged: charged,
    enemy_range: null,
  };
}

export function badgesSnapshot(map: MapFile): SnapshotMsg {
  const base = arterySnapshot(map);
  const enemySeen: Readonly<Record<number, Seen>> = {
    5: exact(2, 2),
    14: exact(3, 3),
    7: exact(2, 2),
    15: {
      tick: T,
      level: 'range',
      enemy_modes: ['attack'],
      enemy_units: null,
      enemy_charged: null,
      enemy_range: { low: 3, high: 5 },
    },
  };
  const nodes: NodeView[] = base.view.nodes.map((node) => {
    const seen = enemySeen[node.id];
    const owned = node.id === 7 ? { owner: 1 as const } : {};
    const sight = seen === undefined ? {} : { detail: seen.level, seen };
    return { ...node, ...owned, ...sight, terrain_mark: MARKS[node.id] ?? null };
  });
  const garrison = (node: number, units: number, charged: number): GroupView => ({
    id: id(500 + node),
    units,
    charged,
    mode: 'attack',
    location: { kind: 'node', node },
    order: null,
  });
  const groups: GroupView[] = [
    ...base.view.groups.map((g) =>
      g.location.kind === 'node' && g.location.node === 4 ? { ...g, units: 3, charged: 3 } : g,
    ),
    garrison(0, 3, 3),
    garrison(13, 2, 0),
    garrison(7, 3, 3),
  ];
  const [forkway] = base.view.fights;
  if (forkway === undefined) throw new Error('the artery scene has a fight');
  const fights: FightView[] = [
    {
      ...forkway,
      enemy_units: 3,
      enemy_charged: 3,
      shots: [0, 0],
      losses: [0, 0],
      // The enemy's planned order brought two bonus shots; the own plains defender has one silent.
      virtual_left: [0, 2],
      mute: [1, 0],
      last_round: null,
      start_tick: T - 10,
      next_round_tick: T + 10,
    },
    {
      ...forkway,
      id: id(401),
      node: 7,
      attacker: 0,
      groups: [id(507)],
      enemy_units: 2,
      enemy_charged: 2,
      shots: [0, 0],
      losses: [0, 0],
      // The own planned order: two bonus shots; the enemy on mountains: one.
      virtual_left: [2, 1],
      mute: [0, 0],
      last_round: null,
      start_tick: T - 6,
      next_round_tick: T + 14,
    },
  ];
  return { ...base, view: { ...base.view, nodes, groups, fights } };
}
