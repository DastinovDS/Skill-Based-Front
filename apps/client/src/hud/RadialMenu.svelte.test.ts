import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale } from '../i18n/index.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { OrderBook } from '../match/orderBook.ts';
import { OrderController } from '../match/orderController.ts';
import type { Command } from '../protocol.gen.ts';
import { DEV_RULES, devSnapshot } from './devFeed.ts';
import { HudState } from './hudState.svelte.ts';
import RadialMenu from './RadialMenu.svelte';

const snapshot = devSnapshot(DEFAULT_MAP, DEV_RULES, 30);
const current = snapshot.view.me.stance;

describe('RadialMenu', () => {
  const initial = getLocale();
  let mounted: Record<string, unknown> | undefined;

  afterEach(() => {
    if (mounted !== undefined) void unmount(mounted);
    mounted = undefined;
    setLocale(initial);
    document.body.innerHTML = '';
  });

  function render() {
    const hud = new HudState({
      me: 0,
      nicks: ['Ember', 'Bot'],
      rules: DEV_RULES,
      map: DEFAULT_MAP,
    });
    hud.onSnapshot(snapshot);
    const sent: Command[] = [];
    const orders = new OrderController({
      hud,
      map: DEFAULT_MAP,
      rules: DEV_RULES,
      book: new OrderBook(),
      send: (cmd) => sent.push(cmd),
    });
    const target = document.body.appendChild(document.createElement('div'));
    mounted = mount(RadialMenu, {
      target,
      props: { orders, stance: current },
    });
    return { target, orders, sent };
  }

  it('is not there until opened', () => {
    const { target } = render();
    expect(target.querySelector('[role="menu"]')).toBeNull();
  });

  it('lists the three stances in the fixed order with the numbers of the ruleset', () => {
    setLocale('en');
    const { target, orders } = render();
    orders.openRadial(true);
    flushSync();
    const items = [...target.querySelectorAll('[role="menuitemradio"]')];
    expect(items).toHaveLength(3);
    // The rates as signs (the CP mark, one lozenge, per minute); the words are the accessible name.
    const names = items.map((i) => i.getAttribute('aria-label'));
    expect(names).toEqual([
      'Economy: 3 CP and 18 charges per minute',
      'Balance: 6 CP and 12 charges per minute',
      'War: 9 CP and 6 charges per minute',
    ]);
    expect(items.every((i) => i.querySelector('.cp-mark') !== null)).toBe(true);
    expect(items.every((i) => i.querySelector('.mark.fill') !== null)).toBe(true);
    // An icon in every sector (#350): the shape tells the stance as well as the order does.
    expect(items.map((i) => i.querySelector('.glyph')?.getAttribute('data-icon'))).toEqual([
      'stanceEconomy',
      'stanceBalance',
      'stanceWar',
    ]);
    expect(
      items.every((i) => Number(i.querySelector('.glyph svg')?.getAttribute('width')) >= 20),
    ).toBe(true);
    // No hint lines under the ring.
    expect(target.querySelector('.caption')).toBeNull();
  });

  it('marks the current stance, and the state is told by a lozenge, not only by the frame', () => {
    setLocale('en');
    const { target, orders } = render();
    orders.openRadial(true);
    flushSync();
    const checked = [...target.querySelectorAll('[role="menuitemradio"]')].filter(
      (i) => i.getAttribute('aria-checked') === 'true',
    );
    expect(checked).toHaveLength(1);
    expect(checked[0]?.querySelector('.current-mark')).not.toBeNull();
    expect(target.querySelectorAll('.current-mark')).toHaveLength(1);
  });

  it('sends the stance of a clicked sector and closes', () => {
    setLocale('en');
    const { target, orders, sent } = render();
    orders.openRadial(true);
    flushSync();
    const other = [...target.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
      (i) => i.getAttribute('aria-checked') === 'false',
    );
    other?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    flushSync();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'set_stance' });
    expect(target.querySelector('[role="menu"]')).toBeNull();
  });

  it('follows the pointer to a sector in a held menu', () => {
    setLocale('en');
    const { target, orders } = render();
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 500, clientY: 400 }));
    orders.openRadial(false);
    flushSync();
    // Straight up from the middle: the "balance" sector.
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 500, clientY: 320 }));
    flushSync();
    expect(orders.radial.current.hover).toBe('balance');
    expect(target.querySelector('.sector.hover')?.getAttribute('aria-label')).toContain('Balance');
    // The hovered stance's name in the hub over the ring.
    expect(target.querySelector('.hub')?.textContent).toBe('Balance');
  });
});
