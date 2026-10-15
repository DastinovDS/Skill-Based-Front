import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale } from '../i18n/index.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { OrderBook } from '../match/orderBook.ts';
import { OrderController } from '../match/orderController.ts';
import type { Command } from '../protocol.gen.ts';
import type { MapAnchors } from '../render/anchors.ts';
import CityRadial from './CityRadial.svelte';
import { DEV_RULES, devSnapshot } from './devFeed.ts';
import GroupRadial from './GroupRadial.svelte';
import { HudState } from './hudState.svelte.ts';

const snapshot = devSnapshot(DEFAULT_MAP, DEV_RULES, 30);
const group = snapshot.view.groups[0];
if (group?.location.kind !== 'node') throw new Error('the dev snapshot has no group in a node');
const home = group.location.node;
const anchors: MapAnchors = {
  node: () => ({ x: 300, y: 300, r: 20 }),
  group: () => ({ x: 300, y: 340, r: 12 }),
};

describe('the radial menus of a city and of a group', () => {
  const initial = getLocale();
  let mounted: Record<string, unknown>[] = [];

  afterEach(() => {
    for (const m of mounted) void unmount(m);
    mounted = [];
    setLocale(initial);
    document.body.innerHTML = '';
  });

  function render(queue: number | null = 0, rules = DEV_RULES) {
    const hud = new HudState({
      me: 0,
      nicks: ['Danya', 'Bot'],
      rules,
      map: DEFAULT_MAP,
    });
    hud.onSnapshot(snapshot);
    const sent: Command[] = [];
    const orders = new OrderController({
      hud,
      map: DEFAULT_MAP,
      rules,
      book: new OrderBook(),
      send: (cmd) => sent.push(cmd),
    });
    const target = document.body.appendChild(document.createElement('div'));
    mounted.push(
      mount(CityRadial, {
        target,
        props: { orders, anchors, building: null, queue, city: hud.current?.node ?? null },
      }),
      mount(GroupRadial, {
        target,
        props: { orders, anchors, group: hud.current?.group ?? null, mergeable: 1 },
      }),
    );
    return { target, orders, sent, hud };
  }

  it('shows nothing until a city or a group is clicked', () => {
    const { target } = render();
    expect(target.querySelector('[role="menu"]')).toBeNull();
  });

  it('the city menu lists recruit, cancel and roads, and recruit sends the command', () => {
    setLocale('en');
    const { target, orders, sent } = render();
    orders.click({ kind: 'node', id: home }, false);
    flushSync();
    const items = [...target.querySelectorAll('[role="menuitem"]')];
    expect(items.map((i) => i.textContent.replace(/\s+/g, ' ').trim())).toEqual([
      expect.stringContaining('Recruit'),
      expect.stringContaining('Cancel recruit'),
      expect.stringContaining('Roads'),
    ]);
    expect(items[0]?.textContent).toContain('R');
    expect(items[0]?.textContent).toContain('0 of 3 queued');
    expect(items[1]?.getAttribute('aria-disabled')).toBe('true'); // nothing queued
    expect(items[2]?.textContent).toContain('U');
    items[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    flushSync();
    expect(sent).toEqual([{ type: 'recruit', node: home }]);
    expect(target.querySelector('[role="menu"]')).toBeNull();
  });

  it('the city menu cancels the last queued unit (DEC-25)', () => {
    setLocale('en');
    const { target, orders, sent } = render(2);
    orders.click({ kind: 'node', id: home }, false);
    flushSync();
    const cancel = [...target.querySelectorAll('[role="menuitem"]')][1];
    expect(cancel?.getAttribute('aria-disabled')).not.toBe('true');
    expect(cancel?.textContent).toContain('returns 1 CP, started 0.5');
    cancel?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    flushSync();
    expect(sent).toEqual([{ type: 'cancel_recruit', node: home }]);
  });

  it('with city upgrades the menu builds the barracks and the warehouse (DEC-26)', () => {
    setLocale('en');
    const rules = {
      ...DEV_RULES,
      city_upgrades: { ...DEV_RULES.city_upgrades, enabled: true },
    };
    const { target, orders, sent } = render(0, rules);
    orders.click({ kind: 'node', id: home }, false);
    flushSync();
    const items = [...target.querySelectorAll('[role="menuitem"]')];
    expect(items.map((i) => i.textContent.replace(/\s+/g, ' ').trim())).toEqual([
      expect.stringContaining('Recruit'),
      expect.stringContaining('Cancel recruit'),
      expect.stringContaining('Roads'),
      expect.stringContaining('Barracks'),
      expect.stringContaining('Warehouse'),
    ]);
    orders.chooseCity('warehouse');
    expect(sent).toEqual([{ type: 'upgrade_warehouse', node: home }]);
  });

  it('the group menu dims merge for a lone group and speaks Russian too', () => {
    setLocale('ru');
    const { target, orders, hud } = render();
    orders.click({ kind: 'group', id: group.id }, false);
    orders.click({ kind: 'group', id: group.id }, false); // the second click opens the menu
    flushSync();
    const items = [...target.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')];
    expect(items).toHaveLength(4);
    const merge = items.find((i) => i.textContent.includes('Слить'));
    expect(merge?.getAttribute('aria-disabled')).toBe('true');
    expect(hud.current?.group?.id).toBe(group.id);
  });
});
