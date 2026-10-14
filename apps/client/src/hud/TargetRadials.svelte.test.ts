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

  function render() {
    const hud = new HudState({
      me: 0,
      nicks: ['Danya', 'Bot'],
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
    mounted.push(
      mount(CityRadial, { target, props: { orders, anchors, building: null } }),
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

  it('the city menu lists recruit and roads with their keys, and recruit sends the command', () => {
    setLocale('en');
    const { target, orders, sent } = render();
    orders.click({ kind: 'node', id: home }, false);
    flushSync();
    const items = [...target.querySelectorAll('[role="menuitem"]')];
    expect(items.map((i) => i.textContent.replace(/\s+/g, ' ').trim())).toEqual([
      expect.stringContaining('Recruit'),
      expect.stringContaining('Roads'),
    ]);
    expect(items[0]?.textContent).toContain('R');
    expect(items[1]?.textContent).toContain('U');
    items[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    flushSync();
    expect(sent).toEqual([{ type: 'recruit', node: home }]);
    expect(target.querySelector('[role="menu"]')).toBeNull();
  });

  it('the group menu dims merge for a lone group and speaks Russian too', () => {
    setLocale('ru');
    const { target, orders, hud } = render();
    orders.click({ kind: 'group', id: group.id }, false);
    flushSync();
    const items = [...target.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')];
    expect(items).toHaveLength(4);
    const merge = items.find((i) => i.textContent.includes('Слить'));
    expect(merge?.getAttribute('aria-disabled')).toBe('true');
    expect(hud.current?.group?.id).toBe(group.id);
  });
});
