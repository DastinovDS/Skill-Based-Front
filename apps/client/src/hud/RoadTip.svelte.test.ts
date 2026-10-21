import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../i18n/index.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { OrderBook } from '../match/orderBook.ts';
import { OrderController } from '../match/orderController.ts';
import type { RulesetPublic } from '../protocol.gen.ts';
import { DEV_RULES, devSnapshot } from './devFeed.ts';
import { HudState } from './hudState.svelte.ts';
import RoadTip from './RoadTip.svelte';

// The price and the time of a level come from `ruleset_public`; the gain from the snapshot.
const RULES: RulesetPublic = {
  ...DEV_RULES,
  cost: { ...DEV_RULES.cost, build: 70 },
  build: { ticks_per_level: 150 },
};
const base = devSnapshot(DEFAULT_MAP, RULES, 30);
const gain = { speed_pct: 50, unit_speed_pct: 15, amount: 1 };
const snapshot = {
  ...base,
  view: {
    ...base.view,
    edges: base.view.edges.map((e) =>
      e.id === 0 ? { ...e, width: 1, upgrade_gain: gain, build: null } : e,
    ),
  },
};

describe('RoadTip: what a click on an own road gives', () => {
  let mounted: Record<string, unknown>[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    for (const m of mounted) void unmount(m);
    mounted = [];
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('shows the next level, the gain, the price and the time of the ruleset after a rest', () => {
    setLocale('en');
    const hud = new HudState({ me: 0, nicks: ['Danya', 'Bot'], rules: RULES, map: DEFAULT_MAP });
    hud.onSnapshot(snapshot);
    const orders = new OrderController({
      hud,
      map: DEFAULT_MAP,
      rules: RULES,
      book: new OrderBook(),
      send: () => 1,
    });
    const canvas = document.body.appendChild(document.createElement('div'));
    canvas.className = 'game-canvas';
    const target = document.body.appendChild(document.createElement('div'));
    orders.hover({ kind: 'edge', id: 0 });
    const road = hud.current?.roads[0] ?? null;
    mounted.push(mount(RoadTip, { target, props: { orders, road } }));
    flushSync();
    canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 0 }));
    expect(target.querySelector('[role="tooltip"]')).toBeNull();
    vi.advanceTimersByTime(400);
    flushSync();
    const text = target.querySelector('[role="tooltip"]')?.textContent.replace(/\s+/g, ' ').trim();
    // 70 hundredths of CP is 0.7 CP; 150 ticks at 10 a second is 15 s.
    expect(text).toBe('Road: level 1 → 2 units +15%, supply +1 0.7 CP, 15 s');
  });

  it('shows nothing without a road', () => {
    const hud = new HudState({ me: 0, nicks: ['Danya', 'Bot'], rules: RULES, map: DEFAULT_MAP });
    const orders = new OrderController({
      hud,
      map: DEFAULT_MAP,
      rules: RULES,
      book: new OrderBook(),
      send: () => 1,
    });
    const target = document.body.appendChild(document.createElement('div'));
    mounted.push(mount(RoadTip, { target, props: { orders, road: null } }));
    vi.advanceTimersByTime(400);
    flushSync();
    expect(target.querySelector('[role="tooltip"]')).toBeNull();
  });
});
