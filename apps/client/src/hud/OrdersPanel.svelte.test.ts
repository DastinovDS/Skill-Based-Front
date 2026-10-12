import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale } from '../i18n/index.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { OrderBook } from '../match/orderBook.ts';
import { OrderController } from '../match/orderController.ts';
import type { Command } from '../protocol.gen.ts';
import { DEV_RULES, devSnapshot } from './devFeed.ts';
import { HudState } from './hudState.svelte.ts';
import OrdersPanel from './OrdersPanel.svelte';

const snapshot = devSnapshot(DEFAULT_MAP, DEV_RULES, 30);
const group = snapshot.view.groups[0];
const enemy = snapshot.view.nodes.find((n) => n.owner === 1 && n.detail === 'exact');
if (group === undefined || enemy === undefined) throw new Error('the dev snapshot is too small');

const button = (target: HTMLElement, label: string) =>
  [...target.querySelectorAll('button')].find((b) => b.textContent.includes(label));

describe('OrdersPanel', () => {
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
      nicks: ['Danya', 'Bot'],
      rules: DEV_RULES,
      map: DEFAULT_MAP,
    });
    hud.onSnapshot(snapshot);
    const book = new OrderBook();
    const sent: Command[] = [];
    const orders = new OrderController({
      hud,
      map: DEFAULT_MAP,
      rules: DEV_RULES,
      book,
      send: (cmd) => sent.push(cmd),
    });
    const target = document.body.appendChild(document.createElement('div'));
    mounted = mount(OrdersPanel, {
      target,
      props: {
        get data() {
          return hud.current;
        },
        orders,
      },
    });
    return { target, orders, book, sent, hud };
  }

  it('shows the prices of an order and of a mode, as the card of ui-style 10.3 does', () => {
    setLocale('en');
    const { target, orders } = render();
    orders.click({ kind: 'group', id: group.id }, false);
    flushSync();
    expect(target.textContent).toContain('Click: order 1 CP. Shift+click: planned 2 CP.');
    expect(button(target, 'Defense')?.textContent).toContain('2 CP');
  });

  it('shows the price of the hovered target and sends a cancel from the button', () => {
    setLocale('en');
    const { target, orders, sent } = render();
    orders.click({ kind: 'group', id: group.id }, false);
    orders.hover({ kind: 'node', id: enemy.id });
    flushSync();
    expect(target.querySelector('.preview')?.textContent).toContain(`node ${String(enemy.id)}`);
    expect(target.querySelector('.preview')?.textContent).toContain(' CP');

    const cancel = [...target.querySelectorAll('button')].find((b) =>
      b.textContent.includes('Cancel order'),
    );
    cancel?.click();
    expect(sent).toEqual([{ type: 'cancel_order', group: group.id }]);
  });

  it('switches planned orders with the checkbox', () => {
    const { target, orders, sent } = render();
    orders.click({ kind: 'group', id: group.id }, false);
    const box = target.querySelector<HTMLInputElement>('input[type="checkbox"]');
    box?.click();
    flushSync();
    expect(orders.ui.current.planned).toBe(true);
    orders.click({ kind: 'node', id: enemy.id }, false);
    expect(sent[0]).toMatchObject({ type: 'move', planned: true });
  });

  it('sends mode, split and recruit from the buttons', () => {
    setLocale('en');
    const { target, orders, sent } = render();
    orders.click({ kind: 'group', id: group.id }, false);
    flushSync();
    button(target, 'Defense')?.click();
    button(target, 'Split off')?.click();
    button(target, 'Recruit here')?.click();
    expect(sent).toEqual([
      { type: 'set_mode', group: group.id, mode: 'defense' },
      { type: 'split', group: group.id, n: 1 },
      { type: 'recruit', node: group.location.kind === 'node' ? group.location.node : -1 },
    ]);
  });

  it('starts the road pick of an own city from its button and sends the picked road', () => {
    setLocale('en');
    const home = group.location.kind === 'node' ? group.location.node : -1;
    const road = DEFAULT_MAP.edges.find((e) => e.a === home || e.b === home);
    if (road === undefined) throw new Error('the home city has no road');
    const { target, orders, sent, hud } = render();
    hud.onSnapshot({
      ...snapshot,
      view: {
        ...snapshot.view,
        edges: snapshot.view.edges.map((e) =>
          e.id === road.id
            ? {
                ...e,
                kind: 'fast' as const,
                width: 2,
                upgrade_gain: { fast: { speed_pct: 50, amount: 0 }, freight: null },
              }
            : e,
        ),
      },
    });
    orders.click({ kind: 'node', id: home }, false);
    flushSync();
    button(target, 'Upgrade a road')?.click();
    flushSync();
    expect(orders.ui.current.roadPick).toBe(home);
    const option = button(target, `Road ${String(road.id)} to node`);
    expect(option?.textContent).toContain('level 3, fast');
    // A typed road keeps its type (DEC-22): the upgrade goes out at once, without a type.
    option?.click();
    expect(sent).toEqual([{ type: 'upgrade_road', node: home, edge: road.id, kind: null }]);
  });

  it('says how long the build of a city takes instead of offering a new one', () => {
    setLocale('en');
    const home = group.location.kind === 'node' ? group.location.node : -1;
    const { target, orders, hud } = render();
    hud.onSnapshot({
      ...snapshot,
      view: {
        ...snapshot.view,
        nodes: snapshot.view.nodes.map((n) =>
          n.id === home ? { ...n, build: { edge: 0, done_tick: snapshot.tick + 100 } } : n,
        ),
      },
    });
    orders.click({ kind: 'node', id: home }, false);
    flushSync();
    expect(button(target, 'Upgrade a road')).toBeUndefined();
    expect(target.textContent).toContain('The city is building road 0: done in 10 s');
  });
});
