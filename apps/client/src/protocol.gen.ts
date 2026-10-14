// Generated from packages/protocol/protocol.schema.json (gow_protocol), do not edit. Regenerate: uv run python scripts/export_schema.py && pnpm -C apps/client gen:protocol

/**
 * Wire format of Skill-Based Front, generated from gow_protocol.
 */
export type Protocol = ClientMsg | ServerMsg | MapFile;
export type ClientMsg =
  HelloMsg | CommandMsg | PingMsg | ResyncMsg | PauseMsg | ResumeMsg | ReachQueryMsg;
export type Command =
  | MoveCmd
  | SplitCmd
  | MergeCmd
  | SetModeCmd
  | SetStanceCmd
  | UpgradeRoadCmd
  | RecruitCmd
  | CancelOrderCmd
  | SetPriorityCmd
  | TransferCmd
  | ForfeitCmd;
/**
 * Group mode (mechanics.md, section 3; effects: DEC-08). Roads are built by cities (DEC-16).
 */
export type Mode = 'attack' | 'defense';
/**
 * CP stance: the share of CP regeneration that goes into charges (DEC-02).
 */
export type Stance = 'economy' | 'balance' | 'war';
/**
 * Supply priority of a city (DEC-18, item 1): only the order of delivery, not the target.
 */
export type Priority = 'high' | 'normal' | 'low';
export type ServerMsg =
  | WelcomeMsg
  | SnapshotMsg
  | AckMsg
  | EventMsg
  | MatchEndMsg
  | ErrorMsg
  | PongMsg
  | PausedMsg
  | ReachMsg;
export type PlayerId = 0 | 1;
/**
 * How much a player sees of a node or an edge (DEC-04, mechanics.md, section 10).
 */
export type Detail = 'exact' | 'presence' | 'fog';
/**
 * Type of a road (DEC-22, item 2): chosen by the first upgrade, never changes after.
 */
export type RoadKind = 'none' | 'fast' | 'freight';
export type Location = AtNodeLoc | OnEdgeLoc;
/**
 * Publicly visible intent types (DEC-04, DEC-08).
 */
export type IntentKind = 'planned_move' | 'defense';
/**
 * How the match ended (DEC-03, DEC-05).
 */
export type EndReason = 'capital_captured' | 'timer' | 'forfeit' | 'disconnect' | 'double_defeat';
export type Terrain = 'plains' | 'forest' | 'mountains';
/**
 * Kind of a node (DEC-22, item 1; DEC-23, item 1): its capacity is ``capacity.by_kind``.
 */
export type NodeKind = 'capital' | 'city_large' | 'city_medium' | 'city_small' | 'province';

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
/**
 * The own city ``node`` raises the internal road ``edge`` by one level (DEC-16, DEC-22).
 *
 * ``kind`` is required by the first upgrade (level 1 -> 2) and chooses the road type; for the
 * second it may be omitted or must equal the road's type (``ROAD_KIND_MISMATCH`` otherwise).
 */
export interface UpgradeRoadCmd {
  type: 'upgrade_road';
  node: number;
  edge: number;
  kind: ('fast' | 'freight') | null;
}
export interface RecruitCmd {
  type: 'recruit';
  node: number;
}
export interface CancelOrderCmd {
  type: 'cancel_order';
  group: string;
}
/**
 * Supply priority ``level`` of the own city ``node`` (DEC-18, item 1).
 */
export interface SetPriorityCmd {
  type: 'set_priority';
  node: number;
  level: Priority;
}
/**
 * Ship ``n`` charges from the warehouse of the own city ``from_node`` to the own city
 * ``to_node`` along own roads, once (DEC-18, item 6). The ``ack`` carries the path and the
 * arrival tick; the client never computes them.
 */
export interface TransferCmd {
  type: 'transfer';
  from_node: number;
  to_node: number;
  n: number;
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
 * Ask where an own standing group can be ordered to and how long it takes (DEC-20, D5).
 *
 * The answer is ``reach``. The interface sends it when a group is selected; the connection's
 * message rate limit covers it like every other message.
 */
export interface ReachQueryMsg {
  type: 'reach_query';
  group: string;
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
  /**
   * Nicks of the two players by player id (ui-style U3); the bot of a bot match is ``Bot``.
   * Not secret (visible in the waiting room and the queue), so not part of the ``PlayerView``.
   *
   * @minItems 2
   * @maxItems 2
   */
  nicks: [string, string];
}
export interface RulesetPublic {
  tick_hz: number;
  match_ticks: number;
  cp: CpPublic;
  cost: CostsPublic;
  combat: CombatPublic;
  build: BuildPublic;
  economy: EconomyPublic;
  orders: OrdersPublic;
  capacity: CapacityPublic;
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
  /**
   * ``set_priority`` (DEC-18, item 1).
   */
  priority: number;
  /**
   * ``transfer`` (DEC-18, item 6).
   */
  transfer: number;
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
 * Road upgrades by a city (``build`` of the ruleset, DEC-16).
 */
export interface BuildPublic {
  ticks_per_level: number;
  /**
   * One price per new level ``2..3`` (DEC-22), ascending.
   */
  charges_per_level: LevelPrice[];
}
/**
 * Charges from the city warehouse for raising a road to level ``width`` (DEC-16, DEC-22).
 */
export interface LevelPrice {
  width: number;
  charges: number;
}
/**
 * The charge production the stance menu shows (``economy`` of the ruleset, DEC-02).
 */
export interface EconomyPublic {
  stance_to_charges_pct: StancePctPublic;
  /**
   * Charges per whole CP put into charges.
   */
  charges_per_cp: number;
  passive_amount: number;
  /**
   * The capital makes ``passive_amount`` charges every ``passive_period_ticks`` in any stance.
   */
  passive_period_ticks: number;
}
/**
 * ``economy.stance_to_charges_pct``: the share of the CP quantum put into charges, in %.
 */
export interface StancePctPublic {
  economy: number;
  balance: number;
  war: number;
}
/**
 * Delays of planned orders and modes, and the stance cooldown (``orders`` of the ruleset).
 */
export interface OrdersPublic {
  planned_delay_ticks: number;
  defense_delay_ticks: number;
  stance_cooldown_ticks: number;
}
/**
 * Overcrowding attrition (``capacity`` of the ruleset), for the countdown of ui-style 12.
 */
export interface CapacityPublic {
  /**
   * Ticks over the capacity in a row before one unit dies.
   */
  attrition_ticks: number;
  /**
   * Ticks after a capture in which the garrison is not counted.
   */
  grace_ticks: number;
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
   * Capacity by the node kind (DEC-22, item 1): public and exact for every node.
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
  /**
   * The city's road build (DEC-16): own always, an enemy one only while its edge is unfogged.
   */
  build: NodeBuild | null;
  /**
   * Own node only: ticks until the next unit dies of overcrowding (the garrison exceeds the
   * capacity and the grace after a capture is over). ``None`` for every other node.
   */
  attrition_in: number | null;
  /**
   * Own node only: ticks the grace after a capture still lasts while the garrison exceeds the
   * capacity. ``None`` for every other node.
   */
  grace_left: number | null;
  /**
   * Own city only: its supply priority (DEC-18, item 1). ``None`` for provinces, the enemy's
   * and neutral nodes (DEC-18, item 8).
   */
  priority: Priority | null;
  /**
   * Own cut-off city only: ticks until its garrison next starves (DEC-19, item 8). ``None``
   * for every other node.
   */
  starve_in: number | null;
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
   * @maxItems 2
   */
  enemy_modes: Mode[];
  enemy_units: number | null;
  enemy_charged: number | null;
}
/**
 * A road level the city builds (DEC-16): ``edge`` is one of the city's roads.
 */
export interface NodeBuild {
  edge: number;
  /**
   * The tick the width grows; only for an own build.
   */
  done_tick: number | null;
}
export interface EdgeView {
  id: number;
  /**
   * Road level the player knows (DEC-17, DEC-22): the current one unless ``detail`` is
   * ``fog``; in fog the last seen level, or 1 if never seen. Never above the true level.
   */
  width: number;
  /**
   * Road type the player knows, by the same rule (DEC-22, item 8): ``none`` on level 1.
   */
  kind: RoadKind;
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
 * What the next road level would give, per road type (DEC-22, item 7): both types on
 * level 1, only the road's own type on level 2.
 */
export interface UpgradeGain {
  fast: RoadGain | null;
  freight: RoadGain | null;
}
/**
 * What one more level of one road type adds (DEC-22, item 7).
 */
export interface RoadGain {
  /**
   * Packet speed gain in percentage points.
   */
  speed_pct: number;
  /**
   * Gain in charges per road and dispatch period.
   */
  amount: number;
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
 * Own charges on the way along a path of roads (mechanics.md, section 7; DEC-18, item 5).
 *
 * ``edge`` is the current road, travelled away from ``from_node`` during
 * ``depart_tick..arrive_tick``; ``path``: the nodes still to reach, the end of ``edge`` first,
 * the destination last; ``dest_tick``: the tick it reaches the destination if nothing stops it.
 * ``transfer``: a one-off transfer (DEC-18, item 6), not the automatic dispatch.
 */
export interface PacketView {
  id: string;
  edge: number;
  from_node: number;
  charges: number;
  depart_tick: number;
  arrive_tick: number;
  /**
   * @minItems 1
   */
  path: [number, ...number[]];
  dest_tick: number;
  transfer: boolean;
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
 * ``path``: for an accepted ``move``, the nodes from the group's node to ``dest``; for an
 * accepted ``transfer`` (DEC-18), the nodes from ``from_node`` to ``to_node`` (the client draws
 * it and never computes it); ``None`` otherwise.
 * ``arrive_tick``: for an accepted ``move``, the tick the group reaches ``dest`` (planned delay
 * included; DEC-22, item 10); for an accepted ``transfer``, the tick the charges reach
 * ``to_node``; both if nothing stops them; ``None`` otherwise.
 * ``reject_code``: code of the simulation's ``Reject`` (``NOT_FOUND_OR_HIDDEN``,
 * ``NOT_ENOUGH_CP``, ``RECRUIT_COOLDOWN``, ... from SIM-04 #20).
 */
export interface AckMsg {
  type: 'ack';
  seq: number;
  applied_tick: number;
  path: [number, ...number[]] | null;
  arrive_tick: number | null;
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
  /**
   * Rating change of the receiving player; ``None``: the match is not rated (DEC-06).
   */
  rating: RatingChange | null;
}
/**
 * The rating of the receiving player before and after a rated match (RAT-02, #75).
 *
 * Both numbers are the displayed rating (``r - 2 * RD``, RAT-01), rounded to integers.
 */
export interface RatingChange {
  before: number;
  after: number;
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
/**
 * Answer to ``reach_query``, computed by the server on the state after tick ``tick``
 * (DEC-20, D5; DEC-22, item 10). The client highlights ``nodes``, shows their travel time and
 * suggests splitting the group for ``split``; it computes neither. Both lists are empty for a
 * group that is unknown, not own, hidden or on an edge.
 */
export interface ReachMsg {
  type: 'reach';
  group: string;
  tick: number;
  /**
   * Nodes a ``move`` of the group is accepted to now, by node id.
   */
  nodes: ReachNode[];
  /**
   * Nodes a ``move`` is rejected to with ``STACK_LIMIT``: only a smaller group gets there.
   */
  split: number[];
}
export interface ReachNode {
  node: number;
  /**
   * Ticks of the path once the group departs (a planned order waits its delay first).
   */
  ticks: number;
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
  /**
   * Node kind: its capacity is ``capacity.by_kind`` of the ruleset (DEC-22).
   */
  kind: NodeKind;
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
  /**
   * Road level at the start: always 1 (DEC-22).
   */
  base_width: number;
  /**
   * Highest road level, at most 3 (DEC-22).
   */
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

export const PROTOCOL_VERSION = 12;
export const CLOSE_PROTOCOL_VERSION = 4001;
export const CLOSE_REPLACED = 4009;
