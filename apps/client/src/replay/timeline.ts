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
  Location,
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
    mode: g.m,
    location: location(g),
    order:
      g.to === undefined || dest === undefined
        ? null
        : { dest, path: g.to as [number, ...number[]], planned: g.pl === 1 },
  };
}

function snapshot(frame: ReplayFrame): SnapshotMsg {
  const nodes: NodeView[] = frame.n.map(([owner, warehouse, capacity], id) => ({
    id,
    owner,
    capacity,
    detail: 'exact',
    warehouse,
    seen: null,
  }));
  const packets: PacketView[] = frame.k.map(
    ([id, , edge, from_node, charges, depart_tick, arrive_tick]) => ({
      id: String(id),
      edge,
      from_node,
      charges,
      depart_tick,
      arrive_tick,
    }),
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
        detail: 'presence',
        upgrade_gain: null,
        seen: null,
      })),
      groups: frame.g.map(groupView),
      packets,
      intents: frame.i.map(([id, owner, kind, origin, target]) => ({
        id: String(id),
        owner,
        // The file has the kind as the simulation names it; the dictionary of the map knows these.
        kind: kind as IntentKind,
        origin,
        target,
        created_tick: frame.t,
      })),
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
    snapshots: file.frames.map(snapshot),
    groupOwners,
    packetOwners,
    events: file.events.map(([tick, kind, data]) => ({ type: 'event', tick, kind, data })),
  };
}
