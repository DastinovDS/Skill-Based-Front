/**
 * HUD data (CLI-08, #64): what the panels show, computed from one snapshot. Pure functions, no
 * Svelte and no PixiJS; `HudState` (hudState.svelte.ts) calls them once per snapshot (10 Hz), never
 * per frame (AGENTS.md 7.2). Everything here is language-free: components turn it into text with
 * `t()`.
 */
import type {
  BuildKind,
  Detail,
  EventMsg,
  GroupView,
  MapFile,
  Mode,
  NodeView,
  PlayerId,
  RulesetPublic,
  Seen,
  SnapshotMsg,
  Stance,
  Terrain,
  UpgradeGain,
} from '../protocol.gen.ts';

/** What the player picked to look at: one own group or one node. */
export type Selection =
  { readonly kind: 'group'; readonly id: string } | { readonly kind: 'node'; readonly id: number };

/** What the pointer rests on for the charge tip: a group (by id), the groups of a city, nothing. */
export type HoverTarget = string | { readonly node: number } | null;

/** Fixed for the whole match: the ruleset from `welcome` and the map. */
export interface HudContext {
  readonly me: PlayerId;
  /** Nicks by player id (`welcome.nicks`). */
  readonly nicks: readonly [string, string];
  readonly rules: RulesetPublic;
  readonly map: MapFile;
}

export interface CpInfo {
  /** Hundredths of CP, as in the protocol. */
  readonly value: number;
  readonly cap: number;
  /** Hundredths of CP per second at the ruleset's regeneration. */
  readonly regenPerSecond: number;
}

export interface GroupInfo {
  readonly id: string;
  readonly units: number;
  readonly charged: number;
  readonly mode: Mode;
  /** The node the group stands in, `null` while it is on an edge. */
  readonly node: number | null;
  /** Capacity of that node. */
  readonly capacity: number | null;
  /** `progress` in thousandths, for a group on an edge. */
  readonly progress: number | null;
  readonly destination: number | null;
  readonly planned: boolean;
  /**
   * An own group in "Defense": the bonus it has gathered and its cap, the server's numbers
   * (DEC-30); `null` in another mode and in a file without them. The opponent's groups are not
   * `GroupInfo`s at all: they show their mode only.
   */
  readonly defense: DefenseInfo | null;
  /**
   * The bonus of the planned order of the group, the server's number (`OrderView.bonus`, DEC-29):
   * a forecast while the group stands in its city, 0 without a planned order.
   */
  readonly plannedBonus: number;
  /**
   * Economy v2 (DEC-41, item 10): the planned order waits in its node and gathers its bonus; the
   * server's numbers. `null` without a gathering plan.
   */
  readonly gathering: GatheringInfo | null;
}

/** A gathering planned order (economy v2): the bonus so far, the one asked for, the next charge. */
export interface GatheringInfo {
  readonly bonus: number;
  /** The requested bonus (`OrderView.plan`). */
  readonly plan: number;
  /** Ticks until the next charge is due (`next_charge_tick`); `null`: not known. */
  readonly nextIn: number | null;
}

/** The gathered "Defense" bonus of a group (or of the groups of a city) and its cap. */
export interface DefenseInfo {
  readonly bonus: number;
  readonly cap: number;
}

export type Ownership = 'mine' | 'enemy' | 'neutral';

export interface NodeInfo {
  readonly id: number;
  readonly owner: Ownership;
  readonly terrain: Terrain;
  readonly vp: number;
  readonly capital: boolean;
  /** Fixed by the node kind (DEC-22): public and exact. */
  readonly capacity: number;
  readonly detail: Detail;
  /** Charges in the warehouse, `null` unless the node is seen exactly. */
  readonly warehouse: number | null;
  /** Own units and charges standing here. */
  readonly mine: { readonly units: number; readonly charged: number };
  readonly enemy: EnemyInfo | null;
  /** Own city over its capacity: ticks until the next unit dies; `null` otherwise. */
  readonly attritionIn: number | null;
  /** Own city over its capacity right after a capture: ticks the grace still lasts. */
  readonly graceLeft: number | null;
  /** The recruit queue of an own city (DEC-25): units queued; `null` for the rest. */
  readonly recruitQueue: number | null;
  /** Own city: it may recruit (DEC-26: the barracks with `city_upgrades`); `null` for the rest. */
  readonly hasBarracks: boolean | null;
  /** Own city: warehouse level and the charges it holds (DEC-26); `null` for the rest. */
  readonly warehouseLevel: number | null;
  readonly warehouseCap: number | null;
  /** Own city: its current build of any kind and the whole seconds left; `null` without one. */
  readonly building: BuildingInfo | null;
  /**
   * Economy v2 (DEC-41, item 2): an own city is a factory; an enemy city next to an own node: a built
   * factory (DEC-31). `null` elsewhere and under v1.
   */
  readonly factory: boolean | null;
  /** Own node: the factory being built there (economy v2); `null` without one. */
  readonly factoryBuild: SiteInfo | null;
  /** Economy v2 (DEC-41, item 12): the node has a bunker (own, or an enemy one next to an own node). */
  readonly fort: boolean | null;
  /** Own node: the bunker being built there (economy v2); `null` without one. */
  readonly fortBuild: SiteInfo | null;
}

/** The current build of an own city (`NodeView.building`, DEC-26). */
export interface BuildingInfo {
  readonly kind: BuildKind;
  /** `null` while the build still waits for its payment in charges (economy v2, DEC-41, item 7). */
  readonly secondsLeft: number | null;
  /** Economy v2: charges the build still takes (the progressive payment); 0 under v1. */
  readonly owed: number;
}

/** A factory or a bunker being built (economy v2, `NodeView.factory_build`, `fort_build`). */
export interface SiteInfo {
  /** `null` while charges are still owed: the build time starts at the full payment. */
  readonly secondsLeft: number | null;
  readonly owed: number;
}

/** An own supply line (economy v2, `View.lines`): the server's path from the source to the target. */
export interface LineInfo {
  readonly id: number;
  readonly path: readonly number[];
}

export interface EnemyInfo {
  readonly modes: readonly Mode[];
  /** Totals, `null` unless seen exactly. */
  readonly units: number | null;
  readonly charged: number | null;
  readonly seenTick: number;
  /** The sighting is older than the node's current detail (fog memory). */
  readonly stale: boolean;
}

export interface HudEvent {
  /** Order of arrival, unique: keys the list. */
  readonly seq: number;
  readonly tick: number;
  readonly kind: string;
  readonly data: EventMsg['data'];
}

/** An own group in short (which groups stand together, for merging). */
export interface GroupChoice {
  readonly id: string;
  readonly units: number;
  readonly charged: number;
  readonly mode: Mode;
  /** The node the group stands in, `null` on a road. */
  readonly node: number | null;
  /** The group has a planned order: the server refuses to merge it until it departs (#212). */
  readonly planned: boolean;
}

export interface NodeChoice {
  readonly id: number;
  readonly owner: Ownership;
  /** Warehouse charges where the view has them (own nodes and nodes seen exactly). */
  readonly warehouse: number | null;
  /** Warehouse capacity of an own city (DEC-26); `null` where the view does not give it. */
  readonly warehouseCap: number | null;
}

/** A road and what its next level would give, from `EdgeView.upgrade_gain` (the server's numbers). */
export interface RoadInfo {
  readonly id: number;
  /** The two end nodes (from the map). */
  readonly a: number;
  readonly b: number;
  /** Current level (1..3, DEC-22; the wire calls it `width`). */
  readonly width: number;
  /**
   * What the next level adds (packet and unit speed, charges per period: DEC-28, item 7); `null`:
   * it cannot be upgraded. The price is `cost.build` CP per level.
   */
  readonly gain: UpgradeGain | null;
  /** A level is being built on it now (`EdgeView.build`): it cannot be raised until it is done. */
  readonly building: boolean;
}

export interface HudData {
  readonly tick: number;
  readonly me: PlayerId;
  /** Nicks of the two sides. */
  readonly nicks: { readonly mine: string; readonly enemy: string };
  /** The own or seen group under the pointer, for its charge tip; `null`: nothing. */
  readonly hovered: GroupInfo | null;
  readonly cp: CpInfo;
  readonly stance: Stance;
  /** The own front markers: the city of each, `null`: not placed (DEC-28, item 2). */
  readonly fronts: readonly (number | null)[];
  /** The own rear minimum of charges in the cities without a marker (DEC-28, item 3). */
  readonly rearMin: number;
  readonly vp: { readonly mine: number; readonly enemy: number };
  /** Whole seconds until the timer ends the match. */
  readonly secondsLeft: number;
  readonly group: GroupInfo | null;
  readonly node: NodeInfo | null;
  readonly groups: readonly GroupChoice[];
  readonly nodes: readonly NodeChoice[];
  readonly roads: readonly RoadInfo[];
  /** Economy v2: the own supply lines by id (empty under v1). */
  readonly lines: readonly LineInfo[];
  /** Newest first. */
  readonly events: readonly HudEvent[];
}

function nodeAt(nodes: readonly NodeView[], id: number): NodeView | undefined {
  return nodes[id];
}

function ownership(owner: PlayerId | null, me: PlayerId): Ownership {
  if (owner === null) {
    return 'neutral';
  }
  return owner === me ? 'mine' : 'enemy';
}

function groupInfo(group: GroupView, nodes: readonly NodeView[], tick: number): GroupInfo {
  const at = group.location.kind === 'node' ? group.location.node : null;
  return {
    id: group.id,
    units: group.units,
    charged: group.charged,
    mode: group.mode,
    node: at,
    capacity: at === null ? null : (nodeAt(nodes, at)?.capacity ?? null),
    progress: group.location.kind === 'edge' ? group.location.progress : null,
    destination: group.order?.dest ?? null,
    planned: group.order?.planned ?? false,
    defense:
      group.defense_bonus !== null && group.defense_cap !== null
        ? { bonus: group.defense_bonus, cap: group.defense_cap }
        : null,
    plannedBonus: group.order?.planned === true ? group.order.bonus : 0,
    gathering: gatheringOf(group, tick),
  };
}

function gatheringOf(group: GroupView, tick: number): GatheringInfo | null {
  const order = group.order;
  if (order?.gathering !== true) return null;
  return {
    bonus: order.bonus,
    plan: order.plan,
    nextIn: order.next_charge_tick === null ? null : Math.max(0, order.next_charge_tick - tick),
  };
}

function siteInfo(
  site: { readonly done_tick: number | null; readonly owed: number } | null,
  tick: number,
  tickHz: number,
): SiteInfo | null {
  if (site === null) return null;
  return {
    secondsLeft:
      site.done_tick === null ? null : Math.ceil(Math.max(0, site.done_tick - tick) / tickHz),
    owed: site.owed,
  };
}

function enemyInfo(seen: Seen | null, detail: Detail): EnemyInfo | null {
  if (seen === null) {
    return null;
  }
  const exact = seen.level === 'exact';
  return {
    modes: seen.enemy_modes,
    units: exact ? seen.enemy_units : null,
    charged: exact ? seen.enemy_charged : null,
    seenTick: seen.tick,
    stale: detail === 'fog',
  };
}

function nodeInfo(
  ctx: HudContext,
  node: NodeView,
  groups: readonly GroupView[],
  tick: number,
): NodeInfo {
  const file = ctx.map.nodes[node.id];
  const here = groups.filter((g) => g.location.kind === 'node' && g.location.node === node.id);
  return {
    id: node.id,
    owner: ownership(node.owner, ctx.me),
    terrain: file?.terrain ?? 'plains',
    vp: file?.vp ?? 0,
    capital: file?.capital_of != null,
    capacity: node.capacity,
    detail: node.detail,
    warehouse: node.warehouse,
    mine: {
      units: here.reduce((total, g) => total + g.units, 0),
      charged: here.reduce((total, g) => total + g.charged, 0),
    },
    enemy: enemyInfo(node.seen, node.detail),
    attritionIn: node.attrition_in,
    graceLeft: node.grace_left,
    recruitQueue: node.recruit_queue,
    hasBarracks: node.has_barracks,
    warehouseLevel: node.warehouse_level,
    warehouseCap: node.warehouse_cap,
    building:
      node.building === null
        ? null
        : {
            kind: node.building.kind,
            secondsLeft:
              node.building.done_tick === null
                ? null
                : Math.ceil(Math.max(0, node.building.done_tick - tick) / ctx.rules.tick_hz),
            owed: node.building.owed,
          },
    factory: node.factory,
    factoryBuild: siteInfo(node.factory_build, tick, ctx.rules.tick_hz),
    fort: node.fort,
    fortBuild: siteInfo(node.fort_build, tick, ctx.rules.tick_hz),
  };
}

function roadInfo(ctx: HudContext, edge: SnapshotMsg['view']['edges'][number]): RoadInfo {
  const file = ctx.map.edges[edge.id];
  return {
    id: edge.id,
    a: file?.a ?? -1,
    b: file?.b ?? -1,
    width: edge.width,
    gain: edge.upgrade_gain,
    building: edge.build !== null,
  };
}

/**
 * The tip's subject: one group, or the total of the groups standing in a city (their one icon),
 * as a group of its own with no order.
 */
function groupUnderPointer(
  view: SnapshotMsg['view'],
  target: HoverTarget,
  tick: number,
): GroupInfo | null {
  if (target === null) return null;
  if (typeof target === 'string') {
    const group = view.groups.find((g) => g.id === target);
    return group === undefined ? null : groupInfo(group, view.nodes, tick);
  }
  const here = view.groups.filter(
    (g) => g.location.kind === 'node' && g.location.node === target.node,
  );
  if (here.length === 0) return null;
  return {
    id: `node:${String(target.node)}`,
    units: here.reduce((total, g) => total + g.units, 0),
    charged: here.reduce((total, g) => total + g.charged, 0),
    mode: here.some((g) => g.mode === 'defense') ? 'defense' : 'attack',
    node: target.node,
    capacity: nodeAt(view.nodes, target.node)?.capacity ?? null,
    progress: null,
    destination: null,
    planned: false,
    defense: defenseOf(here),
    plannedBonus: here.reduce(
      (total, g) => total + (g.order?.planned === true ? g.order.bonus : 0),
      0,
    ),
    gathering: null,
  };
}

/** The bonus and the cap of the groups of a city in "Defense", summed as the server sent them. */
function defenseOf(groups: readonly GroupView[]): DefenseInfo | null {
  let bonus = 0;
  let cap = 0;
  let any = false;
  for (const g of groups) {
    if (g.defense_bonus === null || g.defense_cap === null) continue;
    bonus += g.defense_bonus;
    cap += g.defense_cap;
    any = true;
  }
  return any ? { bonus, cap } : null;
}

export function buildHudData(
  ctx: HudContext,
  snapshot: SnapshotMsg,
  selection: Selection | null,
  events: readonly HudEvent[],
  /** The group (or the groups of a city) under the pointer. */
  hovered: HoverTarget = null,
): HudData {
  const { view, tick } = snapshot;
  const { rules, me } = ctx;
  const selectedGroup =
    selection?.kind === 'group' ? view.groups.find((g) => g.id === selection.id) : undefined;
  const nodeId =
    selection?.kind === 'node'
      ? selection.id
      : selectedGroup?.location.kind === 'node'
        ? selectedGroup.location.node
        : null;
  const selectedNode = nodeId === null ? undefined : nodeAt(view.nodes, nodeId);

  return {
    tick,
    me,
    nicks: { mine: ctx.nicks[me], enemy: ctx.nicks[me === 0 ? 1 : 0] },
    hovered: groupUnderPointer(view, hovered, tick),
    cp: {
      value: view.me.cp,
      cap: rules.cp.cap,
      regenPerSecond: (rules.cp.per_period * rules.tick_hz) / rules.cp.period_ticks,
    },
    stance: view.me.stance,
    fronts: view.me.fronts,
    rearMin: view.me.rear_min,
    vp: { mine: view.vp[me], enemy: view.vp[me === 0 ? 1 : 0] },
    secondsLeft: Math.ceil(Math.max(0, rules.match_ticks - tick) / rules.tick_hz),
    group: selectedGroup === undefined ? null : groupInfo(selectedGroup, view.nodes, tick),
    node: selectedNode === undefined ? null : nodeInfo(ctx, selectedNode, view.groups, tick),
    groups: view.groups.map((g) => ({
      id: g.id,
      units: g.units,
      charged: g.charged,
      mode: g.mode,
      node: g.location.kind === 'node' ? g.location.node : null,
      planned: g.order?.planned ?? false,
    })),
    nodes: view.nodes.map((n) => ({
      id: n.id,
      owner: ownership(n.owner, me),
      warehouse: n.warehouse,
      warehouseCap: n.warehouse_cap,
    })),
    roads: view.edges.map((e) => roadInfo(ctx, e)),
    lines: view.lines,
    events,
  };
}
