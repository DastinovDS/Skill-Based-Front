/**
 * The `recruit` scene of the dev screen (#1005, D2 "Foundation", ui-style 76): the `economy` moment
 * with the own cities recruiting in every case the barracks' foundation has to handle. Stonegate,
 * the capital with its factory, three units queued; Watchpost, a small city with a built factory, two
 * queued; Forkway, its factory being built (two charges owed, the lozenges beside it) and a fight on
 * the road to Archway (the arena plate keeps clear of the foundation), one queued; Wood Hollow, no
 * factory, two queued for the rally point at Firwood (one walk the CP pay, one they do not);
 * Watchhouse, a unit made 0.3 s ago dropping into the ring while the queue slides on; Ford, a unit
 * made with no room (the amber rim); Meadowvale may recruit but has no queue (select it: the free
 * sockets). A picture for the eyes: the numbers only have to be plausible.
 */
import type {
  EventMsg,
  FightView,
  GroupView,
  MapFile,
  NodeView,
  SnapshotMsg,
} from '../protocol.gen.ts';
import { DEV_RULES_GROUP } from '../hud/devFeed.ts';
import { ARTERY_TICK } from './arteryScene.ts';
import { economySnapshot } from './economyScene.ts';

export const RECRUIT_TICK = ARTERY_TICK;
const T = RECRUIT_TICK;
const UNIT = DEV_RULES_GROUP.recruit.unit_ticks;
const id = (n: number) => (0x7000 + n).toString(16).padStart(16, '0');

/** The recruit queues by city: units queued, ticks of the first one, made and waiting for room. */
const QUEUES: Readonly<Record<number, { queue: number; progress: number; waiting?: boolean }>> = {
  0: { queue: 3, progress: Math.round(UNIT * 0.6) },
  3: { queue: 2, progress: Math.round(UNIT * 0.3) },
  4: { queue: 1, progress: Math.round(UNIT * 0.8) },
  6: { queue: 2, progress: Math.round(UNIT * 0.45) },
  12: { queue: 2, progress: 3 },
  13: { queue: 1, progress: UNIT, waiting: true },
  9: { queue: 0, progress: 0 },
};

/** The group made at Watchhouse 3 ticks before the frame. */
const MADE = id(12);

export function recruitSnapshot(map: MapFile): SnapshotMsg {
  const base = economySnapshot(map);
  const nodes = base.view.nodes.map((node): NodeView => {
    const q = QUEUES[node.id];
    if (q === undefined || node.owner !== 0) return node;
    const own = {
      ...node,
      has_barracks: true,
      recruit_queue: q.queue,
      recruit_progress: q.progress,
      recruit_waiting: q.waiting ?? false,
    };
    switch (node.id) {
      // Wood Hollow: no factory, the barracks built; its recruits walk to Firwood.
      case 6:
        return { ...own, building: null, factory: false, rally_point: 1 };
      case 12:
      case 13:
      case 9:
        return { ...own, factory: false };
      default:
        return own;
    }
  });
  const garrison = (node: number, units: number, charged: number): GroupView => ({
    id: id(node),
    units,
    charged,
    mode: 'attack',
    location: { kind: 'node', node },
    order: null,
  });
  const groups: GroupView[] = [
    ...base.view.groups.filter(
      (g) => g.location.kind !== 'node' || ![4, 12, 13].includes(g.location.node),
    ),
    garrison(4, 2, 2),
    // Watchhouse: the unit just made has merged into the garrison (DEC-20).
    garrison(12, 2, 1),
    // Ford is full: the unit made waits for room (DEC-25, item 7).
    garrison(13, 4, 3),
    // Forkway's group meets the enemy on the road to Archway.
    {
      id: id(40),
      units: 2,
      charged: 1,
      mode: 'attack',
      location: { kind: 'edge', edge: 2, from_node: 4, progress: 300 },
      order: null,
    },
  ];
  const fights: FightView[] = [
    {
      id: id(400),
      node: null,
      edge: 2,
      point: 600,
      attacker: null,
      start_tick: T - 30,
      next_round_tick: T + 10,
      groups: [id(40)],
      enemy_units: 2,
      enemy_charged: 2,
      shots: [1, 1],
      losses: [0, 0],
      virtual_left: [0, 0],
      mute: [0, 0],
      last_round: null,
    },
  ];
  return {
    ...base,
    view: {
      ...base.view,
      // 0.6 CP: the first walk of Wood Hollow is paid, the second is not (#930, W4).
      me: { ...base.view.me, cp: 60 },
      nodes,
      groups,
      fights,
      intents: base.view.intents.filter((i) => i.origin !== 12),
    },
  };
}

/** The unit Watchhouse made 3 ticks before the frame (`recruited`): it drops into the ring. */
export function recruitEvents(): EventMsg[] {
  return [
    { type: 'event', tick: T - 3, kind: 'recruited', data: { player: 0, node: 12, group: MADE } },
  ];
}
