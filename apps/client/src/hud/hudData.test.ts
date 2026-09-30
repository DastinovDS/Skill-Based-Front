// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { MapFile, NodeView, Seen, SnapshotMsg } from '../protocol.gen.ts';
import { DEV_RULES } from './devFeed.ts';
import { buildHudData, defenderOf, type HudContext } from './hudData.ts';

const snapshotFiles = import.meta.glob<string>(
  '../../../../packages/protocol/fixtures/server/snapshot_fog.json',
  { eager: true, import: 'default', query: '?raw' },
);
const text = Object.values(snapshotFiles)[0];
if (text === undefined) {
  throw new Error('snapshot_fog.json not found');
}
/** PRO-01 fixture: player 0 with 3 nodes (own / presence / fog), one own group at node 0. */
const fog = JSON.parse(text) as SnapshotMsg;

const base = DEFAULT_MAP;
// The fixture has 3 nodes; give them known terrain, the rest of the map is not used.
const map: MapFile = {
  ...base,
  nodes: base.nodes.map((n) => ({ ...n, terrain: 'forest', vp: n.id === 1 ? 2 : n.vp })),
};
const ctx: HudContext = { me: 0, rules: DEV_RULES, map };

function withNode(patch: Partial<NodeView> & { id: number }): SnapshotMsg {
  return {
    ...fog,
    view: {
      ...fog.view,
      nodes: fog.view.nodes.map((n) => (n.id === patch.id ? { ...n, ...patch } : n)),
    },
  };
}

describe('buildHudData: the numbers of the snapshot', () => {
  const data = buildHudData(ctx, fog, null, null, []);

  it('takes CP, stance and VP from the view, from my side', () => {
    expect(data.cp).toEqual({
      value: 500,
      cap: DEV_RULES.cp.cap,
      regenPerSecond: (DEV_RULES.cp.per_period * DEV_RULES.tick_hz) / DEV_RULES.cp.period_ticks,
    });
    expect(data.stance).toBe('war');
    expect(data.vp).toEqual({ mine: 4, enemy: 6 });
  });

  it('turns the tick into the time left', () => {
    expect(data.secondsLeft).toBe((DEV_RULES.match_ticks - 300) / DEV_RULES.tick_hz);
  });

  it('counts VP from the other side for player 1', () => {
    expect(buildHudData({ ...ctx, me: 1 }, fog, null, null, []).vp).toEqual({ mine: 6, enemy: 4 });
  });

  it('lists the groups and nodes to pick from', () => {
    expect(data.groups).toEqual([{ id: '71ad4e0c9b2f6358', units: 3, node: 0 }]);
    expect(data.nodes.map((n) => n.owner)).toEqual(['mine', 'enemy', 'enemy']);
  });
});

describe('buildHudData: selection', () => {
  it('shows a group with its node capacity', () => {
    const data = buildHudData(ctx, fog, { kind: 'group', id: '71ad4e0c9b2f6358' }, null, []);
    expect(data.group).toMatchObject({
      units: 3,
      charged: 2,
      mode: 'attack',
      node: 0,
      capacity: 4,
    });
    // A group at a node shows that node too.
    expect(data.node).toMatchObject({ id: 0, warehouse: 4, mine: { units: 3, charged: 2 } });
  });

  it('shows a node with warehouse and enemy sighting', () => {
    const own = buildHudData(ctx, fog, { kind: 'node', id: 0 }, null, []);
    expect(own.group).toBeNull();
    expect(own.node).toMatchObject({ owner: 'mine', capacity: 4, warehouse: 4 });
    const enemy = buildHudData(ctx, fog, { kind: 'node', id: 2 }, null, []);
    expect(enemy.node).toMatchObject({
      owner: 'enemy',
      warehouse: null,
      enemy: { modes: ['defense'], units: null, seenTick: 90, stale: true },
    });
  });

  it('shows nothing for a group that is gone', () => {
    const data = buildHudData(ctx, fog, { kind: 'group', id: 'gone' }, null, []);
    expect(data.group).toBeNull();
    expect(data.node).toBeNull();
  });
});

describe('buildHudData: combat estimate', () => {
  const group = { kind: 'group', id: '71ad4e0c9b2f6358' } as const;
  const combat = DEV_RULES.combat;

  it('gives a ceiling for an enemy seen as presence only', () => {
    const data = buildHudData(ctx, fog, group, { node: 1, planned: false }, []);
    // Forest: no terrain modifier. Node 1 holds at most capacity 2; I shoot with 2 charges.
    expect(data.estimate?.result).toEqual({
      kind: 'upper_bound',
      attackerPool: 2,
      defenderPoolMax: 2,
      attackerLossesMax: 0,
      defenderUnitsMax: 2,
    });
  });

  it('assumes the Defense bonus may be there for a node in fog', () => {
    const data = buildHudData(ctx, fog, group, { node: 2, planned: true }, []);
    expect(data.estimate?.result).toMatchObject({
      kind: 'upper_bound',
      attackerPool: 2 + combat.planned_bonus,
      defenderPoolMax: 4 + combat.defense_bonus,
    });
  });

  it('is exact when the enemy is seen in full', () => {
    const seen: Seen = {
      tick: 300,
      level: 'exact',
      enemy_modes: ['attack'],
      enemy_units: 1,
      enemy_charged: 1,
    };
    const data = buildHudData(
      ctx,
      withNode({ id: 1, detail: 'exact', seen }),
      group,
      { node: 1, planned: false },
      [],
    );
    // Pools 2 against 1: one enemy unit dies and the node is taken.
    expect(data.estimate?.result).toMatchObject({
      kind: 'exact',
      attackerPool: 2,
      defenderPool: 1,
      defenderLosses: 1,
      captures: true,
    });
  });

  it('knows an empty node: presence without enemy groups', () => {
    const seen: Seen = {
      tick: 300,
      level: 'presence',
      enemy_modes: [],
      enemy_units: null,
      enemy_charged: null,
    };
    const node = withNode({ id: 1, seen }).view.nodes[1];
    if (node === undefined) throw new Error('no node 1');
    expect(defenderOf(node)).toEqual({ visibility: 'exact', units: 0, charged: 0, modes: [] });
  });

  it('does not trust an old sighting in fog', () => {
    const node = fog.view.nodes[2];
    if (node === undefined) throw new Error('no node 2');
    expect(defenderOf(node)).toEqual({ visibility: 'partial', capacity: 4, modes: null });
  });

  it('has no estimate for my own node or without a target', () => {
    expect(buildHudData(ctx, fog, group, { node: 0, planned: false }, []).estimate).toBeNull();
    expect(buildHudData(ctx, fog, group, null, []).estimate).toBeNull();
    expect(
      buildHudData(ctx, fog, { kind: 'node', id: 0 }, { node: 1, planned: false }, []).estimate,
    ).toBeNull();
  });
});
