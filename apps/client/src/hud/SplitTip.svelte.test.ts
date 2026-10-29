import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../i18n/index.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { OrderBook } from '../match/orderBook.ts';
import { OrderController } from '../match/orderController.ts';
import { DEV_RULES, devSnapshot } from './devFeed.ts';
import { HudState } from './hudState.svelte.ts';
import SplitTip from './SplitTip.svelte';

const snapshot = devSnapshot(DEFAULT_MAP, DEV_RULES, 30);

describe('SplitTip: the stack limit before the order is sent (#468)', () => {
  let mounted: Record<string, unknown>[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    setLocale('en');
  });
  afterEach(() => {
    for (const m of mounted) void unmount(m);
    mounted = [];
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  function setup() {
    const hud = new HudState({
      me: 0,
      nicks: ['Danya', 'Bot'],
      rules: DEV_RULES,
      map: DEFAULT_MAP,
    });
    hud.onSnapshot(snapshot);
    const group = snapshot.view.groups.find((g) => g.location.kind === 'node');
    const home = group?.location.kind === 'node' ? group.location.node : null;
    const target = DEFAULT_MAP.nodes.find((n) => n.id !== home && n.kind !== 'province');
    if (group === undefined || home === null || target === undefined) throw new Error('no group');
    const sent: unknown[] = [];
    const orders = new OrderController({
      hud,
      map: DEFAULT_MAP,
      rules: DEV_RULES,
      book: new OrderBook(),
      send: (cmd) => sent.push(cmd),
      queryReach: () => undefined,
    });
    orders.click({ kind: 'group', id: group.id }, false);
    orders.overlay();
    orders.onReach({ type: 'reach', group: group.id, tick: 30, nodes: [], split: [target.id] });
    return { orders, hud, target, sent };
  }

  function show(orders: OrderController, hud: HudState) {
    const canvas = document.body.appendChild(document.createElement('div'));
    canvas.className = 'game-canvas';
    const root = document.body.appendChild(document.createElement('div'));
    mounted.push(mount(SplitTip, { target: root, props: { orders, names: hud.nodeName } }));
    flushSync();
    canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 0 }));
    vi.advanceTimersByTime(400);
    flushSync();
    return root;
  }

  it('says the group is too big for the hovered place and points at S', () => {
    const { orders, hud, target } = setup();
    orders.hover({ kind: 'node', id: target.id });
    orders.overlay();
    const root = show(orders, hud);
    const tip = root.querySelector('[role="tooltip"]');
    const text = tip?.textContent.replace(/\s+/g, ' ').trim();
    expect(text).toBe(`Too big to go to ${hud.nodeName(target.id)}: split the group first (S)`);
    // A shape too, not the colour alone: the split icon.
    expect(tip?.querySelector('svg')).not.toBeNull();
  });

  it('shows nothing for a target the group fits to, and sends nothing', () => {
    const { orders, hud, sent } = setup();
    orders.hover(null);
    orders.overlay();
    const root = show(orders, hud);
    expect(root.querySelector('[role="tooltip"]')).toBeNull();
    expect(sent).toEqual([]);
  });
});
