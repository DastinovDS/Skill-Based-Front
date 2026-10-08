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
  RulesetPublic,
  Seen,
  SnapshotMsg,
  Stance,
  Terrain,
} from '../protocol.gen.ts';
import { estimateCombat, type CombatEstimate, type DefenderInput } from './combatEstimate.ts';

/** What the player picked to look at: one own group or one node. */
export type Selection =
  { readonly kind: 'group'; readonly id: string } | { readonly kind: 'node'; readonly id: number };

/** The enemy node a selected group would attack, and how (for the combat estimate). */
export interface AttackTarget {
  readonly node: number;
  /** A planned order: brings `planned_bonus` virtual shots. */
  readonly planned: boolean;
}

/** Fixed for the whole match: the ruleset from `welcome` and the map. */
export interface HudContext {
  readonly me: PlayerId;
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
  readonly capacity: number;
  readonly detail: Detail;
  /** Charges in the warehouse, `null` unless the node is seen exactly. */
  readonly warehouse: number | null;
  /** Own units and charges standing here. */
  readonly mine: { readonly units: number; readonly charged: number };
  readonly enemy: EnemyInfo | null;
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
}

/** What the next level of a road would give, from `EdgeView.upgrade_gain` (the server's numbers). */
export interface RoadInfo {
  readonly id: number;
  /** Hundredths of capacity added to each end city; `null`: the road cannot be upgraded. */
  readonly capacityCenti: number | null;
  /** Percentage points of packet speed. */
  readonly packetSpeedPct: number | null;
}

export interface HudData {
  readonly tick: number;
  readonly me: PlayerId;
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

function nodeInfo(ctx: HudContext, node: NodeView, groups: readonly GroupView[]): NodeInfo {
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
  };
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
        firingCharged: group.mode === 'build' ? 0 : group.charged,
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
    cp: {
      value: view.me.cp,
      cap: rules.cp.cap,
      regenPerSecond: (rules.cp.per_period * rules.tick_hz) / rules.cp.period_ticks,
    },
    stance: view.me.stance,
    vp: { mine: view.vp[me], enemy: view.vp[me === 0 ? 1 : 0] },
    secondsLeft: Math.ceil(Math.max(0, rules.match_ticks - tick) / rules.tick_hz),
    group: selectedGroup === undefined ? null : groupInfo(selectedGroup, view.nodes),
    node: selectedNode === undefined ? null : nodeInfo(ctx, selectedNode, view.groups),
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
    nodes: view.nodes.map((n) => ({ id: n.id, owner: ownership(n.owner, me) })),
    roads: view.edges.map((e) => ({
      id: e.id,
      capacityCenti: e.upgrade_gain?.capacity_centi ?? null,
      packetSpeedPct: e.upgrade_gain?.packet_speed_pct ?? null,
    })),
    events,
  };
}
