import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../i18n/index.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { OrderBook } from '../match/orderBook.ts';
import { OrderController } from '../match/orderController.ts';
import type { RulesetPublic } from '../protocol.gen.ts';
import CaptureTip from './CaptureTip.svelte';
import { DEV_RULES, devSnapshot } from './devFeed.ts';
import { HudState } from './hudState.svelte.ts';

const snapshot = devSnapshot(DEFAULT_MAP, DEV_RULES, 30);
const PAID: RulesetPublic = { ...DEV_RULES, capture: { charge_cost: 1 } };
const FREE: RulesetPublic = { ...DEV_RULES, capture: { charge_cost: 0 } };

describe('CaptureTip: the price of a capture on a target (DEC-38, #580)', () => {
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

  function setup(rules: RulesetPublic) {
    const hud = new HudState({ me: 0, nicks: ['Danya', 'Bot'], rules, map: DEFAULT_MAP });
    hud.onSnapshot(snapshot);
    const group = snapshot.view.groups.find((g) => g.location.kind === 'node');
    const home = group?.location.kind === 'node' ? group.location.node : null;
    const foreign = snapshot.view.nodes.find((n) => n.id !== home && n.owner !== 0);
    const own = snapshot.view.nodes.find((n) => n.id !== home && n.owner === 0);
    if (group === undefined || home === null || foreign === undefined || own === undefined) {
      throw new Error('the dev snapshot lacks a group, a foreign node or a second own node');
    }
    const sent: unknown[] = [];
    const orders = new OrderController({
      hud,
      map: DEFAULT_MAP,
      rules,
      book: new OrderBook(),
      send: (cmd) => sent.push(cmd),
      queryReach: () => undefined,
    });
    orders.click({ kind: 'group', id: group.id }, false);
    orders.overlay();
    return { orders, hud, foreign: foreign.id, own: own.id, sent };
  }

  function show(orders: OrderController, hud: HudState, cost: number) {
    const canvas = document.body.appendChild(document.createElement('div'));
    canvas.className = 'game-canvas';
    const root = document.body.appendChild(document.createElement('div'));
    mounted.push(mount(CaptureTip, { target: root, props: { orders, names: hud.nodeName, cost } }));
    flushSync();
    canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 0 }));
    vi.advanceTimersByTime(400);
    flushSync();
    return root;
  }

  it('tells the rule on a target the player does not own, with the number of the ruleset', () => {
    const { orders, hud, foreign, sent } = setup(PAID);
    orders.hover({ kind: 'node', id: foreign });
    orders.overlay();
    expect(orders.ui.current.captureHover).toBe(foreign);
    const root = show(orders, hud, 1);
    const tip = root.querySelector('[role="tooltip"]');
    expect(tip?.textContent.replace(/\s+/g, ' ').trim()).toBe(
      `Taking ${hud.nodeName(foreign)} costs charges: 1. Without them the group turns back`,
    );
    // A shape too, not the colour alone: the flag icon.
    expect(tip?.querySelector('svg')).not.toBeNull();
    expect(sent).toEqual([]);
  });

  it('is silent on an own node, without a hover and when a capture is free', () => {
    const paid = setup(PAID);
    paid.orders.hover({ kind: 'node', id: paid.own });
    paid.orders.overlay();
    expect(paid.orders.ui.current.captureHover).toBeNull();
    paid.orders.hover(null);
    paid.orders.overlay();
    expect(paid.orders.ui.current.captureHover).toBeNull();
    const free = setup(FREE);
    free.orders.hover({ kind: 'node', id: free.foreign });
    free.orders.overlay();
    expect(free.orders.ui.current.captureHover).toBeNull();
    expect(show(free.orders, free.hud, 0).querySelector('[role="tooltip"]')).toBeNull();
  });
});
