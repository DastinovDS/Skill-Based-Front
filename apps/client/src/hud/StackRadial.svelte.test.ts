import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale } from '../i18n/index.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { OrderBook } from '../match/orderBook.ts';
import { OrderController } from '../match/orderController.ts';
import type { GroupView, SnapshotMsg } from '../protocol.gen.ts';
import type { MapAnchors } from '../render/anchors.ts';
import { DEV_RULES, devSnapshot } from './devFeed.ts';
import { HudState } from './hudState.svelte.ts';
import StackRadial from './StackRadial.svelte';

const base = devSnapshot(DEFAULT_MAP, DEV_RULES, 30);
const first = base.view.groups[0];
if (first?.location.kind !== 'node') throw new Error('the dev snapshot has no group in a node');
const home = first.location.node;
const second: GroupView = {
  ...first,
  id: 'second-group',
  units: 2,
  charged: 1,
  mode: 'defense',
  order: null,
};
const crowded: SnapshotMsg = {
  ...base,
  view: { ...base.view, groups: [{ ...first, order: null }, second] },
};
const anchors: MapAnchors = {
  node: () => ({ x: 300, y: 300, r: 20 }),
  group: () => ({ x: 300, y: 300, r: 12 }),
};

describe('the list of the groups standing in a city', () => {
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
    hud.onSnapshot(crowded);
    const orders = new OrderController({
      hud,
      map: DEFAULT_MAP,
      rules: DEV_RULES,
      book: new OrderBook(),
      send: () => 1,
    });
    const target = document.body.appendChild(document.createElement('div'));
    mounted.push(mount(StackRadial, { target, props: { orders, anchors } }));
    return { target, orders, hud };
  }

  it('shows nothing until the icon is clicked', () => {
    const { target } = render();
    expect(target.querySelector('[role="menu"]')).toBeNull();
  });

  it('has a sector per group with its units, charges and key, and a click selects the group', () => {
    setLocale('en');
    const { target, orders, hud } = render();
    orders.click({ kind: 'stack', node: home, ids: [first.id, second.id] }, false);
    flushSync();
    const items = [...target.querySelectorAll('[role="menuitem"]')];
    const text = items.map((i) => i.textContent.replace(/\s+/g, ' ').trim());
    expect(text).toHaveLength(2);
    expect(text[0]).toContain(`Units ${String(first.units)}`);
    expect(text[0]).toContain(`charged ${String(first.charged)}`);
    expect(text[1]).toContain('Units 2');
    expect(text[1]).toContain('charged 1');
    // "Defense" is told in words, not by colour.
    expect(text[1]).toContain('Defense');
    expect(text[0]).toContain('1');
    expect(text[1]).toContain('2');
    // The sectors are groups, not actions: none of the 13 icons of the menus fits them (#350).
    expect(target.querySelector('.glyph')).toBeNull();
    items[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    flushSync();
    expect(hud.selection).toEqual({ kind: 'group', id: second.id });
    expect(target.querySelector('[role="menu"]')).toBeNull();
  });
});
