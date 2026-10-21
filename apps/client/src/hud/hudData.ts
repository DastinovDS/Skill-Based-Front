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
}

/** The current build of an own city (`NodeView.building`, DEC-26). */
export interface BuildingInfo {
  readonly kind: BuildKind;
  readonly secondsLeft: number;
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

function groupInfo(group: GroupView, nodes: readonly NodeView[]): GroupInfo {
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
            secondsLeft: Math.ceil(Math.max(0, node.building.done_tick - tick) / ctx.rules.tick_hz),
          },
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
function groupUnderPointer(view: SnapshotMsg['view'], target: HoverTarget): GroupInfo | null {
  if (target === null) return null;
  if (typeof target === 'string') {
    const group = view.groups.find((g) => g.id === target);
    return group === undefined ? null : groupInfo(group, view.nodes);
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
  };
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
    hovered: groupUnderPointer(view, hovered),
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
    group: selectedGroup === undefined ? null : groupInfo(selectedGroup, view.nodes),
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
    events,
  };
}
