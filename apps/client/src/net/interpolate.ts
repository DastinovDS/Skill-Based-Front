/**
 * Interpolation between two server snapshots (CLI-02, #58; AGENTS.md, 7.3).
 *
 * Pure functions of two snapshots and a render time in ticks. No extrapolation and no prediction:
 * the time is always between the two snapshots, and whatever cannot be interpolated honestly
 * (a group that changed edge, appeared or vanished) stays as in the earlier snapshot until the
 * later one becomes the base. Progress is in thousandths of an edge, as on the wire.
 */
import type {
  EnemyGroup,
  GroupView,
  Location,
  PacketView,
  PlayerId,
  SnapshotMsg,
} from '../protocol.gen.ts';

/** A full edge in thousandths (`OnEdgeLoc.progress`). */
export const EDGE_LENGTH = 1000;

export interface RenderGroup {
  group: GroupView;
  /** Whose group it is, when the source shows both sides (the replay viewer); default: own. */
  owner?: PlayerId;
  /** Where to draw the group now; `progress` may be fractional. */
  location: Location;
}

export interface RenderPacket {
  packet: PacketView;
  /** Whose packet it is, when the source shows both sides (the replay viewer); default: own. */
  owner?: PlayerId;
  /** In thousandths, `0` at `depart_tick` and `EDGE_LENGTH` at `arrive_tick`. */
  progress: number;
}

/** An enemy figure on a half of a road in sight (DEC-33) and where to draw it now. */
export interface RenderEnemy {
  /** The road it is on. */
  edge: number;
  figure: EnemyGroup;
  /** Position in thousandths from the end `a`; fractional between two snapshots. */
  pos: number;
}

export interface RenderFrame {
  /** Render time in ticks (fractional). */
  tick: number;
  /** The snapshot the frame is built on: nodes, edges, intents and the set of entities. */
  base: SnapshotMsg;
  groups: RenderGroup[];
  packets: RenderPacket[];
  /** The enemy figures of the base snapshot, each at its place now. */
  enemies: RenderEnemy[];
}

const lerp = (from: number, to: number, alpha: number): number => from + (to - from) * alpha;

/**
 * Location of a group between its place in `a` and its place in `b`, `alpha` in [0, 1].
 *
 * Only motion along one edge is interpolated: edge to the same edge (forward, or backwards after
 * a bounce), node onto the edge it leaves along, edge into the node at its end. Every other change
 * between two snapshots holds `a`.
 */
export function interpolateLocation(a: Location, b: Location | null, alpha: number): Location {
  if (b === null) return a;
  if (a.kind === 'edge') {
    if (b.kind === 'edge') {
      if (a.edge !== b.edge || a.from_node !== b.from_node) return a;
      return { ...a, progress: lerp(a.progress, b.progress, alpha) };
    }
    // Arrival at the far end, or a bounce back to `from_node`. The graph is not needed: the
    // edge's end is whatever node it is not.
    const to = b.node === a.from_node ? 0 : EDGE_LENGTH;
    return { ...a, progress: lerp(a.progress, to, alpha) };
  }
  if (b.kind === 'edge' && b.from_node === a.node) {
    return { ...b, progress: lerp(0, b.progress, alpha) };
  }
  return a;
}

/** Progress of a packet at render time `tick`: a straight line from `depart_tick` to `arrive_tick`. */
export function packetProgress(packet: PacketView, tick: number): number {
  const span = packet.arrive_tick - packet.depart_tick;
  if (span <= 0) return EDGE_LENGTH;
  const done = (tick - packet.depart_tick) / span;
  return Math.min(1, Math.max(0, done)) * EDGE_LENGTH;
}

/**
 * Position of an enemy figure between its place in `a` and in `b`, `alpha` in [0, 1] (DEC-33).
 *
 * The figure is the same one only when `b` has the same `id` on the same road going the same way:
 * the server gives a group that comes out of the fog a new `id` (detail 5), so a figure that is
 * gone (arrived, or went into the fog) or whose `id` changed stays where it was in `a` and the
 * line is not drawn through the gap. No extrapolation either.
 */
export function interpolateEnemy(
  a: RenderEnemy,
  next: ReadonlyMap<string, RenderEnemy>,
  alpha: number,
): RenderEnemy {
  const b = next.get(a.figure.id);
  if (b === undefined || b.edge !== a.edge || b.figure.toward_b !== a.figure.toward_b) return a;
  return { ...a, pos: lerp(a.pos, b.pos, alpha) };
}

function enemiesOf(snapshot: SnapshotMsg): RenderEnemy[] {
  return snapshot.view.edges.flatMap((edge) =>
    edge.enemy_groups.map((figure) => ({ edge: edge.id, figure, pos: figure.pos })),
  );
}

/**
 * The frame at render time `tick` between `a` and `b` (`null`: nothing newer yet, hold `a`).
 * `tick` is clamped to [a.tick, b.tick].
 */
export function interpolateFrame(a: SnapshotMsg, b: SnapshotMsg | null, tick: number): RenderFrame {
  const end = b === null ? a.tick : b.tick;
  const at = Math.min(end, Math.max(a.tick, tick));
  const alpha = b === null || b.tick === a.tick ? 0 : (at - a.tick) / (b.tick - a.tick);
  const next = new Map(b?.view.groups.map((g) => [g.id, g]));
  const enemies = enemiesOf(a);
  const ahead = new Map((b === null ? [] : enemiesOf(b)).map((enemy) => [enemy.figure.id, enemy]));
  return {
    tick: at,
    base: a,
    groups: a.view.groups.map((group) => ({
      group,
      location: interpolateLocation(group.location, next.get(group.id)?.location ?? null, alpha),
    })),
    packets: a.view.packets.map((packet) => ({ packet, progress: packetProgress(packet, at) })),
    enemies: enemies.map((enemy) => interpolateEnemy(enemy, ahead, alpha)),
  };
}
