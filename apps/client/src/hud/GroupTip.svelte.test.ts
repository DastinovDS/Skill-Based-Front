import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../i18n/index.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { GroupView, RulesetPublic } from '../protocol.gen.ts';
import { DEV_RULES, devSnapshot } from './devFeed.ts';
import GroupTip from './GroupTip.svelte';
import { buildHudData, type HudContext } from './hudData.ts';

// The numbers of the tip are the ruleset's and the snapshot's: 6 s a point, the price of the mode.
const RULES: RulesetPublic = {
  ...DEV_RULES,
  tick_hz: 10,
  orders: { ...DEV_RULES.orders, defense_ticks_per_bonus: 60 },
  cost: { ...DEV_RULES.cost, defense: 200 },
};
const ctx: HudContext = { me: 0, nicks: ['Danya', 'Bot'], rules: RULES, map: DEFAULT_MAP };
const base = devSnapshot(DEFAULT_MAP, RULES, 100);
const city = base.view.nodes.find((n) => n.owner === 0)?.id ?? 0;

const group = (patch: Partial<GroupView>): GroupView => ({
  id: 'g',
  units: 4,
  charged: 3,
  mode: 'attack',
  location: { kind: 'node', node: city },
  order: null,
  defense_bonus: null,
  defense_cap: null,
  ...patch,
});

/** What the tip says about the group `g` of a snapshot, after the pointer rests on it. */
function tipOf(groups: GroupView[], hover: string | { node: number } = 'g'): string | null {
  const snapshot = { ...base, view: { ...base.view, groups } };
  const hovered = buildHudData(ctx, snapshot, null, [], hover).hovered;
  const canvas = document.body.appendChild(document.createElement('div'));
  canvas.className = 'game-canvas';
  const target = document.body.appendChild(document.createElement('div'));
  mounted.push(mount(GroupTip, { target, props: { group: hovered, rules: RULES } }));
  flushSync();
  canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 0 }));
  vi.advanceTimersByTime(400);
  flushSync();
  const tip = target.querySelector('[role="tooltip"]');
  return tip === null ? null : tip.textContent.replace(/\s+/g, ' ').trim();
}

let mounted: Record<string, unknown>[] = [];

describe('GroupTip: the Defense bonus and the bonus of a plan (DEC-30, DEC-29)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setLocale('en');
  });
  afterEach(() => {
    for (const m of mounted) void unmount(m);
    mounted = [];
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('tells the bonus an own group in Defense has gathered, and the rule of the mode', () => {
    const text = tipOf([group({ mode: 'defense', defense_bonus: 2, defense_cap: 3 })]);
    expect(text).toContain('Defense: bonus 2 of 3');
    // 60 ticks at 10 a second is 6 s a point; 200 hundredths of CP is 2 CP.
    expect(text).toContain('+1 for every 6 s in the mode');
    expect(text).toContain('burns after a fight');
    expect(text).toContain('costs 2 CP');
  });

  it('follows the language of the page', () => {
    setLocale('ru');
    const text = tipOf([group({ mode: 'defense', defense_bonus: 1, defense_cap: 3 })]);
    expect(text).toContain('Защита: бонус 1 из 3');
    expect(text).toContain('каждые 6 с');
  });

  it('says nothing of the bonus for a group not in Defense', () => {
    const text = tipOf([group({})]);
    expect(text).not.toContain('Defense');
    expect(text).not.toContain('bonus');
  });

  it('sums the bonus of the groups of a city when the pointer is on the icon of the city', () => {
    const text = tipOf(
      [
        group({ id: 'a', mode: 'defense', defense_bonus: 2, defense_cap: 3 }),
        group({ id: 'b', units: 2, charged: 1, mode: 'defense', defense_bonus: 1, defense_cap: 1 }),
      ],
      { node: city },
    );
    expect(text).toContain('Defense: bonus 3 of 4');
  });

  it('calls the bonus of a plan a forecast while the group stands in its city', () => {
    const planned = (location: GroupView['location']) =>
      group({
        location,
        order: { dest: 2, path: [2], planned: true, bonus: 2 },
      });
    expect(tipOf([planned({ kind: 'node', node: city })])).toContain(
      'Plan bonus ◇ +2: a forecast, the number is settled at the departure',
    );
  });

  it('calls it the bonus of the plan once the group is on the road', () => {
    const text = tipOf([
      group({
        location: { kind: 'edge', edge: 0, from_node: city, progress: 300 },
        order: { dest: 2, path: [2], planned: true, bonus: 1 },
      }),
    ]);
    expect(text).toContain('Plan bonus ◇ +1');
    expect(text).not.toContain('forecast');
  });

  it('shows no bonus line for an ordinary order or a plan without a bonus', () => {
    expect(
      tipOf([group({ order: { dest: 2, path: [2], planned: false, bonus: 0 } })]),
    ).not.toContain('Plan bonus');
    expect(
      tipOf([group({ order: { dest: 2, path: [2], planned: true, bonus: 0 } })]),
    ).not.toContain('Plan bonus');
  });
});
