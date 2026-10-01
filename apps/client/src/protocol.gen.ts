// Generated from packages/protocol/protocol.schema.json (gow_protocol), do not edit. Regenerate: uv run python scripts/export_schema.py && pnpm -C apps/client gen:protocol

/**
 * Wire format of Skill-Based Front, generated from gow_protocol.
 */
export type Protocol = ClientMsg | ServerMsg | MapFile;
export type ClientMsg = HelloMsg | CommandMsg | PingMsg | ResyncMsg | PauseMsg | ResumeMsg;
export type Command =
  | MoveCmd
  | SplitCmd
  | MergeCmd
  | SetModeCmd
  | SetStanceCmd
  | UpgradeRoadCmd
  | RecruitCmd
  | CancelOrderCmd
  | ForfeitCmd;
/**
 * Group mode (mechanics.md, section 3; effects: DEC-08).
 */
export type Mode = 'attack' | 'defense' | 'build';
/**
 * CP stance: the share of CP regeneration that goes into charges (DEC-02).
 */
export type Stance = 'economy' | 'balance' | 'war';
export type ServerMsg =
  WelcomeMsg | SnapshotMsg | AckMsg | EventMsg | MatchEndMsg | ErrorMsg | PongMsg | PausedMsg;
export type PlayerId = 0 | 1;
/**
 * How much a player sees of a node or an edge (DEC-04, mechanics.md, section 10).
 */
export type Detail = 'exact' | 'presence' | 'fog';
export type Location = AtNodeLoc | OnEdgeLoc;
/**
 * Publicly visible intent types (DEC-04, DEC-08).
 */
export type IntentKind = 'planned_move' | 'defense' | 'build';
/**
 * How the match ended (DEC-03, DEC-05).
 */
export type EndReason = 'capital_captured' | 'timer' | 'forfeit' | 'disconnect' | 'double_defeat';
export type Terrain = 'plains' | 'forest' | 'mountains';

/**
 * First message of a connection. The token is never in the URL, a log or an error text.
 */
export interface HelloMsg {
  type: 'hello';
  protocol_version: number;
  /**
   * Guest token from ``POST /api/guest`` (``secrets.token_urlsafe``, ID-01 #43).
   */
  token: string;
}
export interface CommandMsg {
  type: 'command';
  /**
   * Client sequence number of the command, strictly increasing; ``ack`` echoes it.
   */
  seq: number;
  cmd: Command;
}
export interface MoveCmd {
  type: 'move';
  group: string;
  dest: number;
  /**
   * Planned order (DEC-08): costlier, visible to everyone as an intent, starts after a delay.
   */
  planned: boolean;
}
export interface SplitCmd {
  type: 'split';
  group: string;
  /**
   * Units that leave ``group`` as a new group.
   */
  n: number;
}
export interface MergeCmd {
  type: 'merge';
  /**
   * @minItems 2
   * @maxItems 16
   */
  groups: [string, string, ...string[]];
}
export interface SetModeCmd {
  type: 'set_mode';
  group: string;
  mode: Mode;
}
export interface SetStanceCmd {
  type: 'set_stance';
  stance: Stance;
}
export interface UpgradeRoadCmd {
  type: 'upgrade_road';
  group: string;
  edge: number;
}
export interface RecruitCmd {
  type: 'recruit';
  node: number;
}
export interface CancelOrderCmd {
  type: 'cancel_order';
  group: string;
}
export interface ForfeitCmd {
  type: 'forfeit';
}
/**
 * Application-level ping for RTT (browsers do not expose protocol pings).
 */
export interface PingMsg {
  type: 'ping';
  /**
   * Echoed in ``pong``; the client measures the time itself.
   */
  id: number;
}
/**
 * Ask for a full snapshot now (after a gap in snapshots).
 */
export interface ResyncMsg {
  type: 'resync';
}
/**
 * Pause a private match (DEC-05): one pause per player, at most ``paused.ends_in_s`` long.
 *
 * Refused with ``error`` ``PAUSE_DENIED`` in a rated match, with no pause left or while paused.
 */
export interface PauseMsg {
  type: 'pause';
}
/**
 * End a pause early. Only the player who paused may; else ``error`` ``PAUSE_DENIED``.
 */
export interface ResumeMsg {
  type: 'resume';
}
/**
 * Answer to a valid ``hello``, also after a reconnect; a full ``snapshot`` follows.
 */
export interface WelcomeMsg {
  type: 'welcome';
  player: PlayerId;
  ruleset_public: RulesetPublic;
  /**
   * The map graph itself is public and comes over HTTP (``GET /api/maps/{id}``).
   */
  map_id: string;
  /**
   * Highest ``seq`` of this player the server has accepted; ``0`` if none. After a reconnect
   * the client resends only its commands with a greater ``seq``.
   */
  last_seq: number;
}
export interface RulesetPublic {
  tick_hz: number;
  match_ticks: number;
  cp: CpPublic;
  cost: CostsPublic;
  combat: CombatPublic;
}
/**
 * CP regeneration: ``per_period`` hundredths every ``period_ticks`` ticks, up to ``cap``.
 */
export interface CpPublic {
  cap: number;
  per_period: number;
  period_ticks: number;
}
/**
 * Command costs in hundredths of CP (``orders.cost`` of the ruleset).
 */
export interface CostsPublic {
  move: number;
  planned_move: number;
  cancel: number;
  split: number;
  merge: number;
  attack: number;
  defense: number;
  build: number;
  recruit: number;
  stance: number;
}
export interface CombatPublic {
  terrain_defense_mod: TerrainDefensePublic;
  planned_bonus: number;
  defense_bonus: number;
}
/**
 * ``terrain.defense_mod``: charges added to the node defender's pool; may be negative.
 */
export interface TerrainDefensePublic {
  plains: number;
  forest: number;
  mountains: number;
}
/**
 * The player's view after tick ``tick``. Only the latest one matters (AGENTS.md, 5.3).
 */
export interface SnapshotMsg {
  type: 'snapshot';
  tick: number;
  view: View;
}
export interface View {
  me: SelfView;
  /**
   * VP of both players, by player id; public (DEC-04).
   *
   * @minItems 2
   * @maxItems 2
   */
  vp: [number, number];
  /**
   * Every node of the map, ``nodes[i].id == i``.
   */
  nodes: NodeView[];
  /**
   * Every edge of the map, ``edges[i].id == i``.
   */
  edges: EdgeView[];
  groups: GroupView[];
  packets: PacketView[];
  intents: IntentView[];
}
/**
 * Own counters; the enemy's CP and stance are never in a view (AGENTS.md, section 4.4).
 */
export interface SelfView {
  cp: number;
  stance: Stance;
}
export interface NodeView {
  id: number;
  owner: PlayerId | null;
  /**
   * Current capacity of the city; public for every node (DEC-04).
   */
  capacity: number;
  detail: Detail;
  /**
   * Charges in the warehouse; only for ``EXACT`` nodes.
   */
  warehouse: number | null;
  /**
   * Current sighting for ``EXACT`` and ``PRESENCE``; for ``FOG`` the last one, or ``None``.
   */
  seen: Seen | null;
}
/**
 * What the player sees, or last saw, of one node or edge (``gow_sim.state.Sighting``).
 *
 * ``enemy_modes``: distinct modes of the enemy groups there; empty means no enemy groups.
 * ``enemy_units`` and ``enemy_charged`` are totals, present only when ``level`` is ``EXACT``.
 * ``level`` is never ``FOG``: a place in fog is not seen, it keeps an older ``Seen``.
 */
export interface Seen {
  tick: number;
  level: Detail;
  /**
   * @maxItems 3
   */
  enemy_modes: Mode[];
  enemy_units: number | null;
  enemy_charged: number | null;
}
export interface EdgeView {
  id: number;
  /**
   * Current width; public for every edge (DEC-04).
   */
  width: number;
  /**
   * ``PRESENCE`` or ``FOG``: DEC-04 never shows numbers on edges.
   */
  detail: Detail;
  /**
   * Only for own internal edges that can still be upgraded.
   */
  upgrade_gain: UpgradeGain | null;
  seen: Seen | null;
}
/**
 * What the next road level would give (SIM-11 #27, hint of mechanics.md, section 18).
 */
export interface UpgradeGain {
  /**
   * Capacity gain in hundredths, e.g. 50 for «+0.5».
   */
  capacity_centi: number;
  /**
   * Packet speed gain in percentage points (``supply.packet_speed_pct``).
   */
  packet_speed_pct: number;
}
/**
 * An own group. Enemy groups appear only as ``Seen`` summaries of places.
 */
export interface GroupView {
  id: string;
  units: number;
  charged: number;
  mode: Mode;
  location: Location;
  order: OrderView | null;
}
export interface AtNodeLoc {
  kind: 'node';
  node: number;
}
/**
 * Moving along ``edge`` away from ``from_node``; ``progress`` in thousandths.
 */
export interface OnEdgeLoc {
  kind: 'edge';
  edge: number;
  from_node: number;
  progress: number;
}
/**
 * Current order of an own group: the path is the server's, the client never computes it.
 */
export interface OrderView {
  dest: number;
  /**
   * Remaining nodes to ``dest``, ``dest`` included.
   *
   * @minItems 1
   */
  path: [number, ...number[]];
  planned: boolean;
}
/**
 * Own charges on the way (mechanics.md, section 7).
 */
export interface PacketView {
  id: string;
  edge: number;
  from_node: number;
  charges: number;
  depart_tick: number;
  arrive_tick: number;
}
/**
 * Public part of a planned order or a mode switch: no group id and no group size.
 */
export interface IntentView {
  id: string;
  owner: PlayerId;
  kind: IntentKind;
  origin: number;
  /**
   * ``None`` for an intent without a destination (``defense``).
   */
  target: number | null;
  created_tick: number;
}
/**
 * Result of the command ``seq``: accepted (``reject_code`` is ``None``) or rejected.
 *
 * ``applied_tick``: the tick at whose start the command was validated and, if accepted, applied.
 * ``path``: for an accepted ``move``, the nodes from the group's node to ``dest`` (the client
 * draws it and never computes it); ``None`` otherwise.
 * ``reject_code``: code of the simulation's ``Reject`` (``NOT_FOUND_OR_HIDDEN``,
 * ``NOT_ENOUGH_CP``, ``RECRUIT_COOLDOWN``, ... from SIM-04 #20).
 */
export interface AckMsg {
  type: 'ack';
  seq: number;
  applied_tick: number;
  path: [number, ...number[]] | null;
  reject_code: string | null;
}
/**
 * A simulation event visible to the player (``gow_sim.state.Event``; PRO-03 filters them).
 *
 * ``data`` mirrors ``Event.data``: flat fields with integer, string, boolean or null values.
 * Entity ids in ``data`` are opaque ids (strings), map node and edge ids are integers.
 */
export interface EventMsg {
  type: 'event';
  tick: number;
  kind: string;
  data: {
    /**
     * This interface was referenced by `undefined`'s JSON-Schema definition
     * via the `patternProperty` "^[a-z][a-z0-9_]{0,31}$".
     */
    [k: string]: boolean | number | string | null;
  };
}
export interface MatchEndMsg {
  type: 'match_end';
  tick: number;
  reason: EndReason;
  /**
   * ``None`` is a draw: always for ``double_defeat``, possible for ``timer``, else never.
   */
  winner: PlayerId | null;
  /**
   * Final VP of both players, by player id.
   *
   * @minItems 2
   * @maxItems 2
   */
  vp: [number, number];
}
/**
 * A protocol-level error (malformed message, rate limit, ...); game rejections are ``ack``.
 *
 * ``message`` is a short text for developers. It never echoes the client's input.
 */
export interface ErrorMsg {
  type: 'error';
  code: string;
  message: string | null;
}
export interface PongMsg {
  type: 'pong';
  /**
   * ``id`` of the ``ping``.
   */
  id: number;
}
/**
 * The pause state of the match changed (also sent after ``welcome`` while paused).
 */
export interface PausedMsg {
  type: 'paused';
  paused: boolean;
  /**
   * Player who paused; ``None`` when ``paused`` is false.
   */
  by: PlayerId | null;
  /**
   * Whole seconds until the pause ends by itself; ``None`` when ``paused`` is false.
   */
  ends_in_s: number | null;
}
export interface MapFile {
  meta: MapMetaFile;
  nodes: MapNodeFile[];
  edges: MapEdgeFile[];
  mirror: MapMirrorFile;
}
export interface MapMetaFile {
  /**
   * Map id: ``map_id`` in ``welcome`` and in the replay header.
   */
  name: string;
  /**
   * Revision of the map, bumped on every edit.
   */
  version: number;
  symmetry: 'rot180';
  /**
   * World size: coordinates are in ``[0, width] x [0, height]``, ``y`` grows down.
   */
  width: number;
  height: number;
}
export interface MapNodeFile {
  /**
   * Equals the index in ``nodes``.
   */
  id: number;
  x: number;
  y: number;
  terrain: Terrain;
  vp: number;
  base_capacity: number;
  capital_of: PlayerId | null;
  start_owner: PlayerId | null;
  start_units: number;
  start_charged: number;
  start_stock: number;
}
export interface MapEdgeFile {
  /**
   * Equals the index in ``edges``.
   */
  id: number;
  a: number;
  b: number;
  base_width: number;
  max_width: number;
  travel_ticks: number;
}
/**
 * Symmetry table: id (as a JSON string key) -> id of the mirrored node or edge.
 */
export interface MapMirrorFile {
  nodes: {
    [k: string]: number;
  };
  edges: {
    [k: string]: number;
  };
}

export const PROTOCOL_VERSION = 3;
export const CLOSE_PROTOCOL_VERSION = 4001;
export const CLOSE_REPLACED = 4009;
