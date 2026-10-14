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
  const text = tipText(tip, env);
  if (text === null) throw new Error('no text');
  return text;
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

  it('has no tooltip text for a city or a group: the group shows only its charges', () => {
    const city = buildHudData(ctx, base, null, null, [], { kind: 'node', id: home }).tip;
    const own = buildHudData(ctx, base, null, null, [], { kind: 'group', id: group.id }).tip;
    if (city === null || own === null) throw new Error('no tip');
    expect(city.kind).toBe('node');
    expect(tipText(city, env)).toBeNull();
    expect(own.kind).toBe('group');
    expect(tipText(own, env)).toBeNull();
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
    expect(tipText(hovered.tip, { ...env, pickable: true })?.note).toContain('Click');
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
    const tip = tipOf({ kind: 'edge', id: road.id });
    expect(tip.title).toContain('Дорога');
  });
});
