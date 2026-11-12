// Generated from packages/protocol/protocol.schema.json (gow_protocol), do not edit. Regenerate: uv run python scripts/export_schema.py && pnpm -C apps/client gen:protocol

/**
 * Wire format of Fines Imperii, generated from gow_protocol.
 */
export type Protocol = ClientMsg | ServerMsg | MapFile;
export type ClientMsg =
  HelloMsg | CommandMsg | PingMsg | ResyncMsg | PauseMsg | ResumeMsg | ReachQueryMsg;
export type Command =
  | MoveCmd
  | SplitCmd
  | MergeCmd
  | SetStanceCmd
  | BuildBarracksCmd
  | RecruitCmd
  | CancelRecruitCmd
  | CancelOrderCmd
  | BuildFactoryCmd
  | FortifyRoadCmd
  | SetLeafShiftCmd
  | ReleasePlanCmd
  | GroupMoveCmd
  | SetRallyPointCmd
  | ForfeitCmd;
/**
 * The stance of a player (DEC-44): the rate of the CP income and of the own capital (with
 * ``stances.factories_follow``, DEC-47, of every factory).
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
  | ReachMsg;
export type PlayerId = 0 | 1;
/**
 * ``combat.retreat`` (DEC-40, #626): ``round`` is the retreat of DEC-24, item E (a group
 * leaves a fight after the nearest round); ``none`` is variant N: a group that entered a fight
 * stays in it until the fight ends.
 */
export type Retreat = 'round' | 'none';
/**
 * What a source of vision shows of a neighbouring node (DEC-21, item 2): the detail levels
 * ``exact``, ``range`` and ``presence`` of ``gow_sim.state.Detail`` (never fog).
 */
export type Sight = 'exact' | 'range' | 'presence';
/**
 * The colour a player chooses: the set Engraved six (DEC-49, item 1). The values and the
 * allowed pairs are in ``gow_server.colours``; the client keeps the same values in its palette.
 */
export type PlayerColour = 'lapis' | 'minium' | 'glacier' | 'shell' | 'violet' | 'madder';
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
 * Group mode (mechanics.md, section 3). "Defense" was removed with economy v1 (DEC-41,
 * item 5; #894): every group attacks.
 */
export type Mode = 'attack';
/**
 * What a city builds in its build slot (DEC-26, item 9): the barracks.
 */
export type BuildKind = 'barracks';
/**
 * Why an own node sends nothing at the next dispatch of the supply flow (DEC-43, item E).
 */
export type FlowIdle = 'leaf' | 'ahead' | 'empty' | 'full';
export type Location = AtNodeLoc | OnEdgeLoc;
/**
 * Publicly visible intent types (DEC-04, DEC-08): the planned order.
 */
export type IntentKind = 'planned_move';
/**
 * What a ``group_move`` is (DEC-48, item B2): decided by the owner of its target when it is
 * applied.
 */
export type OrderKind = 'rally' | 'attack';
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
   * Planned order (DEC-08): visible to everyone as an intent; the group waits and gathers
   * ``bonus`` (DEC-41, item 10).
   */
  planned: boolean;
  /**
   * A planned order only: the requested attack bonus, at least 1. An ordinary order gives 0;
   * otherwise ``INVALID_ARGUMENT``.
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
export interface SetStanceCmd {
  type: 'set_stance';
  stance: Stance;
}
/**
 * The own city ``node`` builds the barracks (DEC-26): then it recruits.
 */
export interface BuildBarracksCmd {
  type: 'build_barracks';
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
 * The own city ``node`` builds a factory (DEC-41, item 2): ``factory.cost``
 * charges by the progressive payment (item 7), no CP.
 */
export interface BuildFactoryCmd {
  type: 'build_factory';
  node: number;
}
/**
 * The own city or province ``node`` fortifies the road ``edge`` leaving it (DEC-43, item D):
 * ``ruleset_public.fort.cost`` CP. ``NOT_ADJACENT`` when the road does not leave the node,
 * ``ALREADY_BUILT`` for a second one of the node on that road.
 */
export interface FortifyRoadCmd {
  type: 'fortify_road';
  node: number;
  edge: number;
}
/**
 * The own leaf shift (DEC-43, item B2): the level of the supply flow moves ``shift`` roads
 * back from the front, ``0..View.me.leaf_shift_max``; the range is checked by the simulation
 * (``INVALID_ARGUMENT``), the same value gives ``NO_CHANGE``. Free, not public. Without
 * ``ruleset_public.supply_leaf_shift`` (DEC-50) always ``INVALID_ARGUMENT``: the shift stays 0.
 */
export interface SetLeafShiftCmd {
  type: 'set_leaf_shift';
  shift: number;
}
/**
 * The own group waiting on a gathering planned order departs now with the bonus gathered so
 * far, free (DEC-41, item 10).
 */
export interface ReleasePlanCmd {
  type: 'release_plan';
  group: string;
}
/**
 * DEC-48: one order for several own groups to ``dest``. An own ``dest`` is a rally (every
 * group departs at once and merges there, ``ruleset_public.group_order.rally_pct`` of a move per
 * group, rounded up to a whole CP), any other an attack whose groups arrive in one tick. Each
 * group is checked like a ``move`` of it (partial acceptance: ``ack.members``). The order of
 * ``groups`` decides the split of a planned bonus (the first ones take the remainder).
 * ``INVALID_ARGUMENT`` without ``ruleset_public.group_order``, for more groups than its
 * ``max_groups`` and for a planned rally.
 */
export interface GroupMoveCmd {
  type: 'group_move';
  /**
   * @minItems 1
   * @maxItems 16
   */
  groups: [string, ...string[]];
  dest: number;
  /**
   * A planned attack: each group gathers its part of ``bonus`` in its node (DEC-48, item F).
   */
  planned: boolean;
  /**
   * A planned order only: the requested total bonus, at least 1; 0 otherwise.
   */
  bonus: number;
}
/**
 * DEC-48, item H: the new units of the own city ``node`` walk to the own node ``target``
 * (each pays ``ruleset_public.recruit.rally_cost`` when it leaves); ``null`` clears the point.
 * Setting and clearing are free. ``INVALID_ARGUMENT`` without
 * ``ruleset_public.recruit.rally_point``.
 */
export interface SetRallyPointCmd {
  type: 'set_rally_point';
  node: number;
  target: number | null;
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
  /**
   * Colours of the two players by player id, resolved once at the start of the match by the
   * clash rule (DEC-49, item 2): the same in every ``welcome`` of the match and in its replay.
   * Public, like the nicks: the opponent's colour is not a fog leak.
   *
   * @minItems 2
   * @maxItems 2
   */
  colours: [PlayerColour, PlayerColour];
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
  orders: OrdersPublic;
  capacity: CapacityPublic;
  recruit: RecruitPublic;
  city_upgrades: CityUpgradesPublic;
  vision: VisionPublic;
  factory: FactoryPublic;
  fort: FortPublic;
  /**
   * ``supply.dispatch_ticks``: the supply dispatch runs on the ticks ``t > 0`` divisible by it
   * (DEC-43, item A6), so the countdown to ``View.me.next_dispatch_tick`` is exact from the first
   * snapshot (#705).
   */
  supply_dispatch_ticks: number;
  /**
   * ``supply.leaf_shift``: the player may move the level of the flow back with
   * ``set_leaf_shift`` (DEC-43, item B). ``False`` (DEC-50): no lever, the shift stays 0 and the
   * command gives ``INVALID_ARGUMENT``; the client hides the lever.
   */
  supply_leaf_shift: boolean;
  stances: StancesPublic;
  /**
   * DEC-48: the group order, ``None`` when the ruleset has none.
   */
  group_order: GroupOrderPublic | null;
  victory: VictoryPublic;
}
/**
 * CP: ``per_period`` hundredths per quantum, up to ``cap``; the period of the quantum is
 * ``stances.cp_period_ticks`` of the own stance.
 */
export interface CpPublic {
  cap: number;
  per_period: number;
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
  recruit: number;
  stance: number;
  /**
   * ``build_barracks`` (DEC-26, item 2); its charges are ``city_upgrades.barracks_charges``.
   */
  barracks: number;
}
export interface CombatPublic {
  terrain_defense_mod: TerrainDefensePublic;
  /**
   * Ticks between the rounds of a fight (DEC-24, item B): the round progress of a fight.
   */
  round_ticks: number;
  shots_per_round: number;
  /**
   * The pause of an edge winner before it goes on (DEC-24, item G4).
   */
  regroup_ticks: number;
  /**
   * ``round``: a group may leave a fight after the nearest round (DEC-24, item E); ``none``:
   * no retreat (DEC-40, variant N), the client hides the retreat hints and the cancel in a fight.
   */
  retreat: Retreat;
}
/**
 * ``terrain.defense_mod``: charges added to the node defender's pool; a negative value burns
 * that many of its charges at the start of the first round (DEC-45).
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
 * Planned orders (``orders`` of the ruleset).
 */
export interface OrdersPublic {
  /**
   * A gathering planned order takes one charge and gains one bonus per this many ticks
   * (DEC-41, item 10).
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
  /**
   * DEC-48, item H: a city may send its new units to a rally point (``set_rally_point``).
   */
  rally_point: boolean;
  /**
   * Hundredths of CP a recruit pays when it leaves for the rally point (with fewer CP it stays
   * in its city, event ``rally_walk_no_cp``); 0 without ``rally_point``.
   */
  rally_cost: number;
}
/**
 * The barracks (DEC-26; ``city_upgrades`` of the ruleset) and the warehouse of a province.
 */
export interface CityUpgradesPublic {
  /**
   * Ticks from the full payment to the barracks.
   */
  barracks_ticks: number;
  /**
   * The barracks costs this many charges (DEC-41, item 7).
   */
  barracks_charges: number;
  /**
   * The warehouse of every province holds this many charges (DEC-41, item 13).
   */
  warehouse_province: number;
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
 * Factories (``factory`` of the ruleset, DEC-41, item 2). The own capital makes one charge
 * per ``stances.capital_period_ticks`` of the own stance.
 */
export interface FactoryPublic {
  /**
   * Every other factory makes one charge per this many ticks; ``None`` under
   * ``stances.factories_follow`` (DEC-47): then it follows the stance like the capital.
   */
  built_period_ticks: number | null;
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
 * Road fortifications (``fort`` of the ruleset, DEC-43, item D).
 */
export interface FortPublic {
  /**
   * CP in hundredths ``fortify_road`` costs, flat.
   */
  cost: number;
  /**
   * Ticks from the command to a working fortification.
   */
  build_ticks: number;
  /**
   * The toll: ``toll_charges`` per started ``toll_units`` units of an enemy group crossing the
   * line towards the node, never more than its charged units.
   */
  toll_units: number;
  toll_charges: number;
}
/**
 * Stances with local progress (``stances`` of the ruleset, DEC-44).
 */
export interface StancesPublic {
  /**
   * One CP quantum (``cp.per_period``) per this many ticks; ``View.me.cp_ticks`` counts them.
   */
  cp_period_ticks: StancePeriodsPublic;
  /**
   * One charge of the own capital per this many ticks; ``View.me.capital_ticks`` counts them.
   */
  capital_period_ticks: StancePeriodsPublic;
  /**
   * DEC-47 (#888): every other own factory (built or captured) makes one charge per
   * ``capital_period_ticks`` of the own stance as well, on its own counter, so a stance's charge
   * rate is this period times the own factories; ``False``: they keep ``factory.built_period_ticks``
   * whatever the stance.
   */
  factories_follow: boolean;
}
/**
 * Ticks per quantum under each stance (DEC-44).
 */
export interface StancePeriodsPublic {
  economy: number;
  balance: number;
  war: number;
}
/**
 * The group order (DEC-48, ``[group_order]`` of the ruleset): ``group_move`` works and
 * ``release_plan`` is disabled.
 */
export interface GroupOrderPublic {
  /**
   * Groups in one ``group_move`` at most.
   */
  max_groups: number;
  /**
   * A rally of ``n`` groups costs ``ceil(n * cost.move * rally_pct / 100 / 100)`` whole CP;
   * an attack ``cost.move`` per group (``cost.planned_move`` planned).
   */
  rally_pct: number;
}
/**
 * The VP credit (``victory`` of the ruleset, DEC-03, mechanics.md section 11).
 */
export interface VictoryPublic {
  /**
   * ``victory.vp_period_ticks``: VP are credited on every tick ``t > 0`` with
   * ``t % vp_period_ticks == 0`` up to ``match_ticks`` (the first credit on the tick
   * ``vp_period_ticks``; every kept ruleset's ``match_ticks`` is a multiple of it, so the last
   * credit falls on the last tick). A snapshot of tick ``t`` already holds the credit of ``t``
   * in ``View.vp``, so the next credit is ``vp_period_ticks - t % vp_period_ticks`` ticks away
   * (``vp_period_ticks`` right after a credit, never 0), with ``View.vp_gain`` its amounts.
   */
  vp_period_ticks: number;
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
   * VP each player gets at the next credit if the ownership stays as it is now, by player id
   * (the map ``vp`` of its cities, a capital times ``victory.capital_multiplier``; mechanics.md,
   * section 11, #934); public like ``vp`` (DEC-04). The next credit is on the tick
   * ``tick - tick % P + P`` with ``P = ruleset_public.victory.vp_period_ticks``; the
   * ``vp_awarded`` events of that tick carry what was really credited.
   *
   * @minItems 2
   * @maxItems 2
   */
  vp_gain: [number, number];
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
}
/**
 * Own counters; the enemy's CP and stance are never in a view (AGENTS.md, section 4.4).
 */
export interface SelfView {
  cp: number;
  stance: Stance;
  /**
   * Supply flow (DEC-43, item B): the own leaf shift in force (``set_leaf_shift``); always set
   * (nullable on the wire until the client cleanup of #894); always 0 without
   * ``ruleset_public.supply_leaf_shift`` (DEC-50). The enemy's shift is never in a view.
   */
  leaf_shift: number | null;
  /**
   * Supply flow: the largest shift now (the roads from the own capital to the front).
   */
  leaf_shift_max: number | null;
  /**
   * Supply flow: the tick of the next dispatch.
   */
  next_dispatch_tick: number | null;
  /**
   * Stances (DEC-44): the ticks since the own last CP quantum, of
   * ``ruleset_public.stances.cp_period_ticks``; always set. The enemy's counters are never in a
   * view.
   */
  cp_ticks: number | null;
  /**
   * Stances: the ticks since the last quantum of the own capital, of
   * ``ruleset_public.stances.capital_period_ticks``.
   */
  capital_ticks: number | null;
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
   * Own node of a starving pocket only: ticks until its garrison next starves (DEC-19, item 8;
   * DEC-43, item H4). ``None`` for every other node.
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
   * Own city: it may recruit (DEC-26: the capital and the cities with the barracks). A city of
   * the enemy joined by an edge of the map to any own node, at any ``detail`` (DEC-31): its barracks
   * are built (``false`` while there are none or they are being built; no memory). ``None`` for
   * provinces, neutral nodes and the other cities of the enemy (DEC-26, item 10).
   */
  has_barracks: boolean | null;
  /**
   * Own city only: charges its warehouse holds (DEC-43, item C).
   */
  warehouse_cap: number | null;
  /**
   * Own city only: its current build; ``None`` without one.
   */
  building: NodeBuilding | null;
  /**
   * DEC-41, item 2: an own city is an own factory; a city of the enemy joined by an edge of the
   * map to any own node (the DEC-31 rule, no memory): it is a built factory of the enemy. ``None``
   * for provinces, neutral nodes and the other cities of the enemy.
   */
  factory: boolean | null;
  /**
   * Own factory only: ticks per charge it makes into its warehouse (the own capital the period
   * of the own stance, ``ruleset_public.stances``; any other ``factory.built_period_ticks``, with
   * ``stances.factories_follow`` (DEC-47) the period of the stance too).
   */
  factory_period: number | null;
  /**
   * Own city only: the factory being built there.
   */
  factory_build: SiteBuild | null;
  /**
   * Supply flow (DEC-43, item E), own node only: the effective field ``d`` of the current
   * tick, the roads to the nearest leaf after the pull of a tired army; ``null`` without a field
   * and for every other node. The level is
   * ``front_dist == View.me.leaf_shift``, ahead of it ``front_dist < leaf_shift``.
   */
  front_dist: number | null;
  /**
   * Supply flow, own node only: its downhill neighbours (roads it gives to, room not
   * considered), in tie-break order; ``null`` like ``front_dist``.
   */
  flow_down: number[] | null;
  /**
   * Supply flow, own node only: the receivers of its next dispatch, one charge each, in the
   * order they get them.
   */
  flow_next: number[] | null;
  /**
   * Supply flow, own node only: why it sends nothing at the next dispatch (``leaf``: on the
   * level or without a field, ``ahead``: ahead of the level, ``empty``, ``full``: no neighbour
   * takes a charge); ``null`` when ``flow_next`` is not empty.
   */
  flow_idle: FlowIdle | null;
  /**
   * Supply flow, own node only: its own component over internal roads does not contain the own
   * capital (a pocket: its factories stop, without a factory it starves).
   */
  flow_pocket: boolean | null;
  /**
   * The terrain effect the defender of the node would get if attacked now (DEC-24, item F2;
   * #791): positive, the bonus shots of mountains; negative, the charges plains burn in the first
   * round (DEC-45). Only for a node with an owner, no fight,
   * a terrain effect and a charged group of the owner standing in it; for a node of the enemy only
   * at ``exact``. ``null`` otherwise: an attacker, a discharged group, a road and a neutral node
   * never carry it. The client draws it as is (AGENTS.md 7.1).
   */
  terrain_mark: number | null;
  /**
   * DEC-48, item I2: own city only, the own node its new units walk to; ``None`` without one
   * and for every other node.
   */
  rally_point: number | null;
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
   * @maxItems 1
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
 * The current build of an own city (DEC-26, item 10).
 */
export interface NodeBuilding {
  /**
   * ``barracks``.
   */
  kind: BuildKind;
  /**
   * The tick it ends, if nothing interrupts it; ``None`` while ``owed`` is above 0 (DEC-41,
   * item 7: the build time starts in the tick of the full payment).
   */
  done_tick: number | null;
  /**
   * The charges the build still takes from the city's warehouse and the own groups standing
   * there (the progressive payment of DEC-41, item 7).
   */
  owed: number;
}
/**
 * A factory being built in an own city (DEC-41, item 2).
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
   * The edge visibility (DEC-17): ``presence`` while an end is a source of vision (DEC-35;
   * the edge of an own group on it is one), else ``fog``. What is seen of enemies is in
   * ``halves`` and ``enemy_groups``.
   */
  detail: Detail;
  /**
   * The half of the end ``a``, then the half of the end ``b`` (DEC-21, item 5).
   *
   * @minItems 2
   * @maxItems 2
   */
  halves: [HalfView, HalfView];
  /**
   * Enemy figures on the halves not in fog (DEC-33).
   */
  enemy_groups: EnemyGroup[];
  /**
   * The road fortifications of its ends the player knows of (DEC-43, item D8), the end ``a``
   * first.
   */
  forts: RoadFort[];
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
 * A road fortification of the end ``node`` of the edge (DEC-43, item D; code name
 * ``road_fort``): own ones always, an enemy one (built or being built) while the half of
 * ``node`` is not in fog for the player (item D8, no memory). Its line is the border point of
 * the edge, inside the cell of ``node``.
 */
export interface RoadFort {
  node: number;
  owner: PlayerId;
  /**
   * It takes its toll.
   */
  built: boolean;
  /**
   * An own build only: the tick it starts to work.
   */
  done_tick: number | null;
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
  /**
   * A planned order: the bonus gathered so far (DEC-41, item 10), at most the charged units of
   * the group; the cap is taken again in the departure tick (DEC-29). 0 for a normal order and
   * once the bonus entered a fight. Only own orders exist in a view (owner 2026-10-21, mockup
   * #339).
   */
  bonus: number;
  /**
   * The planned order waits in its node and gathers its bonus, one real charge of
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
  /**
   * The group leaves its node not before this tick (DEC-48: a member of a synchronized attack
   * waits in its node until then, item C2); a past tick once it left. ``None`` while a planned
   * order gathers and for a ready member of a planned group order until the departures are fixed
   * (item F4).
   */
  depart_tick: number | null;
  /**
   * DEC-48, item I1: shared by the members of one group order; ``None`` for a single order.
   */
  group_order: string | null;
  /**
   * DEC-48, item I1: the common arrival of the group order (a rally: the latest arrival of a
   * member) once known; ``None`` while a planned group order gathers and for a single order.
   */
  arrive_tick: number | null;
}
/**
 * Own charges on the way along a path of roads (mechanics.md, section 7; DEC-18, item 5).
 *
 * ``edge`` is the current road, travelled away from ``from_node`` during
 * ``depart_tick..arrive_tick``; ``path``: the nodes still to reach, the end of ``edge`` first,
 * the destination last; ``dest_tick``: the tick it reaches the destination if nothing stops it.
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
}
/**
 * Public part of a planned order: no group id and no group size.
 */
export interface IntentView {
  id: string;
  owner: PlayerId;
  kind: IntentKind;
  origin: number;
  /**
   * The target of the planned order (always set; nullable on the wire until the client
   * cleanup of #894).
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
 * ``mute``: by player, the charged units in the fight the first round will burn because of the
 * terrain (plains, DEC-45), at most the side's charged units, 0 after it; they do not shoot.
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
 * terrain), ``spent`` charges that left the player's units, ``losses`` in units, ``burned``
 * charges the terrain took before the shots of the round (first round only, not in ``spent``,
 * DEC-45). The same numbers as the ``fight_round`` event of that ``tick``.
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
  /**
   * @minItems 2
   * @maxItems 2
   */
  burned: [number, number];
}
/**
 * Result of the command ``seq``: accepted (``reject_code`` is ``None``) or rejected.
 *
 * ``applied_tick``: the tick at whose start the command was validated and, if accepted, applied.
 * ``path``: for an accepted ``move``, the nodes from the group's node to ``dest`` (the client
 * draws it and never computes it); ``None`` otherwise.
 * ``arrive_tick``: for an accepted ``move``, the tick the group reaches ``dest`` if nothing
 * stops it (the gathering of a planned order included; DEC-22, item 10); for an accepted
 * ``group_move`` the common arrival (a rally: the latest arrival of a member; ``None`` for a
 * planned attack until its departures are fixed, ``OrderView.arrive_tick``); ``None`` otherwise.
 * ``reject_code``: code of the simulation's ``Reject`` (``NOT_FOUND_OR_HIDDEN``,
 * ``NOT_ENOUGH_CP``, ``QUEUE_FULL``, ... from SIM-04 #20). A ``group_move`` without enough CP
 * for its accepted groups is ``NOT_ENOUGH_CP`` as a whole (no group goes, nothing waits for CP;
 * DEC-48, item B5): the client shows it as an alert.
 * ``kind``, ``cost``: an accepted ``group_move`` only (DEC-48, item B6): a rally or an attack
 * and the CP charged, in hundredths.
 * ``members``: a ``group_move`` only, one per group in the order of its ``groups``: accepted or
 * dropped; also on a ``group_move`` rejected because no group was valid (``reject_code`` is then
 * the first group's code). ``None`` for every other command and for a ``group_move`` rejected as
 * a whole for another reason.
 */
export interface AckMsg {
  type: 'ack';
  seq: number;
  applied_tick: number;
  path: [number, ...number[]] | null;
  arrive_tick: number | null;
  reject_code: string | null;
  kind: OrderKind | null;
  cost: number | null;
  members: AckMember[] | null;
}
/**
 * One group of a ``group_move``, in the order of its ``groups`` (DEC-48, item B6): accepted
 * with its path, or dropped with its ``reject_code``. A group too big for every path in an
 * ordinary order is split by the server and its part goes (item B4, #913): ``split_units`` of
 * ``group_units``; it is ``STACK_LIMIT`` only when not even one unit has a path. A planned
 * order splits nothing: such a member is ``STACK_LIMIT`` (owner decision (10), #941).
 */
export interface AckMember {
  /**
   * The nodes from the group's node to ``dest``; ``None`` for a dropped group.
   */
  path: [number, number, ...number[]] | null;
  /**
   * The tick it leaves its node (a member of an attack waits there until then); ``None`` for a
   * planned member (fixed once every part is gathered: ``OrderView.depart_tick``) and a dropped
   * one.
   */
  depart_tick: number | null;
  /**
   * The tick it reaches ``dest`` if nothing stops it; ``None`` like ``depart_tick``.
   */
  arrive_tick: number | null;
  /**
   * A planned member: its part of the requested bonus (item F2); 0 otherwise.
   */
  bonus: number;
  /**
   * Why the group was dropped; ``None`` for an accepted one.
   */
  reject_code: string | null;
  /**
   * The group of an ordinary order was too big for every path (item B4, #913): the units of
   * the part that split off and goes (the largest size with a path, as ``reach.split``); the rest
   * stays as the group, without an order. ``None``: the whole group goes, or it was dropped (a
   * planned member is never split, #941).
   */
  split_units: number | null;
  /**
   * With ``split_units``: the units of the group at the command (the client shows "N of M
   * go"); ``None`` otherwise.
   */
  group_units: number | null;
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
 * Totals of the receiving player only (#824); the opponent's are never sent (fog).
 *
 * Counted over the whole match by ``gow_sim.analysis.ResultTally`` (the exact definitions are
 * in its module docstring and in ``docs/design/ui-style.md`` 13.6). ``units_killed``: enemy
 * units destroyed in the player's fights; ``units_lost``: own units destroyed in fights and by
 * over-capacity attrition; ``cities_captured`` / ``provinces_captured``: nodes the player took;
 * ``attacks`` / ``attacks_won``: ended fights in a node the player did not own / of them those
 * it captured; ``defenses`` / ``defenses_held``: ended fights the enemy started in a node of
 * the player / of them those after which the node is still the player's.
 */
export interface MatchEndStats {
  units_killed: number;
  units_lost: number;
  cities_captured: number;
  provinces_captured: number;
  attacks: number;
  attacks_won: number;
  defenses: number;
  defenses_held: number;
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
   * Nodes a ``move`` is rejected to with ``STACK_LIMIT``: only a smaller group gets there, by
   * node id, each with the size that fits.
   */
  split: ReachSplit[];
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
export interface ReachSplit {
  node: number;
  /**
   * The most units a group from the same node can have to be accepted there now (``0``: no
   * smaller group either): the size of the split the interface offers (#762).
   */
  units: number;
  /**
   * Ticks of the path of the part that fits once it departs; ``None`` exactly when ``units``
   * is ``0`` (#1004).
   */
  ticks: number | null;
  /**
   * The nodes from the group's node to ``node`` for a group of ``units``: the path an
   * ordinary group order sends that part along (DEC-48, item B4) and the ``ack`` of a ``move`` of
   * such a part carries; ``None`` exactly when ``units`` is ``0`` (#1004). All but the last are
   * the group's node or own nodes.
   */
  path: [number, number, ...number[]] | null;
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
  /**
   * ``none``: a generated map (#771), its ``mirror`` table is the identity.
   */
  symmetry: 'rot180' | 'none';
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

export const PROTOCOL_VERSION = 53;
export const CLOSE_PROTOCOL_VERSION = 4001;
export const CLOSE_REPLACED = 4009;
export const CLOSE_NO_MATCH = 4004;
export const CLOSE_POLICY = 1008;
export const MAX_MERGE_GROUPS = 16;
