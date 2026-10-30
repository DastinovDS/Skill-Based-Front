/**
 * A replay as snapshots (CLI-10, #66): every frame of the file becomes a `SnapshotMsg`, so the map
 * renderer and the interpolation of CLI-02 work on it unchanged.
 *
 * The full reveal (`buildTimeline(file)`): nothing is hidden, every node and edge is
 * `exact`/`presence` without a fog memory, and the groups and packets of both players are in the
 * lists. `GroupView` has no owner (a live view holds only own groups), so the owners travel in side
 * tables by id.
 *
 * One side with its fog (`buildTimeline(file, side)`, #600): the snapshot that player had in the
 * live match. Everything it hides or degrades is copied from the frame key `v` (#598), which the
 * server took from `project()`; the client decides nothing about vision (AGENTS.md 7.1). The rest
 * is what a live view has by owner: the own groups and packets, the own warehouse places.
 */
import type {
  EventMsg,
  GroupView,
  IntentKind,
  IntentView,
  Location,
  MapFile,
  EdgeBuild,
  EdgeView,
  EnemyGroup,
  FightView,
  HalfView,
  NodeView,
  PacketView,
  PlayerId,
  Seen,
  SnapshotMsg,
} from '../protocol.gen.ts';
import type {
  FrameFigure,
  FrameGroup,
  FrameHalf,
  FrameSighting,
  ReplayFile,
  ReplayFrame,
} from './replayFile.ts';

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
        : // Replay frames carry no planned bonus (DEC-29): the viewer shows none.
          { dest, path: g.to as [number, ...number[]], planned: g.pl === 1, bonus: 0 },
    // Replay frames carry no gathered Defense bonus (DEC-30); the viewer shows the mode only.
    defense_bonus: null,
    defense_cap: null,
  };
}

/** Intent kinds the viewer draws; older files may have others (the group build, before DEC-16). */
const INTENT_KINDS: ReadonlySet<string> = new Set<IntentKind>(['planned_move', 'defense']);

function snapshot(map: MapFile, frame: ReplayFrame): SnapshotMsg {
  // Road builds by edge: `e` since DEC-28, `b` (by the building city) in older files.
  const builds = new Map<number, EdgeBuild>();
  for (const [, edge, done_tick] of frame.b ?? []) builds.set(edge, { done_tick });
  for (const [edge, , done_tick] of frame.e ?? []) builds.set(edge, { done_tick });
  const nodes: NodeView[] = frame.n.map(([owner, warehouse, capacity, warehouseCap], id) => ({
    id,
    owner,
    capacity,
    capacity_stale: false, // replay frames are the true state (DEC-17)
    detail: 'exact',
    warehouse,
    seen: null,
    attrition_in: null, // not in the replay files: the viewer shows no countdown
    grace_left: null,
    starve_in: null, // not in the replay files (DEC-19)
    recruit_queue: null, // not in the replay files (DEC-25)
    recruit_progress: null,
    recruit_waiting: null,
    has_barracks: null, // not in the replay files (DEC-26)
    warehouse_level: null,
    // The places of the warehouse (#556): without them the bar would show the node capacity.
    warehouse_cap: warehouseCap ?? null,
    building: null,
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
      // Front markers and the rear minimum are not in the replay files (DEC-28).
      me: { cp: first[0], stance: first[2], fronts: [null, null], rear_min: 0 },
      vp: [first[1], second[1]],
      nodes,
      edges: frame.w.map((width, id) => ({
        id,
        width,
        detail: 'presence',
        upgrade_gain: null,
        // Both sides' groups are drawn as groups: nothing is seen as an enemy here.
        halves: [
          { detail: 'presence', seen: null },
          { detail: 'presence', seen: null },
        ],
        build: builds.get(id) ?? null,
        enemy_groups: [],
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
      // the enemy totals stay 0 (they are in the groups). The round data (shots, losses, the
      // bonus stock and the last round) is the ninth element of the record (#323); a record of
      // an older file has none, so its arena is empty. The silent charges are not in the frames.
      fights: (frame.f ?? []).map((record): FightView => {
        const [id, node, edge, point, attacker, start_tick, next_round_tick, groups] = record;
        const rounds = record[8];
        const last = rounds?.[3] ?? null;
        return {
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
          shots: rounds ? [...rounds[0]] : [0, 0],
          losses: rounds ? [...rounds[1]] : [0, 0],
          virtual_left: rounds ? [...rounds[2]] : [0, 0],
          mute: [0, 0],
          last_round: last
            ? {
                tick: last[0],
                shots: [...last[1]],
                virtual: [...last[2]],
                spent: [...last[3]],
                losses: [...last[4]],
              }
            : null,
        };
      }),
    },
  };
}

/** A sighting of the file as `Seen`; a place not in fog was seen in the frame's own tick. */
function seen(record: FrameSighting | null | undefined, tick: number): Seen | null {
  if (record === null || record === undefined) return null;
  const [level, modes, units, charged, range, at] = record;
  return {
    tick: at ?? tick,
    level,
    enemy_modes: [...modes],
    enemy_units: units ?? null,
    enemy_charged: charged ?? null,
    enemy_range: range ? { low: range[0], high: range[1] } : null,
  };
}

function half([detail, sighting]: FrameHalf, tick: number): HalfView {
  return { detail, seen: seen(sighting, tick) };
}

function figure([id, pos, toward, detail, mode, units, charged, range]: FrameFigure): EnemyGroup {
  return {
    id,
    pos,
    toward_b: toward === 1,
    detail,
    mode,
    units: units ?? null,
    charged: charged ?? null,
    units_range: range ? { low: range[0], high: range[1] } : null,
  };
}

/**
 * The snapshot `side` had at this frame (#600), cut from the full one: the fog part from `v[side]`
 * as it is, the own groups, packets and fight members by owner. Without `v` the full snapshot.
 */
function sideSnapshot(full: SnapshotMsg, frame: ReplayFrame, side: PlayerId): SnapshotMsg {
  const vision = frame.v?.[side];
  if (vision === undefined) return full;
  const tick = frame.t;
  const owners = new Map(frame.g.map((g) => [String(g.id), g]));
  const built = new Set(vision.b ?? []);
  const nodes = full.view.nodes.map((node, id): NodeView => {
    const [detail, sighting, warehouse] = vision.n[id] ?? ['fog'];
    return {
      ...node,
      detail,
      seen: seen(sighting, tick),
      warehouse: warehouse ?? null,
      // Own city only (as in a live view): the places of a foreign warehouse are hidden.
      warehouse_cap: node.owner === side ? node.warehouse_cap : null,
    };
  });
  const edges = full.view.edges.map((edge, id): EdgeView => {
    const record = vision.e[id];
    if (record === undefined) return edge;
    const [width, detail, a, b, figures] = record;
    const build = edge.build;
    const own = (frame.e ?? []).some(([e, owner]) => e === id && owner === side);
    return {
      ...edge,
      width,
      detail,
      halves: [half(a, tick), half(b, tick)],
      // The file lists the builds the player saw; the end tick is known of an own one only.
      build: built.has(id) ? { done_tick: own ? (build?.done_tick ?? null) : null } : null,
      enemy_groups: (figures ?? []).map(figure),
    };
  });
  return {
    ...full,
    view: {
      ...full.view,
      me: { ...full.view.me, cp: frame.p[side][0], stance: frame.p[side][2] },
      nodes,
      edges,
      groups: full.view.groups.filter((g) => owners.get(g.id)?.o === side),
      packets: full.view.packets.filter((_, i) => frame.k[i]?.[1] === side),
      // A fight lists the own groups and the enemy totals (both sides are in every fight).
      fights: full.view.fights.map((fight): FightView => {
        const enemy = fight.groups
          .map((id) => owners.get(id))
          .filter((g): g is FrameGroup => g !== undefined && g.o !== side);
        return {
          ...fight,
          groups: fight.groups.filter((id) => owners.get(id)?.o === side),
          enemy_units: enemy.reduce((sum, g) => sum + g.u, 0),
          enemy_charged: enemy.reduce((sum, g) => sum + g.c, 0),
        };
      }),
    },
  };
}

/**
 * The snapshots of the replay: the full reveal, or with `side` what that player saw (#600; a file
 * without the per-player key of #598 gives the full reveal for a side too).
 */
export function buildTimeline(file: ReplayFile, side: PlayerId | null = null): Timeline {
  const groupOwners = new Map<string, PlayerId>();
  const packetOwners = new Map<string, PlayerId>();
  for (const frame of file.frames) {
    for (const g of frame.g) groupOwners.set(String(g.id), g.o);
    for (const k of frame.k) packetOwners.set(String(k[0]), k[1]);
  }
  return {
    snapshots: file.frames.map((frame) => {
      const full = snapshot(file.map, frame);
      return side === null ? full : sideSnapshot(full, frame, side);
    }),
    groupOwners,
    packetOwners,
    events: file.events.map(([tick, kind, data]) => ({ type: 'event', tick, kind, data })),
  };
}
