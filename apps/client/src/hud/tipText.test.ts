import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale } from '../i18n/index.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { SnapshotMsg } from '../protocol.gen.ts';
import { DEV_RULES, devSnapshot } from './devFeed.ts';
import { buildHudData, type HoverTarget, type HudContext } from './hudData.ts';
import { tipText } from './tipText.ts';

const ctx: HudContext = { me: 0, nicks: ['Danya', 'Guest'], rules: DEV_RULES, map: DEFAULT_MAP };
const env = { rules: DEV_RULES, pickable: false };
const base = devSnapshot(DEFAULT_MAP, DEV_RULES, 100);
const group = base.view.groups[0];
const home = group?.location.kind === 'node' ? group.location.node : -1;
const road = DEFAULT_MAP.edges.find((e) => e.a === home || e.b === home);
if (group === undefined || road === undefined) throw new Error('small dev snapshot');

function tipOf(hover: HoverTarget, snapshot: SnapshotMsg = base) {
  const tip = buildHudData(ctx, snapshot, null, null, [], hover).tip;
  if (tip === null) throw new Error('no tip');
  return tipText(tip, env);
}

describe('tipText', () => {
  const initial = getLocale();
  afterEach(() => {
    setLocale(initial);
  });

  it('says nothing for nothing', () => {
    expect(buildHudData(ctx, base, null, null, [], null).tip).toBeNull();
    expect(buildHudData(ctx, base, null, null, [], { kind: 'node', id: 999 }).tip).toBeNull();
  });

  it('gives a city its numbers: capacity, warehouse, terrain with the modifier, VP', () => {
    setLocale('en');
    const tip = tipOf({ kind: 'node', id: home });
    const node = DEFAULT_MAP.nodes[home];
    expect(tip.title).toMatch(/^(Capital|City) \d+ \(yours\)$|mine/i);
    const rows = Object.fromEntries(tip.rows.map((r) => [r.label, r.value]));
    expect(rows.Capacity).toBe(String(base.view.nodes[home]?.capacity));
    expect(rows.Warehouse).toBe(String(base.view.nodes[home]?.warehouse));
    const mod = DEV_RULES.combat.terrain_defense_mod[node?.terrain ?? 'plains'];
    expect(rows.Terrain).toContain(`defense ${mod > 0 ? '+' : ''}${String(mod)}`);
    // The nested hint explains the term.
    expect(tip.rows.find((r) => r.label === 'Capacity')?.hint).toContain('how many units');
  });

  it('shows the capacity of a fogged enemy city exactly (DEC-22: it is public)', () => {
    setLocale('en');
    const fogged = base.view.nodes.find((n) => n.detail === 'fog' && n.owner === 1);
    if (fogged === undefined) throw new Error('no fogged enemy node in the dev snapshot');
    const tip = tipOf({ kind: 'node', id: fogged.id });
    expect(tip.rows.find((r) => r.label === 'Capacity')?.value).toBe(String(fogged.capacity));
  });

  it('shows the countdown of an overcrowded own city', () => {
    setLocale('en');
    const snapshot: SnapshotMsg = {
      ...base,
      view: {
        ...base.view,
        nodes: base.view.nodes.map((n) => (n.id === home ? { ...n, attrition_in: 24 } : n)),
      },
    };
    const tip = tipOf({ kind: 'node', id: home }, snapshot);
    expect(tip.rows.find((r) => r.label === 'Overcrowding')?.value).toBe('a unit is lost in 2.4 s');
  });

  it('shows the travel time of the selected group, or that it must split (DEC-20)', () => {
    setLocale('en');
    const tip = buildHudData(ctx, base, null, null, [], { kind: 'node', id: home }).tip;
    if (tip === null) throw new Error('no tip');
    const timed = tipText(tip, { ...env, route: { ticks: 45, split: false } });
    expect(timed.rows.find((r) => r.label === 'Travel')?.value).toBe('4.5 s');
    const split = tipText(tip, { ...env, route: { ticks: null, split: true } });
    expect(split.rows.find((r) => r.label === 'Travel')?.value).toBe('split the group');
    expect(split.note).toContain('(S)');
    expect(tipText(tip, env).rows.find((r) => r.label === 'Travel')).toBeUndefined();
  });

  it('gives a road its level and type, and what each type of the next level gives and costs', () => {
    setLocale('en');
    const plain = tipOf({ kind: 'edge', id: road.id });
    expect(plain.rows).toEqual([
      { label: 'Level', value: String(road.base_width) },
      { label: 'Type', value: 'plain' },
    ]);
    const snapshot: SnapshotMsg = {
      ...base,
      view: {
        ...base.view,
        edges: base.view.edges.map((e) =>
          e.id === road.id
            ? {
                ...e,
                upgrade_gain: {
                  fast: { speed_pct: 50, amount: 0 },
                  freight: { speed_pct: 0, amount: 1 },
                },
              }
            : e,
        ),
      },
    };
    const tip = tipOf({ kind: 'edge', id: road.id }, snapshot);
    const level = String(road.base_width + 1);
    const fast = tip.rows.find((r) => r.label === `fast, level ${level}`);
    expect(fast?.value).toMatch(/^\+50% packet speed, costs \d+ charges$/);
    const freight = tip.rows.find((r) => r.label === `freight, level ${level}`);
    expect(freight?.value).toMatch(/^\+1 charges per period, costs \d+ charges$/);
    expect(tip.note).toContain('Select your city');
    const hovered = buildHudData(ctx, snapshot, null, null, [], { kind: 'edge', id: road.id });
    if (hovered.tip === null) throw new Error('no tip');
    // In the road pick of the city a click upgrades the road: the note says so.
    expect(tipText(hovered.tip, { ...env, pickable: true }).note).toContain('Click');
  });

  it('describes an own group', () => {
    setLocale('en');
    const tip = tipOf({ kind: 'group', id: group.id });
    expect(tip.title).toBe(`Group: ${String(group.units)} units`);
    const rows = Object.fromEntries(tip.rows.map((r) => [r.label, r.value]));
    expect(rows.Charged).toBe(`${String(group.charged)} of ${String(group.units)} charged`);
    expect(rows.Place).toBe(`At node ${String(home)}`);
  });

  it('describes the arrow of an intent with the time left and "already on the way" after', () => {
    setLocale('en');
    const target = base.view.nodes.find((n) => n.owner === 0 && n.id !== home)?.id ?? 0;
    const origin = base.view.nodes.find((n) => n.owner === 1)?.id ?? 0;
    const withIntent = (created: number): SnapshotMsg => ({
      ...base,
      view: {
        ...base.view,
        intents: [
          { id: 'i1', owner: 1, kind: 'planned_move', origin, target, created_tick: created },
        ],
      },
    });
    const soon = tipOf({ kind: 'intent', id: 'i1' }, withIntent(90));
    expect(soon.title).toBe('Planned order of the enemy');
    expect(soon.rows).toEqual([
      { label: 'From', value: `city ${String(origin)}` },
      { label: 'To', value: `city ${String(target)}` },
      { label: 'Leaves in', value: '2.0 s' },
    ]);
    const gone = tipOf({ kind: 'intent', id: 'i1' }, withIntent(10));
    expect(gone.rows.at(-1)?.value).toBe('already on the way');
  });

  it('writes the same tooltip in Russian', () => {
    setLocale('ru');
    const tip = tipOf({ kind: 'group', id: group.id });
    expect(tip.title).toContain('Группа');
  });
});
