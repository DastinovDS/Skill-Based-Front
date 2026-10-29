import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n/index.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { OrderBook } from '../match/orderBook.ts';
import { OrderController } from '../match/orderController.ts';
import { DEV_RULES, devSnapshot } from './devFeed.ts';
import { HudState } from './hudState.svelte.ts';
import TerrainBanner from './TerrainBanner.svelte';

describe('TerrainBanner: the terrain map mode on T and its legend (#429)', () => {
  let mounted: Record<string, unknown>[] = [];

  afterEach(() => {
    for (const m of mounted) void unmount(m);
    mounted = [];
    document.body.innerHTML = '';
  });

  function render() {
    setLocale('en');
    const hud = new HudState({
      me: 0,
      nicks: ['Danya', 'Bot'],
      rules: DEV_RULES,
      map: DEFAULT_MAP,
    });
    hud.onSnapshot(devSnapshot(DEFAULT_MAP, DEV_RULES, 30));
    const orders = new OrderController({
      hud,
      map: DEFAULT_MAP,
      rules: DEV_RULES,
      book: new OrderBook(),
      send: () => 1,
    });
    const target = document.body.appendChild(document.createElement('div'));
    mounted.push(mount(TerrainBanner, { target, props: { orders } }));
    return { target, orders };
  }

  it('is absent out of the mode and says how to leave in it', () => {
    const { target, orders } = render();
    expect(target.textContent).toBe('');
    orders.key({ type: 'keydown', code: 'KeyT', shiftKey: false });
    flushSync();
    expect(target.textContent).toContain('Terrain map mode [T]');
    expect(target.textContent).toContain('T: leave');
    orders.key({ type: 'keydown', code: 'KeyT', shiftKey: false });
    flushSync();
    expect(target.textContent).toBe('');
  });

  it('shows the vision table of the rules: a row per ground of the group, a cell per ground seen', () => {
    const { target, orders } = render();
    orders.key({ type: 'keydown', code: 'KeyT', shiftKey: false });
    flushSync();
    const rows = [...target.querySelectorAll('tbody tr')].map((row) =>
      [...row.querySelectorAll('td')].map((cell) => cell.textContent.trim()),
    );
    // DEC-21, item 2 (the words of mechanics.md): plains see plains exactly, forest is always a
    // range, mountains see plains exactly and mountains as a range.
    expect(rows).toEqual([
      ['exact', 'range', 'presence'],
      ['range', 'range', 'presence'],
      ['exact', 'range', 'range'],
    ]);
  });

  it('counts the bars: three for exact, two for range, one for presence', () => {
    const { target, orders } = render();
    orders.key({ type: 'keydown', code: 'KeyT', shiftKey: false });
    flushSync();
    const filled = [...target.querySelectorAll('tbody tr')].at(0)?.querySelectorAll('td .bars');
    const counts = [...(filled ?? [])].map((bars) => bars.querySelectorAll('.bar.on').length);
    expect(counts).toEqual([3, 2, 1]);
  });
});
