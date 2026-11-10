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
  orders: { ...DEV_RULES.orders },
  cost: { ...DEV_RULES.cost },
};
const ctx: HudContext = { me: 0, nicks: ['Ember', 'Bot'], rules: RULES, map: DEFAULT_MAP };
const base = devSnapshot(DEFAULT_MAP, RULES, 100);
const city = base.view.nodes.find((n) => n.owner === 0)?.id ?? 0;

const group = (patch: Partial<GroupView>): GroupView => ({
  id: 'g',
  units: 4,
  charged: 3,
  mode: 'attack',
  location: { kind: 'node', node: city },
  order: null,
  ...patch,
});

/** What the tip says about the group `g` of a snapshot, after the pointer rests on it. */
function tipOf(groups: GroupView[], hover: string | { node: number } = 'g'): string | null {
  const snapshot = { ...base, view: { ...base.view, groups } };
  const hovered = buildHudData(ctx, snapshot, null, [], hover).hovered;
  const canvas = document.body.appendChild(document.createElement('div'));
  canvas.className = 'game-canvas';
  const target = document.body.appendChild(document.createElement('div'));
  mounted.push(mount(GroupTip, { target, props: { group: hovered } }));
  flushSync();
  canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 0 }));
  vi.advanceTimersByTime(400);
  flushSync();
  const tip = target.querySelector('[role="tooltip"]');
  return tip === null ? null : tip.textContent.replace(/\s+/g, ' ').trim();
}

let mounted: Record<string, unknown>[] = [];

describe('GroupTip: the bonus of a plan (DEC-29)', () => {
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

  it('says nothing of the bonus for a group without a plan', () => {
    const text = tipOf([group({})]);
    expect(text).not.toContain('bonus');
  });

  it('calls the bonus of a plan a forecast while the group stands in its city', () => {
    const planned = (location: GroupView['location']) =>
      group({
        location,
        order: {
          dest: 2,
          path: [2],
          planned: true,
          bonus: 2,
          gathering: false,
          plan: 0,
          next_charge_tick: null,
        },
      });
    expect(tipOf([planned({ kind: 'node', node: city })])).toContain(
      'Plan bonus +2: a forecast, the number is settled at the departure',
    );
  });

  it('calls it the bonus of the plan once the group is on the road', () => {
    const text = tipOf([
      group({
        location: { kind: 'edge', edge: 0, from_node: city, progress: 300 },
        order: {
          dest: 2,
          path: [2],
          planned: true,
          bonus: 1,
          gathering: false,
          plan: 0,
          next_charge_tick: null,
        },
      }),
    ]);
    expect(text).toContain('Plan bonus +1');
    expect(text).not.toContain('forecast');
  });

  it('shows no plan block for a group whose plan gathers its bonus: the charges only (#811)', () => {
    const text = tipOf([
      group({
        location: { kind: 'node', node: city },
        order: {
          dest: 2,
          path: [2],
          planned: true,
          bonus: 1,
          gathering: true,
          plan: 2,
          next_charge_tick: 50,
        },
      }),
    ]);
    expect(text).not.toContain('Plan bonus');
    expect(text).not.toContain('Release');
  });

  it('shows no bonus line for an ordinary order or a plan without a bonus', () => {
    expect(
      tipOf([
        group({
          order: {
            dest: 2,
            path: [2],
            planned: false,
            bonus: 0,
            gathering: false,
            plan: 0,
            next_charge_tick: null,
          },
        }),
      ]),
    ).not.toContain('Plan bonus');
    expect(
      tipOf([
        group({
          order: {
            dest: 2,
            path: [2],
            planned: true,
            bonus: 0,
            gathering: false,
            plan: 0,
            next_charge_tick: null,
          },
        }),
      ]),
    ).not.toContain('Plan bonus');
  });
});
