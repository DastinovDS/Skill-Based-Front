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
import type { NodeInfo } from './hudData.ts';
import { HudState } from './hudState.svelte.ts';

const snapshot = devSnapshot(DEFAULT_MAP, DEV_RULES, 600);
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

  function render(
    queue: number | null = 0,
    rules = DEV_RULES,
    built: Pick<NodeInfo, 'hasBarracks' | 'warehouseLevel'> | null = null,
  ) {
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
    // The city the menu knows about: the selected node of the snapshot with the facts over it.
    if (built !== null) hud.select({ kind: 'node', id: home });
    const node = hud.current?.node ?? null;
    const city = built === null || node === null ? node : { ...node, ...built };
    const target = document.body.appendChild(document.createElement('div'));
    mounted.push(
      mount(CityRadial, {
        target,
        props: {
          orders,
          anchors,
          queue,
          city,
        },
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

  const texts = (target: HTMLElement): string[] =>
    [...target.querySelectorAll('[role="menuitem"]')].map((i) =>
      i.textContent.replace(/\s+/g, ' ').trim(),
    );

  it('the city menu has recruit with a glyph and a price only, and recruit sends the command', () => {
    setLocale('en');
    const { target, orders, sent } = render();
    orders.click({ kind: 'node', id: home }, false);
    flushSync();
    const items = [...target.querySelectorAll('[role="menuitem"]')];
    // The glyph, the price and the key: no name, no description. Roads are not here: a click on
    // the road itself raises it (DEC-28, item 7).
    expect(texts(target)).toEqual(['+1 CPR']);
    expect(items.map((i) => i.getAttribute('aria-label'))).toEqual(['Recruit']);
    expect(items[0]?.getAttribute('aria-disabled')).not.toBe('true');
    items[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    flushSync();
    expect(sent).toEqual([{ type: 'recruit', node: home }]);
    expect(target.querySelector('[role="menu"]')).toBeNull();
  });

  it('a sector that cannot be paid or used is off: dashed, never lit, a click does nothing', () => {
    setLocale('en');
    const rules = { ...DEV_RULES, cost: { ...DEV_RULES.cost, recruit: 9_999_900 } };
    const { target, orders, sent } = render(0, rules);
    orders.click({ kind: 'node', id: home }, false);
    flushSync();
    const recruit = target.querySelector('[role="menuitem"]');
    expect(recruit?.getAttribute('aria-disabled')).toBe('true');
    expect(recruit?.classList.contains('disabled')).toBe(true);
    expect(recruit?.getAttribute('tabindex')).toBe('-1');
    recruit?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    flushSync();
    expect(sent).toEqual([]);
    expect(texts(target)[0]).not.toMatch(/[a-z]{3}/); // still no sentence about why
  });

  it('the city menu has no cancel sector: X cancels the last queued unit of the city (DEC-25)', () => {
    setLocale('en');
    const { target, orders, sent } = render(2);
    orders.click({ kind: 'node', id: home }, false);
    flushSync();
    expect(target.querySelector('[aria-label="Cancel recruit"]')).toBeNull();
    orders.key({ type: 'keydown', code: 'KeyX', shiftKey: false });
    flushSync();
    expect(sent).toEqual([{ type: 'cancel_recruit', node: home }]);
    expect(target.querySelector('[role="menu"]')).toBeNull();
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
    expect(items.map((i) => i.getAttribute('aria-label'))).toEqual([
      'Recruit',
      'Barracks',
      'Warehouse',
    ]);
    expect(texts(target).slice(1)).toEqual(['⌂3 CP', '▤2 CP']);
    orders.chooseCity('warehouse');
    expect(sent).toEqual([{ type: 'upgrade_warehouse', node: home }]);
  });

  it('a built barracks and a top-level warehouse leave the city menu (DEC-26)', () => {
    setLocale('en');
    const rules = {
      ...DEV_RULES,
      city_upgrades: { ...DEV_RULES.city_upgrades, enabled: true },
    };
    const labels = (target: HTMLElement): (string | null)[] =>
      [...target.querySelectorAll('[role="menuitem"]')].map((i) => i.getAttribute('aria-label'));
    const top = rules.city_upgrades.warehouse_max_level;

    const barracks = render(0, rules, { hasBarracks: true, warehouseLevel: 0 });
    barracks.orders.click({ kind: 'node', id: home }, false);
    flushSync();
    expect(labels(barracks.target)).toEqual(['Recruit', 'Warehouse']);

    const warehouse = render(0, rules, { hasBarracks: false, warehouseLevel: top });
    warehouse.orders.click({ kind: 'node', id: home }, false);
    flushSync();
    expect(labels(warehouse.target)).toEqual(['Recruit', 'Barracks']);

    const both = render(0, rules, { hasBarracks: true, warehouseLevel: top });
    both.orders.click({ kind: 'node', id: home }, false);
    flushSync();
    expect(labels(both.target)).toEqual(['Recruit']);
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
