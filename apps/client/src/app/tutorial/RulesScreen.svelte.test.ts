import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEV_RULES } from '../../hud/devFeed.ts';
import { setLocale } from '../../i18n/index.ts';
import type { RulesetPublic } from '../../protocol.gen.ts';
import RulesScreen from './RulesScreen.svelte';

// The rules reference (#806, docs/design/tutorial.md section 6) on `GET /api/ruleset`: the numbers of
// the main ruleset mvp-7 as the server sends them (no map tempo), the expected words from section 6.
const MVP7: RulesetPublic = {
  ...DEV_RULES,
  tick_hz: 10,
  match_ticks: 9000,
  cp: { cap: 500, per_period: 50 },
  stances: {
    cp_period_ticks: { economy: 100, balance: 50, war: 40 },
    capital_period_ticks: { economy: 100, balance: 200, war: 400 },
    factories_follow: true,
  },
  combat: { ...DEV_RULES.combat, round_ticks: 20, retreat: 'none' },
  orders: { plan_ticks_per_bonus: 30 },
  victory: { vp_period_ticks: 300 },
  fort: { cost: 150, build_ticks: 100, toll_units: 3, toll_charges: 1 },
  recruit: { ...DEV_RULES.recruit, rally_point: true, rally_cost: 50 },
  group_order: { max_groups: 16, rally_pct: 50 },
};

describe('RulesScreen', () => {
  let mounted: Record<string, unknown>[] = [];

  afterEach(() => {
    for (const m of mounted) void unmount(m);
    mounted = [];
    document.body.innerHTML = '';
  });

  async function open(load: () => Promise<RulesetPublic>, onback = () => undefined) {
    setLocale('en');
    const target = document.body.appendChild(document.createElement('div'));
    mounted.push(
      mount(RulesScreen, {
        target,
        props: { nick: 'Ember', hasPassword: false, map: null, load, onprofile: vi.fn(), onback },
      }),
    );
    flushSync();
    await Promise.resolve();
    await Promise.resolve();
    flushSync();
    return target;
  }

  function section(target: HTMLElement, title: string): string {
    const head = [...target.querySelectorAll('h3')].find((h) => h.textContent === title);
    return head?.nextElementSibling?.textContent ?? '';
  }

  it('reads the endpoint and quotes the numbers a player looks up', async () => {
    const load = vi.fn(() => Promise.resolve(MVP7));
    const target = await open(load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(target.querySelector('h2')?.textContent).toBe('Rules');
    const titles = [...target.querySelectorAll('h3')].map((h) => h.textContent);
    expect(titles).toEqual([
      'Units and charges',
      'Capture and capacity',
      'Vision and speed',
      'CP and supply',
      'Supply in detail',
      'Buildings and stances',
      'Fights and planned orders',
      'Winning',
      'Terrain and forts',
      'Group orders and rally points',
      'Capacity and attrition',
      'Bigger maps are faster',
      'Also',
    ]);
    const nb = ' ';
    expect(section(target, 'CP and supply')).toContain(
      `CP come 0.5 every 5${nb}s, up to 5, and your capital makes a charge every 20${nb}s.`,
    );
    expect(section(target, 'Fights and planned orders')).toContain(`one every 2${nb}s`);
    expect(section(target, 'Fights and planned orders')).toContain('No retreat.');
    expect(section(target, 'Fights and planned orders')).toContain(`a bonus shot every 3${nb}s`);
    expect(section(target, 'Winning')).toContain(
      `every 30${nb}s your cities score VP, and the most VP after 15${nb}minutes wins.`,
    );
    expect(section(target, 'Terrain and forts')).toContain(
      `takes 1${nb}charge for every 3${nb}units, rounded up`,
    );
    expect(section(target, 'Group orders and rally points')).toContain(`0.5${nb}CP a walk`);
  });

  it('leaves out what the ruleset does not have', async () => {
    const target = await open(() =>
      Promise.resolve({
        ...MVP7,
        combat: { ...MVP7.combat, retreat: 'round' },
        group_order: null,
        recruit: { ...MVP7.recruit, rally_point: false, rally_cost: 0 },
      }),
    );
    expect(section(target, 'Fights and planned orders')).not.toContain('No retreat');
    expect(target.textContent).not.toContain('Group orders and rally points');
  });

  it('says when the rules cannot be read, and tries again', async () => {
    const load = vi
      .fn<() => Promise<RulesetPublic>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(MVP7);
    const target = await open(load);
    expect(target.querySelector('[role="alert"]')?.textContent).toContain(
      'The rules could not be loaded.',
    );
    const retry = [...target.querySelectorAll('button')].find((b) => b.textContent === 'Try again');
    retry?.click();
    await Promise.resolve();
    await Promise.resolve();
    flushSync();
    expect(target.querySelectorAll('h3')).toHaveLength(13);
  });

  it('"Back to chapters" and Esc go back', async () => {
    const onback = vi.fn();
    const target = await open(() => Promise.resolve(MVP7), onback);
    [...target.querySelectorAll('button')]
      .find((b) => b.textContent === 'Back to chapters')
      ?.click();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onback).toHaveBeenCalledTimes(2);
  });
});
