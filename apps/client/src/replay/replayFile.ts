/**
 * The frames file of a replay (SRV-07, #54; format in `docs/design/replay-frames.md`).
 *
 * The server serves it gzipped with `Content-Encoding: gzip`, so the browser hands over plain
 * JSON. `parseReplay` checks the `format` field and the shape the viewer dereferences; a file with
 * an unknown format is refused, never half-read.
 */
import type { EndReason, MapFile, Mode, PlayerId, Stance } from '../protocol.gen.ts';

/** The only frames format this viewer reads. */
export const REPLAY_FORMAT = 1;

/** Why a file cannot be shown. `format`: a version this viewer does not know; `invalid`: not a replay. */
export class ReplayError extends Error {
  constructor(readonly code: 'format' | 'invalid') {
    super(`replay file refused: ${code}`);
    this.name = 'ReplayError';
  }
}

/** `[cp, vp, stance, forfeited]` of one player; CP in hundredths. */
export type FramePlayer = [number, number, Stance, number];
/** `[owner, warehouse, capacity]` of one node. */
export type FrameNode = [PlayerId | null, number, number];
/** `[id, owner, edge, from_node, charges, depart_tick, arrive_tick]`. */
export type FramePacket = [number, PlayerId, number, number, number, number, number];
/** `[id, owner, kind, origin, target]`. */
export type FrameIntent = [number, PlayerId, string, number, number | null];
/** `[node, edge, done_tick]`: a road build of a city (DEC-16). */
export type FrameBuild = [number, number, number];

export interface FrameGroup {
  id: number;
  o: PlayerId;
  u: number;
  c: number;
  /** `build`: only in files written before DEC-16 (`sim_version` 2); shown as `attack`. */
  m: Mode | 'build';
  /** Standing in this node. */
  at?: number;
  /** `[edge, from_node, progress, back]`: moving along an edge. */
  on?: [number, number, number, number];
  /** Remaining path of the order. */
  to?: number[];
  /** `1`: the order is planned. */
  pl?: number;
  /** Before DEC-16 only: the group built a road on this edge. Ignored. */
  b?: number;
}

export interface ReplayFrame {
  t: number;
  p: [FramePlayer, FramePlayer];
  n: FrameNode[];
  w: number[];
  g: FrameGroup[];
  k: FramePacket[];
  i: FrameIntent[];
  /** Road builds of cities, by node id; absent while no city builds (DEC-16). */
  b?: FrameBuild[];
  /**
   * Road types by edge id, only in files from before DEC-26 (DEC-22); read and ignored: roads have
   * no type now.
   */
  r?: string[];
  /** Fights going on (DEC-24); absent while there is none (and in older files). */
  f?: FrameFight[];
}

/**
 * `[id, node, edge, point, attacker, start, next_round, groups]` of a fight (DEC-24): `point` is
 * twice the meeting position from the end `a` of the edge (0..2000), `null` in a node.
 */
export type FrameFight = [
  number,
  number | null,
  number | null,
  number | null,
  PlayerId | null,
  number,
  number,
  number[],
];

/** `[tick, kind, data]`; `data` is the flat object of the simulation event. */
export type FileEvent = [number, string, Record<string, boolean | number | string | null>];

export interface ReplayFile {
  format: typeof REPLAY_FORMAT;
  map_id: string;
  tick_hz: number;
  frame_every: number;
  /** The last tick of the match. */
  ticks: number;
  outcome: { winner: PlayerId | null; reason: EndReason };
  vp: [number, number];
  map: MapFile;
  /** Ascending by `t`; the first is tick 0. */
  frames: ReplayFrame[];
  events: FileEvent[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);

/** The parsed JSON as a `ReplayFile`; throws `ReplayError`. */
export function parseReplay(raw: unknown): ReplayFile {
  if (!isObj(raw)) throw new ReplayError('invalid');
  if (raw.format !== REPLAY_FORMAT) throw new ReplayError('format');
  const { frames, events, outcome } = raw;
  const map = raw.map as { nodes?: unknown; edges?: unknown } | null;
  const sound =
    isInt(raw.tick_hz) &&
    raw.tick_hz > 0 &&
    isInt(raw.ticks) &&
    isObj(outcome) &&
    Array.isArray(raw.vp) &&
    isObj(map) &&
    Array.isArray(map.nodes) &&
    Array.isArray(map.edges) &&
    Array.isArray(events) &&
    Array.isArray(frames) &&
    frames.length > 0 &&
    frames.every(
      (f) =>
        isObj(f) &&
        isInt(f.t) &&
        Array.isArray(f.p) &&
        f.p.length === 2 &&
        Array.isArray(f.n) &&
        f.n.length === (map.nodes as unknown[]).length &&
        Array.isArray(f.w) &&
        f.w.length === (map.edges as unknown[]).length &&
        Array.isArray(f.g) &&
        Array.isArray(f.k) &&
        Array.isArray(f.i) &&
        (f.b === undefined || Array.isArray(f.b)) &&
        (f.r === undefined ||
          (Array.isArray(f.r) && f.r.length === (map.edges as unknown[]).length)) &&
        (f.f === undefined || Array.isArray(f.f)),
    );
  if (!sound) throw new ReplayError('invalid');
  return raw as unknown as ReplayFile;
}
