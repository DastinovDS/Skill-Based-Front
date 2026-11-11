// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { MapFile, SnapshotMsg } from '../protocol.gen.ts';
import { DEV_RULES } from './devFeed.ts';
import { buildHudData, type HudContext } from './hudData.ts';

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
const ctx: HudContext = { me: 0, nicks: ['Ember', 'Bot'], rules: DEV_RULES, map };

describe('buildHudData: the numbers of the snapshot', () => {
  const data = buildHudData(ctx, fog, null);

  it('takes CP, stance and VP from the view, from my side', () => {
    expect(data.cp).toEqual({
      value: 500,
      cap: DEV_RULES.cp.cap,
      regenPerSecond:
        (DEV_RULES.cp.per_period * DEV_RULES.tick_hz) / DEV_RULES.stances.cp_period_ticks.war,
      quantum: DEV_RULES.cp.per_period,
    });
    expect(data.stance).toBe('war');
    expect(data.vp).toEqual({ mine: 4, enemy: 6 });
  });

  it('turns the tick into the time left', () => {
    expect(data.secondsLeft).toBe((DEV_RULES.match_ticks - 300) / DEV_RULES.tick_hz);
  });

  it('counts VP from the other side for player 1', () => {
    expect(buildHudData({ ...ctx, me: 1 }, fog, null).vp).toEqual({ mine: 6, enemy: 4 });
  });

  it('lists the groups and nodes to pick from', () => {
    expect(data.groups).toEqual([
      { id: '71ad4e0c9b2f6358', units: 3, charged: 2, mode: 'attack', node: 0, planned: false },
    ]);
    expect(data.nodes.map((n) => n.owner)).toEqual(['mine', 'enemy', 'enemy']);
  });
});

describe('buildHudData: selection', () => {
  it('shows a group with its node capacity', () => {
    const data = buildHudData(ctx, fog, { kind: 'group', id: '71ad4e0c9b2f6358' });
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
    const own = buildHudData(ctx, fog, { kind: 'node', id: 0 });
    expect(own.group).toBeNull();
    expect(own.node).toMatchObject({
      owner: 'mine',
      capacity: 4,
      warehouse: 4,
    });
    const enemy = buildHudData(ctx, fog, { kind: 'node', id: 2 });
    expect(enemy.node).toMatchObject({
      owner: 'enemy',
      capacity: 4, // DEC-22: public and exact, also in fog
      warehouse: null,
      enemy: { modes: ['attack'], units: null, seenTick: 90, stale: true },
    });
  });

  it('shows nothing for a group that is gone', () => {
    const data = buildHudData(ctx, fog, { kind: 'group', id: 'gone' });
    expect(data.group).toBeNull();
    expect(data.node).toBeNull();
  });
});

describe('buildHudData: plan bonuses of own groups (DEC-29)', () => {
  const [own] = fog.view.groups;
  if (own === undefined) throw new Error('the fixture has a group');
  const withGroup = (patch: Partial<typeof own>): SnapshotMsg => ({
    ...fog,
    view: { ...fog.view, groups: [{ ...own, ...patch }] },
  });

  it('passes the bonus of a planned order, and 0 for an ordinary order or none', () => {
    const order = (planned: boolean, bonus: number) => ({
      dest: 1,
      path: [1] as [number, ...number[]],
      planned,
      bonus,
      gathering: false,
      plan: 0,
      next_charge_tick: null,
      depart_tick: null,
      group_order: null,
      arrive_tick: null,
    });
    const info = (patch: Partial<typeof own>) =>
      buildHudData(ctx, withGroup(patch), { kind: 'group', id: own.id }).group;
    expect(info({ order: order(true, 2) })?.plannedBonus).toBe(2);
    expect(info({ order: order(false, 0) })?.plannedBonus).toBe(0);
    expect(info({ order: null })?.plannedBonus).toBe(0);
  });
});
