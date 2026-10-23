import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n/index.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { OrderBook } from '../match/orderBook.ts';
import { OrderController } from '../match/orderController.ts';
import { DEV_RULES, devSnapshot } from './devFeed.ts';
import { HudState } from './hudState.svelte.ts';
import RoadBanner from './RoadBanner.svelte';

const base = devSnapshot(DEFAULT_MAP, DEV_RULES, 30);
const gain = { speed_pct: 50, unit_speed_pct: 15, amount: 1 };

describe('RoadBanner: the road mode on U says it is on and how to leave (#315)', () => {
  let mounted: Record<string, unknown>[] = [];

  afterEach(() => {
    for (const m of mounted) void unmount(m);
    mounted = [];
    document.body.innerHTML = '';
  });

  function render(upgradable: boolean) {
    const hud = new HudState({
      me: 0,
      nicks: ['Danya', 'Bot'],
      rules: DEV_RULES,
      map: DEFAULT_MAP,
    });
    hud.onSnapshot({
      ...base,
      view: {
        ...base.view,
        edges: base.view.edges.map((e) => ({
          ...e,
          upgrade_gain: upgradable && e.id === 0 ? gain : null,
          build: null,
        })),
      },
    });
    const orders = new OrderController({
      hud,
      map: DEFAULT_MAP,
      rules: DEV_RULES,
      book: new OrderBook(),
      send: () => 1,
    });
    const target = document.body.appendChild(document.createElement('div'));
    mounted.push(mount(RoadBanner, { target, props: { orders } }));
    return { target, orders };
  }

  it('is absent out of the mode and shows the keys to leave in it', () => {
    setLocale('en');
    const { target, orders } = render(true);
    expect(target.textContent).toBe('');
    orders.key({ type: 'keydown', code: 'KeyU', shiftKey: false });
    flushSync();
    expect(target.textContent.replace(/\s+/g, ' ').trim()).toBe(
      'Road upgrade mode [U] Click a lit road to upgrade it for CP. U or Esc: leave',
    );
    orders.key({ type: 'keydown', code: 'Escape', shiftKey: false });
    flushSync();
    expect(target.textContent).toBe('');
    setLocale('en');
  });

  it('says so when no road can be upgraded now', () => {
    setLocale('en');
    const { target, orders } = render(false);
    orders.key({ type: 'keydown', code: 'KeyU', shiftKey: false });
    flushSync();
    expect(target.textContent).toContain('Nothing to upgrade now');
  });
});
