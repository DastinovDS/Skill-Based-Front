// Generated from packages/protocol/protocol.schema.json (gow_protocol), do not edit. Regenerate: uv run python scripts/export_schema.py && pnpm -C apps/client gen:protocol

/**
 * Wire format of Skill-Based Front, generated from gow_protocol.
 */
export type Protocol = ClientMsg | ServerMsg | MapFile;
export type ClientMsg =
  | HelloMsg
  | CommandMsg
  | PingMsg
  | ResyncMsg
  | PauseMsg
  | ResumeMsg
  | ReachQueryMsg
  | LineRouteQueryMsg;
export type Command =
  | MoveCmd
  | SplitCmd
  | MergeCmd
  | SetModeCmd
  | SetStanceCmd
  | UpgradeRoadCmd
  | BuildBarracksCmd
  | UpgradeWarehouseCmd
  | RecruitCmd
  | CancelRecruitCmd
  | CancelOrderCmd
  | SetFrontCmd
  | SetRearMinCmd
  | TransferCmd
  | BuildFactoryCmd
  | BuildBunkerCmd
  | DrawLineCmd
  | RemoveLineCmd
  | SetAutoLinesCmd
  | ReleasePlanCmd
  | ForfeitCmd;
/**
 * Group mode (mechanics.md, section 3; effects: DEC-08). Roads are built by cities (DEC-16).
 */
export type Mode = 'attack' | 'defense';
/**
 * CP stance: the share of CP regeneration that goes into charges (DEC-02).
 */
export type Stance = 'economy' | 'balance' | 'war';
export type ServerMsg =
  | WelcomeMsg
  | SnapshotMsg
  | AckMsg
  | EventMsg
  | MatchEndMsg
  | ErrorMsg
  | PongMsg
  | PausedMsg
  | ReachMsg
  | LineRouteMsg;
export type PlayerId = 0 | 1;
/**
 * ``economy.model`` (DEC-41, #642): ``v1`` is the economy of stances, front markers and
 * donors; ``v2`` the economy of factories and drawn supply lines.
 */
export type EconomyModel = 'v1' | 'v2';
/**
 * What a source of vision shows of a neighbouring node (DEC-21, item 2): the detail levels
 * ``exact``, ``range`` and ``presence`` of ``gow_sim.state.Detail`` (never fog).
 */
export type Sight = 'exact' | 'range' | 'presence';
/**
 * Why a match did not change your rating (DEC-34, #414).
 */
export type UnratedReason =
  | 'casual'
  | 'guest'
  | 'opponent_guest'
  | 'opponent_calibrating'
  | 'opponent_limit'
  | 'opponent_early_resign';
/**
 * How much a player sees of a node or a half of an edge (DEC-21, mechanics.md, section 10).
 *
 * Better first: ``EXACT``, ``RANGE``, ``PRESENCE``, ``FOG``.
 */
export type Detail = 'exact' | 'range' | 'presence' | 'fog';
/**
 * What a city builds (DEC-26, item 9): a road level, the barracks or a warehouse level.
 */
export type BuildKind = 'road' | 'barracks' | 'warehouse';
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
   * Planned order (DEC-08): visible to everyone as an intent. Economy v1: costlier, starts
   * after a delay. Economy v2 (DEC-41, item 10): the price of a move, the group waits and gathers
   * ``bonus``.
   */
  planned: boolean;
  /**
   * Economy v2, a planned order only: the requested attack bonus, at least 1. An ordinary
   * order and any order under v1 give 0; otherwise ``INVALID_ARGUMENT``.
   */
  bonus: number;
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
 * Raise the own internal road ``edge`` by one level for ``cost.build`` CP (DEC-28, item 7);
 * no city pays or builds it.
 */
export interface UpgradeRoadCmd {
  type: 'upgrade_road';
  edge: number;
}
/**
 * The own city ``node`` builds the barracks (DEC-26, ``city_upgrades``): then it recruits.
 */
export interface BuildBarracksCmd {
  type: 'build_barracks';
  node: number;
}
/**
 * The own city ``node`` raises its warehouse by one level (DEC-26, item 3).
 */
export interface UpgradeWarehouseCmd {
  type: 'upgrade_warehouse';
  node: number;
}
/**
 * Put one unit into the recruit queue of the own city ``node`` (DEC-25).
 */
export interface RecruitCmd {
  type: 'recruit';
  node: number;
}
/**
 * Take the last unit off the recruit queue of the own city ``node`` (DEC-25, item 11).
 */
export interface CancelRecruitCmd {
  type: 'cancel_recruit';
  node: number;
}
export interface CancelOrderCmd {
  type: 'cancel_order';
  group: string;
}
/**
 * Put the front marker ``marker`` (``0..supply.front_markers - 1`` of ``ruleset_public``,
 * checked by the simulation) on the own city ``node``; ``node = null`` takes it off the map
 * (DEC-28, item 2). Free (``cost.front``).
 */
export interface SetFrontCmd {
  type: 'set_front';
  marker: number;
  node: number | null;
}
/**
 * The own rear minimum ``n``, ``0..supply.rear_min_max`` of ``ruleset_public`` (DEC-28,
 * item 3); the range is checked by the simulation (``INVALID_ARGUMENT``).
 */
export interface SetRearMinCmd {
  type: 'set_rear_min';
  n: number;
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
/**
 * The own city ``node`` builds a factory (economy v2, DEC-41, item 2): ``factory.cost``
 * charges by the progressive payment (item 7), no CP.
 */
export interface BuildFactoryCmd {
  type: 'build_factory';
  node: number;
}
/**
 * The own city or province ``node`` builds a bunker (economy v2, DEC-41, item 12):
 * ``bunker.cost`` charges by the progressive payment (item 7), no CP.
 */
export interface BuildBunkerCmd {
  type: 'build_bunker';
  node: number;
}
/**
 * Draw a supply line along ``path`` (economy v2, DEC-41, items 3 and 6): own nodes, each
 * next one joined by a road, from the source (an own factory or the target of an own line) to
 * the target (an own node with a warehouse). Free; the path is used as drawn while intact.
 */
export interface DrawLineCmd {
  type: 'draw_line';
  /**
   * @minItems 2
   * @maxItems 128
   */
  path: [number, number, ...number[]];
}
/**
 * Remove the own line ``line`` (``View.lines[].id``; economy v2, DEC-41, item 3). Free.
 */
export interface RemoveLineCmd {
  type: 'remove_line';
  line: number;
}
/**
 * Turn the auto-extension of the own lines on or off (economy v2, DEC-41, owner decision
 * 2026-10-31, #665): with it on, a city the player captures gets a line from the nearest own
 * source by itself. Free; ``NO_CHANGE`` when it is already so (``View.me.auto_lines``).
 */
export interface SetAutoLinesCmd {
  type: 'set_auto_lines';
  on: boolean;
}
/**
 * The own group waiting on a gathering planned order departs now with the bonus gathered so
 * far, free (economy v2, DEC-41, item 10).
 */
export interface ReleasePlanCmd {
  type: 'release_plan';
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
 * Ask for the suggested path of a supply line through ``points`` (economy v2, DEC-41,
 * item 6; owner decision 2026-10-31, #665): the source, the nodes to route through, the target.
 *
 * The answer is ``line_route``. The interface sends it when the player clicks the target or a
 * node to route through; the connection's message rate limit covers it like every other
 * message. The suggestion is only a default: the player confirms it with ``draw_line``.
 */
export interface LineRouteQueryMsg {
  type: 'line_route_query';
  /**
   * @minItems 2
   * @maxItems 128
   */
  points: [number, number, ...number[]];
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
  /**
   * Whether this match is expected to change your rating (DEC-34, #414); a calibration match
   * does, silently. A rated match can still end unrated for its winner (an early resign of the
   * opponent): ``match_end`` has the final answer.
   */
  rated: boolean;
  /**
   * Why not (``rated`` is ``False``), known at the start; ``None`` when ``rated``.
   */
  unrated_reason: UnratedReason | null;
  /**
   * Your calibration progress before this match; ``None`` for a guest, in a match that is not
   * from the queue, and once calibration is over.
   */
  calibration: Calibration | null;
  /**
   * Seconds the matchmaking queue would be locked for you if you forfeited (or were
   * disconnected for good) now, counting your earlier resigns in the rolling window (DEC-34,
   * item 3, #559); ``0``: no lock, also for a match that is not rated. The client only shows it.
   */
  forfeit_ban_s: number;
  /**
   * Whether you may still pause this match (DEC-05): ``False`` in a rated (queue) match and
   * once you have used your pause, also on a reconnect. A pause of the opponent going on now
   * does not change it (``paused`` says that).
   */
  pause_available: boolean;
}
export interface RulesetPublic {
  tick_hz: number;
  match_ticks: number;
  cp: CpPublic;
  cost: CostsPublic;
  combat: CombatPublic;
  capture: CapturePublic;
  build: BuildPublic;
  economy: EconomyPublic;
  orders: OrdersPublic;
  capacity: CapacityPublic;
  recruit: RecruitPublic;
  city_upgrades: CityUpgradesPublic;
  supply: SupplyPublic;
  vision: VisionPublic;
  /**
   * Economy v2 only; ``None`` under v1.
   */
  factory: FactoryPublic | null;
  /**
   * Economy v2 only; ``None`` under v1.
   */
  lines: LinesPublic | null;
  /**
   * Economy v2 only; ``None`` under v1.
   */
  bunker: BunkerPublic | null;
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
   * ``set_front`` (DEC-28, item 2).
   */
  front: number;
  /**
   * ``set_rear_min`` (DEC-28, item 3).
   */
  rear_min: number;
  /**
   * ``transfer`` (DEC-18, item 6).
   */
  transfer: number;
  /**
   * ``build_barracks`` (DEC-26, item 2).
   */
  barracks: number;
  /**
   * ``upgrade_warehouse``, per level (DEC-26, item 3).
   */
  warehouse: number;
}
export interface CombatPublic {
  terrain_defense_mod: TerrainDefensePublic;
  /**
   * Virtual shots of a planned order per edge of its path, at most the charged units of the
   * group when it departs (DEC-29).
   */
  planned_bonus_per_edge: number;
  /**
   * Ticks between the rounds of a fight (DEC-24, item B): the round progress of a fight.
   */
  round_ticks: number;
  shots_per_round: number;
  /**
   * The pause of an edge winner before it goes on (DEC-24, item G4).
   */
  regroup_ticks: number;
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
 * ``capture`` of the ruleset (DEC-38): a capture spends ``charge_cost`` real charges of the
 * capturing groups in the node, with fewer they bounce; 0: a capture is free.
 */
export interface CapturePublic {
  charge_cost: number;
}
/**
 * Road upgrades (``build`` of the ruleset, DEC-28, item 7): the price is ``cost.build`` per
 * level, what a level gives is ``upgrade_gain`` of the own edges in the view.
 */
export interface BuildPublic {
  ticks_per_level: number;
}
/**
 * The charge production the stance menu shows (``economy`` of the ruleset, DEC-02).
 */
export interface EconomyPublic {
  /**
   * ``v1``: stances, front markers, donors (DEC-02, DEC-28); ``v2``: factories and drawn supply
   * lines (DEC-41): the commands of the other model are rejected with ``FEATURE_DISABLED``.
   */
  model: EconomyModel;
  stance_to_charges_pct: StancePctPublic;
  /**
   * Charges per whole CP put into charges.
   */
  charges_per_cp: number;
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
 * Delays of planned orders, the growth of Defense and the stance cooldown (``orders``).
 */
export interface OrdersPublic {
  planned_delay_ticks: number;
  /**
   * Defense gains one virtual shot per this many ticks in the mode, at most the charged units
   * of the group when a fight begins (DEC-30).
   */
  defense_ticks_per_bonus: number;
  stance_cooldown_ticks: number;
  /**
   * Economy v2 (DEC-41, item 10): a gathering planned order takes one charge and gains one
   * bonus per this many ticks; 0 under v1.
   */
  plan_ticks_per_bonus: number;
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
 * The recruit queue of a city (``recruit`` of the ruleset, DEC-25).
 */
export interface RecruitPublic {
  /**
   * Ticks of production per unit: the full progress of the current unit.
   */
  unit_ticks: number;
  /**
   * Units in the queue of one city at most, the one in production included.
   */
  queue_max: number;
  /**
   * Share of ``cost.recruit`` a cancel returns for the unit in production; a unit not started
   * yet returns all of it.
   */
  refund_started_pct: number;
}
/**
 * City development (DEC-26): ``city_upgrades`` and ``warehouse`` of the ruleset.
 */
export interface CityUpgradesPublic {
  /**
   * Off: every city recruits, the warehouse holds the node capacity, no barracks and no
   * warehouse levels (the commands are rejected with ``FEATURE_DISABLED``).
   */
  enabled: boolean;
  barracks_ticks: number;
  warehouse_ticks: number;
  warehouse_max_level: number;
  warehouse_gain_per_level: number;
  /**
   * Economy v2 (DEC-41, item 7): the barracks costs this many charges; 0 under v1.
   */
  barracks_charges: number;
  /**
   * Economy v2: every warehouse level costs this many charges; 0 under v1.
   */
  warehouse_charges: number;
  /**
   * Economy v2 (DEC-41, item 13): the warehouse of every province holds this many charges; 0
   * under v1 (a province has no warehouse).
   */
  warehouse_province: number;
}
/**
 * The supply settings of a player (DEC-28): the range of the rear minimum slider.
 */
export interface SupplyPublic {
  /**
   * ``set_rear_min`` accepts ``0..rear_min_max``.
   */
  rear_min_max: number;
  /**
   * The rear minimum every player starts with.
   */
  rear_min_default: number;
  /**
   * Front markers of a player: ``set_front`` accepts ``marker`` ``0..front_markers - 1``.
   */
  front_markers: number;
}
/**
 * The vision table by terrain (``vision.by_terrain``, DEC-21, item 2): ``by_terrain.<source>.
 * <target>`` is ``exact``, ``range`` or ``presence``. The client only displays it (the legend of
 * the terrain map mode); the level of a place in the snapshot is decided by the server.
 */
export interface VisionPublic {
  by_terrain: VisionTablePublic;
}
/**
 * One row per terrain of the source.
 */
export interface VisionTablePublic {
  plains: SightRowPublic;
  forest: SightRowPublic;
  mountains: SightRowPublic;
}
/**
 * What a source on one terrain shows of a neighbouring node, by the terrain of that node.
 */
export interface SightRowPublic {
  plains: Sight;
  forest: Sight;
  mountains: Sight;
}
/**
 * Factories (``factory`` of the ruleset, DEC-41, item 2; economy v2 only).
 */
export interface FactoryPublic {
  /**
   * The own capital makes one charge per this many ticks.
   */
  capital_period_ticks: number;
  /**
   * Every other factory makes one charge per this many ticks.
   */
  built_period_ticks: number;
  /**
   * Charges ``build_factory`` pays (progressive payment, item 7).
   */
  cost: number;
  /**
   * Ticks from the full payment to the factory.
   */
  build_ticks: number;
  /**
   * Factories of a player at most, the capital and the builds under way included.
   */
  max: number;
}
/**
 * Supply lines (``lines`` of the ruleset, DEC-41, item 3; economy v2 only).
 */
export interface LinesPublic {
  /**
   * Lines that start at one node at most (L4).
   */
  max_out: number;
}
/**
 * The bunker (``bunker`` of the ruleset, DEC-41, item 12; economy v2 only).
 */
export interface BunkerPublic {
  /**
   * Charges ``build_bunker`` pays (progressive payment, item 7).
   */
  cost: number;
  /**
   * Ticks from the full payment to the bunker.
   */
  build_ticks: number;
  /**
   * Virtual shots of the node's defender in a fight there, if it has a charged unit.
   */
  shots: number;
}
/**
 * Calibration progress of an account: the first matches of a rated account do not show its
 * rating (DEC-34, #414).
 */
export interface Calibration {
  /**
   * Calibration matches played, at most ``total``.
   */
  played: number;
  /**
   * Calibration matches needed (a server setting, 5 by default).
   */
  total: number;
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
  /**
   * Fights going on (DEC-24): own groups fight in each.
   */
  fights: FightView[];
  /**
   * Economy v2: the own supply lines by id (DEC-41, item 3); empty under v1.
   */
  lines: LineView[];
}
/**
 * Own counters; the enemy's CP and stance are never in a view (AGENTS.md, section 4.4).
 */
export interface SelfView {
  cp: number;
  stance: Stance;
  /**
   * The own cities of the front markers (DEC-28, item 2; ``supply.front_markers`` of
   * ``ruleset_public``), ``null``: not placed. The enemy's markers are never in a view.
   */
  fronts: (number | null)[];
  /**
   * The own rear minimum (DEC-28, item 3); the enemy's is never in a view.
   */
  rear_min: number;
  /**
   * Economy v2: the own lines extend to captured cities by themselves (``set_auto_lines``,
   * #665); ``null`` under v1. The enemy's toggle is never in a view.
   */
  auto_lines: boolean | null;
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
   * Charges in the warehouse; only for own nodes (own data, at any ``detail``) and foreign
   * nodes where an own group stands (DEC-21, item 3; DEC-35, detail 2), never for a neighbour seen
   * by the terrain table.
   */
  warehouse: number | null;
  /**
   * Current sighting unless ``detail`` is ``fog``; for ``fog`` the last one, or ``None``.
   */
  seen: Seen | null;
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
   * Own cut-off city only: ticks until its garrison next starves (DEC-19, item 8). ``None``
   * for every other node.
   */
  starve_in: number | null;
  /**
   * Own city only: units in its recruit queue, the one in production included (DEC-25, item
   * 12). ``None`` for provinces, the enemy's and neutral nodes: the enemy's production is hidden.
   */
  recruit_queue: number | null;
  /**
   * Own city only: ticks of production of the current unit, up to ``recruit.unit_ticks``.
   */
  recruit_progress: number | null;
  /**
   * Own city only: the current unit is ready and waits for a place (DEC-25, item 7).
   */
  recruit_waiting: boolean | null;
  /**
   * Own city: it may recruit (DEC-26: with ``city_upgrades`` the capital and the cities with
   * the barracks, without it every city). A city of the enemy joined by an edge of the map to any
   * own node, at any ``detail`` (DEC-31): its barracks are built (``false`` while there are none
   * or they are being built; no memory). ``None`` for provinces, neutral nodes and the other
   * cities of the enemy (DEC-26, item 10).
   */
  has_barracks: boolean | null;
  /**
   * Own city only: warehouse upgrades (DEC-26, item 2; always 0 without ``city_upgrades``).
   */
  warehouse_level: number | null;
  /**
   * Own city only: charges its warehouse holds (DEC-26, item 2; the node capacity without
   * ``city_upgrades``).
   */
  warehouse_cap: number | null;
  /**
   * Own city only: its current build of any kind; ``None`` without one.
   */
  building: NodeBuilding | null;
  /**
   * Economy v2 (DEC-41, item 2): an own city is an own factory; a city of the enemy joined by
   * an edge of the map to any own node (the DEC-31 rule, no memory): it is a built factory of the
   * enemy. ``None`` under v1, for provinces, neutral nodes and the other cities of the enemy.
   */
  factory: boolean | null;
  /**
   * Own factory only: ticks per charge it makes into its warehouse (the own capital
   * ``factory.capital_period_ticks``, any other ``factory.built_period_ticks``).
   */
  factory_period: number | null;
  /**
   * Own city only: the factory being built there (economy v2).
   */
  factory_build: SiteBuild | null;
  /**
   * Economy v2 (DEC-41, item 12, the bunker; code name ``fort``): an own node, a city or a
   * province, has a bunker; a node of the enemy joined by an edge to any own node (the DEC-31
   * rule): it has a built bunker. ``None`` under v1, for neutral nodes and the other nodes of the
   * enemy.
   */
  fort: boolean | null;
  /**
   * Own node only: the bunker being built there (economy v2).
   */
  fort_build: SiteBuild | null;
}
/**
 * What the player sees, or last saw, of one node or half of an edge
 * (``gow_sim.state.Sighting``).
 *
 * ``enemy_modes``: distinct modes of the enemy groups there; empty means no enemy groups.
 * ``enemy_units`` and ``enemy_charged`` are totals, present only when ``level`` is ``exact``;
 * ``enemy_range``: the range of the total units, only when ``level`` is ``range`` and enemies
 * are there. ``level`` is never ``fog``: a place in fog is not seen, it keeps an older ``Seen``.
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
  enemy_range: UnitsRange | null;
}
/**
 * A range of units (DEC-21, item 4; ``vision.range_starts``): ``low..high``, ``high``
 * ``null`` for the last, open range («21+»).
 */
export interface UnitsRange {
  low: number;
  high: number | null;
}
/**
 * The current build of an own city, of any kind (DEC-26, item 10).
 */
export interface NodeBuilding {
  /**
   * ``barracks`` or ``warehouse`` (roads are built on edges, ``EdgeView.build``).
   */
  kind: BuildKind;
  /**
   * The tick it ends, if nothing interrupts it; ``None`` while ``owed`` is above 0 (economy
   * v2, DEC-41, item 7: the build time starts in the tick of the full payment).
   */
  done_tick: number | null;
  /**
   * Economy v2: the charges the build still takes from the city's warehouse and the own
   * groups standing there (the progressive payment of DEC-41, item 7); always 0 under v1.
   */
  owed: number;
}
/**
 * A factory (DEC-41, item 2) or a bunker (item 12) being built in an own node.
 */
export interface SiteBuild {
  /**
   * The tick it is done, if nothing interrupts it; ``None`` while ``owed`` is above 0.
   */
  done_tick: number | null;
  /**
   * The charges still to pay (the progressive payment of DEC-41, item 7).
   */
  owed: number;
}
export interface EdgeView {
  id: number;
  /**
   * Road level the player knows (DEC-17, DEC-22): the current one unless ``detail`` is
   * ``fog``, and always on an own internal edge (DEC-35, detail 5); otherwise in fog the last seen
   * level, or 1 if never seen. Never above the true level.
   */
  width: number;
  /**
   * The road level visibility (DEC-17): ``presence`` while an end is a source of vision (DEC-35;
   * the edge of an own group on it is one), else ``fog``. What is seen of enemies is in
   * ``halves`` and ``enemy_groups``.
   */
  detail: Detail;
  /**
   * Only for own internal edges that can still be upgraded.
   */
  upgrade_gain: UpgradeGain | null;
  /**
   * The half of the end ``a``, then the half of the end ``b`` (DEC-21, item 5).
   *
   * @minItems 2
   * @maxItems 2
   */
  halves: [HalfView, HalfView];
  /**
   * The road level being built here (DEC-28, item 7): an own build always, an enemy one only
   * while the edge is not in fog (DEC-17, item 5).
   */
  build: EdgeBuild | null;
  /**
   * Enemy figures on the halves not in fog (DEC-33).
   */
  enemy_groups: EnemyGroup[];
}
/**
 * What the next road level would give (DEC-28, item 7).
 */
export interface UpgradeGain {
  /**
   * Packet speed gain in percentage points.
   */
  speed_pct: number;
  /**
   * Unit speed gain in percentage points (``road.speed_pct``).
   */
  unit_speed_pct: number;
  /**
   * Gain of charges per dispatch period (``supply.amount_by_level``).
   */
  amount: number;
}
/**
 * A half of an edge, from its node to the border point (DEC-21, item 5).
 */
export interface HalfView {
  /**
   * The level of the node the half belongs to by the sources and the terrain table (a source's
   * half is ``exact``); ``fog`` for an own node without a source (DEC-35, detail 4).
   */
  detail: Detail;
  /**
   * The enemy groups in the half now (those in a fight too) unless ``detail`` is ``fog``; for
   * ``fog`` the last sighting (no positions, DEC-33, detail 8), or ``None``.
   */
  seen: Seen | null;
}
/**
 * A road level being built on the edge (DEC-28, item 7).
 */
export interface EdgeBuild {
  /**
   * The tick the level grows; only for an own build.
   */
  done_tick: number | null;
}
/**
 * An enemy group on a half of an edge not in fog (DEC-33): a figure. A group in a fight is
 * not one: the fight shows it.
 */
export interface EnemyGroup {
  /**
   * Opaque, new each time the group comes out of the fog (DEC-33, detail 5).
   */
  id: string;
  /**
   * Position in thousandths of the edge from its end ``a`` (detail 1).
   */
  pos: number;
  /**
   * Goes to the end ``b``, else to ``a``: the nearest node, never the target (detail 2).
   */
  toward_b: boolean;
  /**
   * The level of its half: ``exact``, ``range`` or ``presence``.
   */
  detail: Detail;
  mode: Mode;
  /**
   * Only on ``exact``.
   */
  units: number | null;
  /**
   * Only on ``exact``.
   */
  charged: number | null;
  /**
   * Only on ``range``: the range of its units.
   */
  units_range: UnitsRange | null;
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
  /**
   * In Defense (DEC-30): the bonus the group would bring into a fight beginning now, what it
   * has gathered at most ``defense_cap``; ``None`` in another mode. Enemy groups never have it.
   */
  defense_bonus: number | null;
  /**
   * In Defense: the cap of its bonus, the charged units of the group (DEC-30, item 2).
   */
  defense_cap: number | null;
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
  /**
   * A planned order: the bonus it brings into its first fight (DEC-29: per edge of the path,
   * at most the charged units of the group). Before the departure a forecast by the charged units
   * now; the cap is taken in the departure tick. 0 for a normal order and once the bonus entered
   * a fight. Only own orders exist in a view (owner 2026-10-21, mockup #339). Economy v2 (DEC-41,
   * item 10): the bonus gathered so far.
   */
  bonus: number;
  /**
   * Economy v2: the planned order waits in its node and gathers its bonus, one real charge of
   * the node's warehouse per ``orders.plan_ticks_per_bonus`` ticks (``release_plan`` departs at
   * once with what it has).
   */
  gathering: boolean;
  /**
   * While ``gathering``: the requested bonus; the group departs by itself once ``bonus``
   * reaches it, or reaches its charged units. 0 otherwise.
   */
  plan: number;
  /**
   * While ``gathering``: the tick the next charge is due (an empty warehouse or a fight in the
   * node delays it). ``None`` otherwise.
   */
  next_charge_tick: number | null;
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
 * A fight going on (DEC-24, item I1): a node, or an edge with the meeting ``point``.
 *
 * ``point``: twice the meeting position in thousandths from the end ``a`` of the edge
 * (0..2000); the mark sits at ``point / 2000`` of the edge from ``a`` (item C3). ``groups``:
 * the own groups in the fight. ``enemy_units`` and ``enemy_charged``: the enemy's totals in this
 * fight, exact. A round happens at ``next_round_tick``, every ``combat.round_ticks``.
 * ``shots`` and ``losses``: totals of the fight so far by player; ``last_round``: the latest
 * round of both players, ``None`` before the first one. ``virtual_left``: the virtual shots
 * (bonuses, mountains) still left by player, public to both while the fight goes on (DEC-32,
 * item 3); it grows when a reinforcement with a bonus joins and drops after each round.
 * ``mute``: by player, the charged units in the fight that do not shoot in a round because of
 * the terrain (plains: one of the defender, DEC-24, item F2), at most the side's charged units.
 */
export interface FightView {
  id: string;
  node: number | null;
  edge: number | null;
  point: number | null;
  /**
   * The player attacking the node; ``None`` on an edge and in a neutral node.
   */
  attacker: PlayerId | null;
  start_tick: number;
  next_round_tick: number;
  groups: string[];
  enemy_units: number;
  enemy_charged: number;
  /**
   * @minItems 2
   * @maxItems 2
   */
  shots: [number, number];
  /**
   * @minItems 2
   * @maxItems 2
   */
  losses: [number, number];
  /**
   * @minItems 2
   * @maxItems 2
   */
  virtual_left: [number, number];
  /**
   * @minItems 2
   * @maxItems 2
   */
  mute: [number, number];
  last_round: FightRoundView | null;
}
/**
 * The latest round of a fight (DEC-24, item I1 as revised with DEC-29), both players, index
 * = player id: ``shots`` made (cancelling and killing ones), ``virtual`` among them (bonuses,
 * terrain), ``spent`` charges that left the player's units, ``losses`` in units. The same
 * numbers as the ``fight_round`` event of that ``tick``.
 */
export interface FightRoundView {
  tick: number;
  /**
   * @minItems 2
   * @maxItems 2
   */
  shots: [number, number];
  /**
   * @minItems 2
   * @maxItems 2
   */
  virtual: [number, number];
  /**
   * @minItems 2
   * @maxItems 2
   */
  spent: [number, number];
  /**
   * @minItems 2
   * @maxItems 2
   */
  losses: [number, number];
}
/**
 * An own supply line (economy v2, DEC-41, items 3 and 6). The enemy's are never sent.
 */
export interface LineView {
  /**
   * The per-player id of the line (``remove_line``, the ``line`` of ``line_cut`` and
   * ``line_rerouted``); only its owner ever sees it.
   */
  id: number;
  /**
   * The own nodes from the source to the target: the drawn path while it is intact, the
   * server's reroute after a break (item 3).
   *
   * @minItems 2
   */
  path: [number, number, ...number[]];
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
 * ``NOT_ENOUGH_CP``, ``QUEUE_FULL``, ... from SIM-04 #20).
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
   * Rating change of the receiving player; ``None``: the match is not rated (DEC-06), or the
   * player is still in calibration and the rating is hidden (``calibration``). Present when the
   * match completes the calibration: that is the first rating the player sees (DEC-34).
   */
  rating: RatingChange | null;
  /**
   * Whether this match changed your rating (a calibration match did, silently); the final
   * answer, after the early-resign rule (DEC-34, #414).
   */
  rated: boolean;
  /**
   * Why not (``rated`` is ``False``); ``None`` when ``rated``.
   */
  unrated_reason: UnratedReason | null;
  /**
   * Your own totals for the result screen; ``None`` when the server did not count them.
   */
  stats: MatchEndStats | null;
  /**
   * Your calibration progress after this match; ``None`` for a guest, in a match that is not
   * from the queue, and once calibration was over before this match.
   */
  calibration: Calibration | null;
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
 * Totals of the receiving player only (#607); the opponent's are never sent (fog).
 *
 * ``units_lost``: own units destroyed in fights (killed by shots) and by over-capacity attrition;
 * ``charges_delivered``: charges that reached a city as supply packets or transfers. Both count
 * the whole match from the event log, so a reconnect does not change them.
 */
export interface MatchEndStats {
  units_lost: number;
  charges_delivered: number;
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
  /**
   * The nodes from the group's node to ``node``: the path ``ticks`` refers to, the same one
   * the ``ack`` of a ``move`` there carries (#448). All but the last are the group's node or own
   * nodes.
   *
   * @minItems 2
   */
  path: [number, number, ...number[]];
}
/**
 * Answer to ``line_route_query``, computed by the server on the state after tick ``tick``
 * (#665): the fastest path over own nodes through ``points`` in order, each leg avoiding the
 * nodes of the legs before it (the sum of the packet times, ties by ``node_key``). ``path`` is
 * empty when a point is not own, repeated or out of range, or a leg has no way. Only own nodes
 * are on a path. The rules of ``draw_line`` (source, limit, cycle) are not checked here.
 */
export interface LineRouteMsg {
  type: 'line_route';
  /**
   * The points of the query, as asked: the client matches the answer by them.
   */
  points: number[];
  tick: number;
  /**
   * ``(points[0], ..., points[-1])`` or ``()``.
   */
  path: number[];
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
  /**
   * Name of the node shown by the interface (DEC-23, item 4): not translated.
   */
  name: string;
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
   * Highest road level, at most 3 (DEC-23, item 6); every road starts at level 1 (DEC-22).
   */
  max_level: number;
  travel_ticks: number;
  /**
   * Border point in thousandths from ``a`` (DEC-23, item 5): where the halves of the edge meet
   * (vision DEC-21, territory on the map).
   */
  border_permille: number;
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

export const PROTOCOL_VERSION = 34;
export const CLOSE_PROTOCOL_VERSION = 4001;
export const CLOSE_REPLACED = 4009;
export const CLOSE_NO_MATCH = 4004;
export const CLOSE_POLICY = 1008;
