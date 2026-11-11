/**
 * The frames file of a replay (SRV-07, #54; format in `docs/design/replay-frames.md`).
 *
 * The server serves it gzipped with `Content-Encoding: gzip`, so the browser hands over plain
 * JSON. `parseReplay` checks the `format` field and the shape the viewer dereferences; a file with
 * an unknown format is refused, never half-read.
 */
import type {
  Detail,
  EndReason,
  MapFile,
  Mode,
  PlayerColour,
  PlayerId,
  Stance,
} from '../protocol.gen.ts';
import { PLAYER_COLOURS } from '../theme/tokens.ts';

/**
 * The formats this viewer reads. A format 1 file has no buildings unless it was written between
 * the two parts of #905 (then it has the keys `c` and `d`, and they are drawn); a file with any
 * other `format` is refused.
 */
const READABLE_FORMATS: readonly number[] = [1, 2];

/** Why a file cannot be shown. `format`: a version this viewer does not know; `invalid`: not a replay. */
export class ReplayError extends Error {
  constructor(readonly code: 'format' | 'invalid') {
    super(`replay file refused: ${code}`);
    this.name = 'ReplayError';
  }
}

/** `[cp, vp, stance, forfeited]` of one player; CP in hundredths. */
type FramePlayer = [number, number, Stance, number];
/**
 * `[owner, warehouse, capacity]` of one node, plus the places of its warehouse (`null` in a province):
 * the fourth element is missing in files from before #556, which then show the node capacity.
 */
type FrameNode =
  [PlayerId | null, number, number] | [PlayerId | null, number, number, number | null];
/** `[id, owner, edge, from_node, charges, depart_tick, arrive_tick]`. */
type FramePacket = [number, PlayerId, number, number, number, number, number];
/** `[id, owner, kind, origin, target]`. */
type FrameIntent = [number, PlayerId, string, number, number | null];
/** `[node, edge, done_tick]`: a road build of a city, only in files from before DEC-28 (DEC-16). */
type FrameBuild = [number, number, number];
/** `[edge, owner, done_tick]`: a road build on an edge (DEC-28, item 7). */
type FrameEdgeBuild = [number, PlayerId, number];

/** `[done_tick, owed]` of a build (`done_tick` `null` while `owed` is above 0, DEC-41, item 7). */
type FrameBuildSite = [number | null, number];

/**
 * The buildings of a city (#905): `[node, factory, factory_build, barracks, build, recruit, rally]`,
 * trailing `null`s left out. `factory`: the owner of its factory; `barracks` 0/1; `recruit`:
 * `[queue, progress, waiting]`; `rally`: the node its new units walk to.
 */
export type FrameCity = [
  number,
  (PlayerId | null)?,
  (FrameBuildSite | null)?,
  number?,
  (FrameBuildSite | null)?,
  ([number, number, number] | null)?,
  (number | null)?,
];

/** A road fortification `[edge, node, built, ready]` (#905): of the owner of `node`. */
type FrameFort = [number, number, number, number];

/** An enemy city a side saw (#905, DEC-31): `[node, factory, barracks]`, 0/1 each. */
export type FrameSeenCity = [number, number, number];

/** An enemy fortification a side saw (#905, DEC-43, item D8): `[edge, node, built]`. */
type FrameSeenFort = [number, number, number];

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
  /** Road builds of cities, by node id: only in files from before DEC-28 (DEC-16). */
  b?: FrameBuild[];
  /** Road builds, by edge id; absent while no road is being built (DEC-28). */
  e?: FrameEdgeBuild[];
  /**
   * Road types by edge id, only in files from before DEC-26 (DEC-22); read and ignored: roads have
   * no type now.
   */
  r?: string[];
  /** Fights going on (DEC-24); absent while there is none (and in older files). */
  f?: FrameFight[];
  /**
   * What each player saw at this tick, `[player 0, player 1]` (#598, "Vision" in
   * `docs/design/replay-frames.md`); absent in older files. `parseReplay` keeps it only when every
   * frame of the file has a sound one.
   */
  v?: [FrameVision, FrameVision];
  /** The buildings of both players (#905), only the cities with any; absent in older files. */
  c?: FrameCity[];
  /** The road fortifications of both players (#905); absent while there are none. */
  d?: FrameFort[];
}

/** `low..high` of the enemy units; `high` `null`: open (`UnitsRange`). */
type FrameRange = [number, number | null];

/**
 * A sighting `[level, modes, units, charged, range, tick]` (`Seen`), trailing `null`s left out;
 * `tick` only in fog (a place not in fog is seen in the frame's tick).
 */
export type FrameSighting = [
  Detail,
  Mode[],
  (number | null)?,
  (number | null)?,
  (FrameRange | null)?,
  (number | null)?,
];

/** `[detail, seen, warehouse]` of a node as the player saw it (`NodeView`), trailing `null`s left out. */
type FrameVisionNode = [Detail, (FrameSighting | null)?, (number | null)?];

/** `[detail, seen]` of a half of an edge (`HalfView`). */
export type FrameHalf = [Detail, (FrameSighting | null)?];

/**
 * An enemy figure `[id, pos, toward_b, detail, mode, units, charged, range]` (`EnemyGroup`); the
 * id is opaque and names no group of `g`.
 */
export type FrameFigure = [
  string,
  number,
  number,
  Detail,
  Mode,
  (number | null)?,
  (number | null)?,
  (FrameRange | null)?,
];

/** `[width, detail, half_a, half_b, figures]` of an edge as the player saw it (`EdgeView`). */
type FrameVisionEdge = [number, Detail, FrameHalf, FrameHalf, FrameFigure[]?];

/** The fog part of one player's `PlayerView` at the frame's tick (#598). */
export interface FrameVision {
  n: FrameVisionNode[];
  e: FrameVisionEdge[];
  /** Edges whose road build the player saw; absent while there are none. */
  b?: number[];
  /** The enemy cities whose buildings the player saw (#905, DEC-31); absent while there are none. */
  c?: FrameSeenCity[];
  /** The enemy fortifications the player saw (#905, DEC-43, item D8); absent while there are none. */
  d?: FrameSeenFort[];
}

/** A pair `[player 0, player 1]`. */
type PlayerPair = [number, number];

/**
 * The round data of a fight (#323), the ninth element of its record: `shots` and `losses` (the
 * totals of the fight so far), `virtual_left` (the bonus shots left, DEC-32) and `last_round`:
 * `null` before the first round, else `[tick, shots, virtual, spent, losses]`.
 */
type FrameFightRounds = [
  PlayerPair,
  PlayerPair,
  PlayerPair,
  [number, PlayerPair, PlayerPair, PlayerPair, PlayerPair] | null,
];

/**
 * `[id, node, edge, point, attacker, start, next_round, groups]` of a fight (DEC-24): `point` is
 * twice the meeting position from the end `a` of the edge (0..2000), `null` in a node. A record of
 * nine elements has the round data (#323) at the end; one of eight is from an older file (the
 * arena stays empty).
 */
type FrameFight =
  | [number, number | null, number | null, number | null, PlayerId | null, number, number, number[]]
  | [
      number,
      number | null,
      number | null,
      number | null,
      PlayerId | null,
      number,
      number,
      number[],
      FrameFightRounds,
    ];

/** `[tick, kind, data]`; `data` is the flat object of the simulation event. */
type FileEvent = [number, string, Record<string, boolean | number | string | null>];

/**
 * The rule numbers the viewer draws the buildings with (header `rules`, #905): ticks and prices of
 * the builds and the recruit queue, as the match played them. Files before it have none: the time
 * bars are then left out.
 */
interface ReplayRules {
  unit_ticks: number;
  queue_max: number;
  barracks_ticks: number;
  barracks_charges: number;
  factory_ticks: number;
  factory_charges: number;
  fort_ticks: number;
}

export interface ReplayFile {
  format: number;
  map_id: string;
  tick_hz: number;
  frame_every: number;
  /** The last tick of the match. */
  ticks: number;
  outcome: { winner: PlayerId | null; reason: EndReason };
  vp: [number, number];
  /**
   * The nicks of the two players by player id, when the server wrote them (#598, optional header
   * key). Older files have none: the viewer says "Player 1" and "Player 2".
   */
  nicks?: [string, string];
  /**
   * The colours of the two players by player id (DEC-49, #906, optional header key), as the match
   * had them. Older files have none: the viewer draws today's look (the watched side Lapis, the
   * other Minium).
   */
  colours?: [PlayerColour, PlayerColour];
  /** The rule numbers of the buildings (format 2); absent in older files. */
  rules?: ReplayRules;
  map: MapFile;
  /** Ascending by `t`; the first is tick 0. */
  frames: ReplayFrame[];
  events: FileEvent[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);
const isPair = (v: unknown): v is PlayerPair =>
  Array.isArray(v) && v.length === 2 && v.every(isInt);

/** Whether `v` is the round data of a fight record (#323). */
const isFightRounds = (v: unknown): v is FrameFightRounds =>
  Array.isArray(v) &&
  v.length === 4 &&
  isPair(v[0]) &&
  isPair(v[1]) &&
  isPair(v[2]) &&
  (v[3] === null ||
    (Array.isArray(v[3]) &&
      v[3].length === 5 &&
      isInt(v[3][0]) &&
      [1, 2, 3, 4].every((i) => isPair((v[3] as unknown[])[i]))));

/** A fight record of an old file (eight elements) or of a new one (nine, with the round data). */
const isFightRecord = (v: unknown): v is FrameFight =>
  Array.isArray(v) && (v.length === 8 || (v.length === 9 && isFightRounds(v[8])));

const DETAILS: readonly unknown[] = ['exact', 'range', 'presence', 'fog'] satisfies Detail[];
const isDetail = (v: unknown): v is Detail => DETAILS.includes(v);
const isIntOrNull = (v: unknown): boolean => v === undefined || v === null || isInt(v);
const isRange = (v: unknown): boolean =>
  v === undefined ||
  v === null ||
  (Array.isArray(v) && v.length === 2 && isInt(v[0]) && isIntOrNull(v[1]));
const isSighting = (v: unknown): boolean =>
  v === undefined ||
  v === null ||
  (Array.isArray(v) &&
    isDetail(v[0]) &&
    Array.isArray(v[1]) &&
    isIntOrNull(v[2]) &&
    isIntOrNull(v[3]) &&
    isRange(v[4]) &&
    isIntOrNull(v[5]));
const isHalf = (v: unknown): boolean => Array.isArray(v) && isDetail(v[0]) && isSighting(v[1]);
const isFigure = (v: unknown): boolean =>
  Array.isArray(v) &&
  typeof v[0] === 'string' &&
  isInt(v[1]) &&
  isInt(v[2]) &&
  isDetail(v[3]) &&
  typeof v[4] === 'string' &&
  isIntOrNull(v[5]) &&
  isIntOrNull(v[6]) &&
  isRange(v[7]);

const isSite = (v: unknown): boolean =>
  v === undefined ||
  v === null ||
  (Array.isArray(v) && v.length === 2 && (v[0] === null || isInt(v[0])) && isInt(v[1]));
const isQueue = (v: unknown): boolean =>
  v === undefined || v === null || (Array.isArray(v) && v.length === 3 && v.every(isInt));
const isCity = (v: unknown, nodes: number): boolean =>
  Array.isArray(v) &&
  isInt(v[0]) &&
  v[0] >= 0 &&
  v[0] < nodes &&
  isIntOrNull(v[1]) &&
  isSite(v[2]) &&
  isIntOrNull(v[3]) &&
  isSite(v[4]) &&
  isQueue(v[5]) &&
  isIntOrNull(v[6]);
const isFort = (v: unknown, nodes: number, edges: number, length: number): boolean =>
  Array.isArray(v) &&
  v.length === length &&
  v.every(isInt) &&
  (v[0] as number) >= 0 &&
  (v[0] as number) < edges &&
  (v[1] as number) >= 0 &&
  (v[1] as number) < nodes;
const isSeenCity = (v: unknown, nodes: number): boolean =>
  Array.isArray(v) &&
  v.length === 3 &&
  v.every(isInt) &&
  (v[0] as number) >= 0 &&
  (v[0] as number) < nodes;

/** Whether `v` is the per-player key of a frame (#598) for a map of `nodes` nodes and `edges` edges. */
function isVision(v: unknown, nodes: number, edges: number): v is [FrameVision, FrameVision] {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    v.every(
      (side) =>
        isObj(side) &&
        Array.isArray(side.n) &&
        side.n.length === nodes &&
        side.n.every(
          (n) => Array.isArray(n) && isDetail(n[0]) && isSighting(n[1]) && isIntOrNull(n[2]),
        ) &&
        Array.isArray(side.e) &&
        side.e.length === edges &&
        side.e.every(
          (e) =>
            Array.isArray(e) &&
            isInt(e[0]) &&
            isDetail(e[1]) &&
            isHalf(e[2]) &&
            isHalf(e[3]) &&
            (e[4] === undefined || (Array.isArray(e[4]) && e[4].every(isFigure))),
        ) &&
        (side.b === undefined || (Array.isArray(side.b) && side.b.every(isInt))) &&
        (side.c === undefined ||
          (Array.isArray(side.c) && side.c.every((c) => isSeenCity(c, nodes)))) &&
        (side.d === undefined ||
          (Array.isArray(side.d) && side.d.every((d) => isFort(d, nodes, edges, 3)))),
    )
  );
}

/**
 * Whether the file has what each player saw (#598): then the viewer can show one side with its
 * fog. Older files (and a file with a damaged key) have none.
 */
export function hasVision(file: ReplayFile): boolean {
  return file.frames.every((frame) => frame.v !== undefined);
}

/**
 * Whether the file has buildings (#905): a format 2 file always does (the capitals are factories),
 * a format 1 one only when it was written between the two parts of #905.
 */
export function hasBuildings(file: ReplayFile): boolean {
  return file.frames.some((frame) => frame.c !== undefined);
}

const RULE_KEYS: readonly (keyof ReplayRules)[] = [
  'unit_ticks',
  'queue_max',
  'barracks_ticks',
  'barracks_charges',
  'factory_ticks',
  'factory_charges',
  'fort_ticks',
];
const isRules = (v: unknown): v is ReplayRules =>
  isObj(v) && RULE_KEYS.every((key) => isInt(v[key]) && v[key] >= 0);

const isNick = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

function readNicks(raw: unknown): [string, string] | null {
  const [first, second]: unknown[] = Array.isArray(raw)
    ? (raw as unknown[])
    : isObj(raw)
      ? [raw['0'], raw['1']]
      : [];
  return isNick(first) && isNick(second) ? [first, second] : null;
}

const isColour = (v: unknown): v is PlayerColour =>
  typeof v === 'string' && Object.hasOwn(PLAYER_COLOURS, v);

/** The colours of the header (DEC-49): both known colours by player id, else none. */
function readColours(raw: unknown): [PlayerColour, PlayerColour] | null {
  const [first, second]: unknown[] = Array.isArray(raw)
    ? (raw as unknown[])
    : isObj(raw)
      ? [raw['0'], raw['1']]
      : [];
  return isColour(first) && isColour(second) ? [first, second] : null;
}

/** The parsed JSON as a `ReplayFile`; throws `ReplayError`. */
export function parseReplay(raw: unknown): ReplayFile {
  if (!isObj(raw)) throw new ReplayError('invalid');
  if (typeof raw.format !== 'number' || !READABLE_FORMATS.includes(raw.format)) {
    throw new ReplayError('format');
  }
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
        (f.e === undefined || Array.isArray(f.e)) &&
        (f.r === undefined ||
          (Array.isArray(f.r) && f.r.length === (map.edges as unknown[]).length)) &&
        (f.f === undefined || (Array.isArray(f.f) && f.f.every(isFightRecord))),
    );
  if (!sound) throw new ReplayError('invalid');
  const file = raw as unknown as ReplayFile;
  // The optional header key: an array by player id or an object keyed "0" and "1". Anything
  // else (a shape this version does not know) is ignored, never an error.
  const nicks = readNicks(raw.nicks);
  if (nicks === null) delete file.nicks;
  else file.nicks = nicks;
  // The colours (DEC-49): the same, and a colour this version does not know drops the key.
  const colours = readColours(raw.colours);
  if (colours === null) delete file.colours;
  else file.colours = colours;
  // The optional per-player key (#598): kept only when every frame has a sound one, so a side is
  // either shown whole with its fog or not at all. A damaged key is dropped, never an error.
  const nodes = file.map.nodes.length;
  const edges = file.map.edges.length;
  if (!file.frames.every((frame) => isVision(frame.v, nodes, edges))) {
    for (const frame of file.frames) delete frame.v;
  }
  // The buildings (#905): kept only when every frame's keys are sound, else none are drawn (a
  // damaged key is dropped, never an error). A file without the keys has no buildings.
  const sane = file.frames.every(
    (frame) =>
      (frame.c === undefined ||
        (Array.isArray(frame.c) && frame.c.every((city) => isCity(city, nodes)))) &&
      (frame.d === undefined ||
        (Array.isArray(frame.d) && frame.d.every((fort) => isFort(fort, nodes, edges, 4)))),
  );
  if (!sane) {
    for (const frame of file.frames) {
      delete frame.c;
      delete frame.d;
    }
  }
  if (!isRules(raw.rules)) delete file.rules;
  return file;
}
