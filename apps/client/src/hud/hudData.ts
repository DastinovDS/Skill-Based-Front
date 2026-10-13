/**
 * HUD data (CLI-08, #64): what the panels show, computed from one snapshot. Pure functions, no
 * Svelte and no PixiJS; `HudState` (hudState.svelte.ts) calls them once per snapshot (10 Hz), never
 * per frame (AGENTS.md 7.2). Everything here is language-free: components turn it into text with
 * `t()`.
 */
import type {
  Detail,
  EventMsg,
  GroupView,
  MapFile,
  Mode,
  NodeView,
  PlayerId,
  Priority,
  RoadKind,
  RulesetPublic,
  Seen,
  SnapshotMsg,
  Stance,
  Terrain,
  UpgradeGain,
} from '../protocol.gen.ts';
import { delayLeft } from '../render/intentLayout.ts';
import { estimateCombat, type CombatEstimate, type DefenderInput } from './combatEstimate.ts';

/** What the player picked to look at: one own group or one node. */
export type Selection =
  { readonly kind: 'group'; readonly id: string } | { readonly kind: 'node'; readonly id: number };

/** What the pointer rests on (the tooltip): a selectable thing, a road, or the arrow of an intent. */
export type HoverTarget =
  | Selection
  | { readonly kind: 'edge'; readonly id: number }
  | { readonly kind: 'intent'; readonly id: string };

/** The enemy node a selected group would attack, and how (for the combat estimate). */
export interface AttackTarget {
  readonly node: number;
  /** A planned order: brings `planned_bonus` virtual shots. */
  readonly planned: boolean;
}

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
  /** The road this city builds (DEC-16), if the snapshot shows one. */
  readonly build: BuildInfo | null;
  /** Own city over its capacity: ticks until the next unit dies; `null` otherwise. */
  readonly attritionIn: number | null;
  /** Own city over its capacity right after a capture: ticks the grace still lasts. */
  readonly graceLeft: number | null;
  /** Supply priority of an own city (DEC-18); `null` for the rest. */
  readonly priority: Priority | null;
}

/** A road level a city builds (`NodeView.build`). */
export interface BuildInfo {
  readonly edge: number;
  /** Whole seconds until the width grows; `null` for an enemy build (the server does not say). */
  readonly secondsLeft: number | null;
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

export interface EstimateInfo {
  readonly target: AttackTarget;
  readonly result: CombatEstimate;
}

/** An own group in short (which groups stand together, for merging). */
export interface GroupChoice {
  readonly id: string;
  readonly units: number;
  /** The node the group stands in, `null` on a road. */
  readonly node: number | null;
  /** The group has a planned order: the server refuses to merge it until it departs (#212). */
  readonly planned: boolean;
}

export interface NodeChoice {
  readonly id: number;
  readonly owner: Ownership;
  /** Supply priority of an own city (DEC-18); `null` for the rest. */
  readonly priority: Priority | null;
  /** Warehouse charges where the view has them (own nodes and nodes seen exactly). */
  readonly warehouse: number | null;
}

/** A road and what its next level would give, from `EdgeView.upgrade_gain` (the server's numbers). */
export interface RoadInfo {
  readonly id: number;
  /** The two end nodes (from the map). */
  readonly a: number;
  readonly b: number;
  /** Current level (1..3, DEC-22; the wire calls it `width`). */
  readonly width: number;
  /** Road type: `none` on level 1, then the type the first upgrade chose (DEC-22). */
  readonly kind: RoadKind;
  /** What the next level adds per type; `null`: the road cannot be upgraded (DEC-22, item 7). */
  readonly gain: UpgradeGain | null;
  /**
   * Warehouse charges the next level costs (`ruleset_public.build`, DEC-16); `null` when the road
   * cannot be upgraded or the ruleset has no price for that width.
   */
  readonly charges: number | null;
}

/** A public intent (planned order or "Defense") under the pointer. */
export interface IntentInfo {
  readonly id: string;
  readonly owner: 'mine' | 'enemy';
  readonly kind: 'planned_move' | 'defense';
  readonly origin: number;
  readonly target: number | null;
  /** Ticks until the order leaves; `null`: it has left already. */
  readonly ticksLeft: number | null;
}

/** What the tooltip shows, from the snapshot (language-free; `hud/tipText.ts` writes the text). */
export type TipInfo =
  | { readonly kind: 'node'; readonly node: NodeInfo }
  | { readonly kind: 'edge'; readonly road: RoadInfo }
  | { readonly kind: 'group'; readonly group: GroupInfo }
  | { readonly kind: 'intent'; readonly intent: IntentInfo };

export interface HudData {
  readonly tick: number;
  readonly me: PlayerId;
  /** Nicks of the two sides. */
  readonly nicks: { readonly mine: string; readonly enemy: string };
  /** The thing under the pointer, for the tooltip; `null`: nothing. */
  readonly tip: TipInfo | null;
  readonly cp: CpInfo;
  readonly stance: Stance;
  readonly vp: { readonly mine: number; readonly enemy: number };
  /** Whole seconds until the timer ends the match. */
  readonly secondsLeft: number;
  readonly group: GroupInfo | null;
  readonly node: NodeInfo | null;
  readonly estimate: EstimateInfo | null;
  readonly groups: readonly GroupChoice[];
  readonly nodes: readonly NodeChoice[];
  readonly roads: readonly RoadInfo[];
  /** Newest first. */
  readonly events: readonly HudEvent[];
}

function nodeAt(nodes: readonly NodeView[], id: number): NodeView | undefined {
  return nodes[id];
}

/** Charges for raising a road to `width` (`build.charges_per_level`); `null` if not listed. */
export function levelCharges(rules: RulesetPublic, width: number): number | null {
  return rules.build.charges_per_level.find((level) => level.width === width)?.charges ?? null;
}

/**
 * The roads city `node` may be asked to upgrade: its roads with an upgrade hint (the server sends
 * one only for own internal roads below their maximum width). Whether the command is accepted is
 * still the server's call (supply, busy roads, charges).
 */
export function roadCandidates(roads: readonly RoadInfo[], node: number): RoadInfo[] {
  return roads.filter((r) => (r.a === node || r.b === node) && r.gain !== null);
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

function buildInfo(ctx: HudContext, node: NodeView, tick: number): BuildInfo | null {
  const build = node.build;
  if (build === null) return null;
  const left = build.done_tick === null ? null : Math.max(0, build.done_tick - tick);
  return {
    edge: build.edge,
    secondsLeft: left === null ? null : Math.ceil(left / ctx.rules.tick_hz),
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
    build: buildInfo(ctx, node, tick),
    attritionIn: node.attrition_in,
    graceLeft: node.grace_left,
    priority: node.priority,
  };
}

function intentInfo(ctx: HudContext, view: SnapshotMsg, id: string): IntentInfo | null {
  const intent = view.view.intents.find((i) => i.id === id);
  if (intent === undefined) {
    return null;
  }
  const delay =
    intent.kind === 'planned_move'
      ? ctx.rules.orders.planned_delay_ticks
      : ctx.rules.orders.defense_delay_ticks;
  const left = delayLeft(intent.created_tick, view.tick, delay);
  return {
    id,
    owner: intent.owner === ctx.me ? 'mine' : 'enemy',
    kind: intent.kind,
    origin: intent.origin,
    target: intent.target,
    ticksLeft: left > 0 ? left : null,
  };
}

function roadInfo(ctx: HudContext, edge: SnapshotMsg['view']['edges'][number]): RoadInfo {
  const file = ctx.map.edges[edge.id];
  return {
    id: edge.id,
    a: file?.a ?? -1,
    b: file?.b ?? -1,
    width: edge.width,
    kind: edge.kind,
    gain: edge.upgrade_gain,
    charges: edge.upgrade_gain === null ? null : levelCharges(ctx.rules, edge.width + 1),
  };
}

function tipFor(ctx: HudContext, snapshot: SnapshotMsg, hover: HoverTarget | null): TipInfo | null {
  const { view } = snapshot;
  if (hover === null) return null;
  switch (hover.kind) {
    case 'node': {
      const node = nodeAt(view.nodes, hover.id);
      return node === undefined
        ? null
        : { kind: 'node', node: nodeInfo(ctx, node, view.groups, snapshot.tick) };
    }
    case 'edge': {
      const edge = view.edges[hover.id];
      return edge === undefined ? null : { kind: 'edge', road: roadInfo(ctx, edge) };
    }
    case 'group': {
      const group = view.groups.find((g) => g.id === hover.id);
      return group === undefined ? null : { kind: 'group', group: groupInfo(group, view.nodes) };
    }
    case 'intent': {
      const intent = intentInfo(ctx, snapshot, hover.id);
      return intent === null ? null : { kind: 'intent', intent };
    }
  }
}

/** What the client knows of the enemy at `node`, in the terms of the estimate. */
export function defenderOf(node: NodeView): DefenderInput {
  const seen = node.seen;
  const current = node.detail !== 'fog' && seen !== null;
  if (
    current &&
    seen.level === 'exact' &&
    seen.enemy_units !== null &&
    seen.enemy_charged !== null
  ) {
    return {
      visibility: 'exact',
      units: seen.enemy_units,
      charged: seen.enemy_charged,
      modes: seen.enemy_modes,
    };
  }
  if (current && seen.enemy_modes.length === 0) {
    // Seen now and no enemy group there: an empty node, known exactly.
    return { visibility: 'exact', units: 0, charged: 0, modes: [] };
  }
  return {
    visibility: 'partial',
    capacity: node.capacity,
    modes: current ? seen.enemy_modes : null,
  };
}

function estimateFor(
  ctx: HudContext,
  group: GroupView,
  target: AttackTarget,
  nodes: readonly NodeView[],
): EstimateInfo | null {
  const node = nodeAt(nodes, target.node);
  const file = ctx.map.nodes[target.node];
  if (node === undefined || file === undefined || node.owner === null || node.owner === ctx.me) {
    return null;
  }
  return {
    target,
    result: estimateCombat(
      ctx.rules.combat,
      {
        units: group.units,
        // Every charged unit fires (DEC-16 removed the non-firing "build" mode).
        firingCharged: group.charged,
        planned: target.planned,
      },
      defenderOf(node),
      file.terrain,
    ),
  };
}

export function buildHudData(
  ctx: HudContext,
  snapshot: SnapshotMsg,
  selection: Selection | null,
  target: AttackTarget | null,
  events: readonly HudEvent[],
  hover: HoverTarget | null = null,
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
    tip: tipFor(ctx, snapshot, hover),
    cp: {
      value: view.me.cp,
      cap: rules.cp.cap,
      regenPerSecond: (rules.cp.per_period * rules.tick_hz) / rules.cp.period_ticks,
    },
    stance: view.me.stance,
    vp: { mine: view.vp[me], enemy: view.vp[me === 0 ? 1 : 0] },
    secondsLeft: Math.ceil(Math.max(0, rules.match_ticks - tick) / rules.tick_hz),
    group: selectedGroup === undefined ? null : groupInfo(selectedGroup, view.nodes),
    node: selectedNode === undefined ? null : nodeInfo(ctx, selectedNode, view.groups, tick),
    estimate:
      selectedGroup === undefined || target === null
        ? null
        : estimateFor(ctx, selectedGroup, target, view.nodes),
    groups: view.groups.map((g) => ({
      id: g.id,
      units: g.units,
      node: g.location.kind === 'node' ? g.location.node : null,
      planned: g.order?.planned ?? false,
    })),
    nodes: view.nodes.map((n) => ({
      id: n.id,
      owner: ownership(n.owner, me),
      priority: n.priority,
      warehouse: n.warehouse,
    })),
    roads: view.edges.map((e) => roadInfo(ctx, e)),
    events,
  };
}
