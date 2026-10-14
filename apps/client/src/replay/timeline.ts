/**
 * A replay as snapshots (CLI-10, #66): every frame of the file becomes a `SnapshotMsg` with the
 * full reveal, so the map renderer and the interpolation of CLI-02 work on it unchanged.
 *
 * Nothing is hidden: every node and edge is `exact`/`presence` without a fog memory, and the
 * groups and packets of both players are in the lists. `GroupView` has no owner (a live view holds
 * only own groups), so the owners travel in side tables by id.
 */
import type {
  EventMsg,
  GroupView,
  IntentKind,
  IntentView,
  Location,
  MapFile,
  NodeBuild,
  NodeView,
  PacketView,
  PlayerId,
  SnapshotMsg,
} from '../protocol.gen.ts';
import type { FrameGroup, ReplayFile, ReplayFrame } from './replayFile.ts';

export interface Timeline {
  /** One per frame, ascending by tick. */
  snapshots: SnapshotMsg[];
  groupOwners: ReadonlyMap<string, PlayerId>;
  packetOwners: ReadonlyMap<string, PlayerId>;
  /** All events of the match, ascending by tick. */
  events: EventMsg[];
}

function location(g: FrameGroup): Location {
  if (g.on !== undefined) {
    const [edge, from_node, progress] = g.on;
    return { kind: 'edge', edge, from_node, progress };
  }
  return { kind: 'node', node: g.at ?? 0 };
}

function groupView(g: FrameGroup): GroupView {
  const dest = g.to?.at(-1);
  return {
    id: String(g.id),
    units: g.u,
    charged: g.c,
    // Files from before DEC-16 may have the removed "build" mode: its group shows as attacking.
    mode: g.m === 'build' ? 'attack' : g.m,
    location: location(g),
    order:
      g.to === undefined || dest === undefined
        ? null
        : { dest, path: g.to as [number, ...number[]], planned: g.pl === 1 },
  };
}

/** Intent kinds the viewer draws; older files may have others (the group build, before DEC-16). */
const INTENT_KINDS: ReadonlySet<string> = new Set<IntentKind>(['planned_move', 'defense']);

function snapshot(map: MapFile, frame: ReplayFrame): SnapshotMsg {
  const builds = new Map<number, NodeBuild>();
  for (const [node, edge, done_tick] of frame.b ?? []) builds.set(node, { edge, done_tick });
  const nodes: NodeView[] = frame.n.map(([owner, warehouse, capacity], id) => ({
    id,
    owner,
    capacity,
    capacity_stale: false, // replay frames are the true state (DEC-17)
    detail: 'exact',
    warehouse,
    seen: null,
    build: builds.get(id) ?? null,
    attrition_in: null, // not in the replay files: the viewer shows no countdown
    grace_left: null,
    priority: null, // not in the replay files (DEC-18): the viewer has no supply mode
    starve_in: null, // not in the replay files (DEC-19)
  }));
  const packets: PacketView[] = frame.k.map(
    ([id, , edge, from_node, charges, depart_tick, arrive_tick]) => {
      // The frames hold the current road of a packet only: its path is the end of that road.
      const road = map.edges[edge];
      const end = road === undefined ? from_node : road.a === from_node ? road.b : road.a;
      return {
        id: String(id),
        edge,
        from_node,
        charges,
        depart_tick,
        arrive_tick,
        path: [end],
        dest_tick: arrive_tick,
        transfer: false,
      };
    },
  );
  const [first, second] = frame.p;
  return {
    type: 'snapshot',
    tick: frame.t,
    view: {
      me: { cp: first[0], stance: first[2] },
      vp: [first[1], second[1]],
      nodes,
      edges: frame.w.map((width, id) => ({
        id,
        width,
        kind: frame.r?.[id] ?? 'none',
        detail: 'presence',
        upgrade_gain: null,
        seen: null,
      })),
      groups: frame.g.map(groupView),
      packets,
      intents: frame.i
        .filter(([, , kind]) => INTENT_KINDS.has(kind))
        .map(([id, owner, kind, origin, target]): IntentView => ({
          id: String(id),
          owner,
          // Filtered above: the file has the kind as the simulation names it.
          kind: kind as IntentKind,
          origin,
          target,
          created_tick: frame.t,
        })),
      // Fights (DEC-24): the viewer sees both sides, so every group of the fight is listed and
      // the enemy totals stay 0 (they are in the groups).
      fights: (frame.f ?? []).map(
        ([id, node, edge, point, attacker, start_tick, next_round_tick, groups]) => ({
          id: String(id),
          node,
          edge,
          point,
          attacker,
          start_tick,
          next_round_tick,
          groups: groups.map(String),
          enemy_units: 0,
          enemy_charged: 0,
        }),
      ),
    },
  };
}

export function buildTimeline(file: ReplayFile): Timeline {
  const groupOwners = new Map<string, PlayerId>();
  const packetOwners = new Map<string, PlayerId>();
  for (const frame of file.frames) {
    for (const g of frame.g) groupOwners.set(String(g.id), g.o);
    for (const k of frame.k) packetOwners.set(String(k[0]), k[1]);
  }
  return {
    snapshots: file.frames.map((frame) => snapshot(file.map, frame)),
    groupOwners,
    packetOwners,
    events: file.events.map(([tick, kind, data]) => ({ type: 'event', tick, kind, data })),
  };
}
