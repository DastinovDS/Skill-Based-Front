import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale } from '../i18n/index.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { OrderBook } from '../match/orderBook.ts';
import { OrderController } from '../match/orderController.ts';
import type { MapAnchors } from '../render/anchors.ts';
import { DEV_RULES, devSnapshot } from './devFeed.ts';
import GroupRadial from './GroupRadial.svelte';
import type { GroupInfo } from './hudData.ts';
import { HudState } from './hudState.svelte.ts';

// The owner's marks on the pop-up catalogue (#765): a group on a road (B9) or waiting to depart
// (B10) is told by its menu, not by a refusal toast: split and merge dim, the cancel stays lit.
const snapshot = devSnapshot(DEFAULT_MAP, DEV_RULES, 600);
const first = snapshot.view.groups[0];
if (first?.location.kind !== 'node') throw new Error('the dev snapshot has no group in a node');
const anchors: MapAnchors = {
  node: () => ({ x: 300, y: 300, r: 20 }),
  group: () => ({ x: 300, y: 340, r: 12 }),
};

describe('the group menu of a group with an order (#765, B9, B10)', () => {
  const initial = getLocale();
  let mounted: Record<string, unknown> | undefined;

  afterEach(() => {
    if (mounted !== undefined) void unmount(mounted);
    mounted = undefined;
    setLocale(initial);
    document.body.innerHTML = '';
  });

  /** The menu open on the dev group, drawn for `patch` of its facts (a road, an order). */
  function menu(patch: Partial<GroupInfo>, mergeable = 2): Map<string, boolean> {
    setLocale('en');
    const hud = new HudState({
      me: 0,
      nicks: ['Ember', 'Bot'],
      rules: DEV_RULES,
      map: DEFAULT_MAP,
    });
    hud.onSnapshot(snapshot);
    const orders = new OrderController({
      hud,
      map: DEFAULT_MAP,
      rules: DEV_RULES,
      book: new OrderBook(),
      send: () => 0,
    });
    orders.click({ kind: 'group', id: first?.id ?? '' }, false);
    const base = hud.current?.group;
    if (base == null) throw new Error('the group is not selected');
    orders.click({ kind: 'group', id: base.id }, false); // the second click opens the menu
    const group: GroupInfo = { ...base, units: Math.max(2, base.units), ...patch };
    const target = document.body.appendChild(document.createElement('div'));
    mounted = mount(GroupRadial, { target, props: { orders, anchors, group, mergeable } });
    flushSync();
    const items = [...target.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')];
    expect(items.length).toBeGreaterThan(0);
    return new Map(
      items.map((i) => [
        i.getAttribute('aria-label') ?? '',
        i.getAttribute('aria-disabled') === 'true',
      ]),
    );
  }

  it('offers split and merge to a group standing without an order', () => {
    const off = menu({ destination: null, planned: false });
    expect(off.get('Split')).toBe(false);
    expect(off.get('Cancel')).toBe(true);
  });

  it('dims split on a group on a road; its cancel stays (B9)', () => {
    const off = menu({ node: null, destination: 3, progress: 400 }, 0);
    expect(off.get('Split')).toBe(true);
    expect(off.get('Merge')).toBe(true);
    expect(off.get('Cancel')).toBe(false);
  });

  it('dims split on a group waiting to depart; its cancel is the lit choice (B10)', () => {
    const off = menu({ destination: 3, planned: true });
    expect(off.get('Split')).toBe(true);
    expect(off.get('Cancel')).toBe(false);
  });
});
