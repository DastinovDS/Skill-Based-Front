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
    const hud = new HudState({ me: 0, rules: DEV_RULES, map: DEFAULT_MAP });
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

  it.each([
    ['en', 'Not enough CP'],
    ['ru', 'Не хватает CP'],
  ] as const)('explains a rejection in %s', (locale, text) => {
    setLocale(locale);
    const { target, orders, book } = render();
    orders.click({ kind: 'group', id: group.id }, false);
    orders.click({ kind: 'node', id: enemy.id }, false);
    book.onAck({
      type: 'ack',
      seq: 1,
      applied_tick: 31,
      path: null,
      reject_code: 'NOT_ENOUGH_CP',
    });
    flushSync();
    expect(target.querySelector('[role="alert"]')?.textContent).toContain(text);
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

  const button = (target: HTMLElement, label: string) =>
    [...target.querySelectorAll('button')].find((b) => b.textContent.includes(label));

  it('sends mode, split, stance and recruit from the buttons', () => {
    setLocale('en');
    const { target, orders, sent } = render();
    orders.click({ kind: 'group', id: group.id }, false);
    flushSync();
    button(target, 'Defense')?.click();
    button(target, 'Split off')?.click();
    button(target, 'War')?.click();
    button(target, 'Recruit here')?.click();
    expect(sent).toEqual([
      { type: 'set_mode', group: group.id, mode: 'defense' },
      { type: 'split', group: group.id, n: 1 },
      { type: 'set_stance', stance: 'war' },
      { type: 'recruit', node: group.location.kind === 'node' ? group.location.node : -1 },
    ]);
  });

  it('asks before forfeiting and sends it only after the confirmation', () => {
    setLocale('en');
    const { target, sent } = render();
    button(target, 'Forfeit')?.click();
    flushSync();
    expect(sent).toEqual([]);
    button(target, 'Keep playing')?.click();
    flushSync();
    expect(button(target, 'Yes, forfeit')).toBeUndefined();
    button(target, 'Forfeit')?.click();
    flushSync();
    button(target, 'Yes, forfeit')?.click();
    expect(sent).toEqual([{ type: 'forfeit' }]);
  });

  it('shows the accepted answer of a command', () => {
    setLocale('en');
    const { target, orders, book } = render();
    orders.click({ kind: 'group', id: group.id }, false);
    orders.setMode('defense');
    book.onAck({ type: 'ack', seq: 1, applied_tick: 31, path: null, reject_code: null });
    flushSync();
    expect(target.querySelector('[role="alert"]')?.textContent).toContain('Accepted: mode change');
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
            ? { ...e, upgrade_gain: { capacity_centi: 50, packet_speed_pct: 10 } }
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
    expect(option?.textContent).toContain('+0.5 capacity');
    option?.click();
    expect(sent).toEqual([{ type: 'upgrade_road', node: home, edge: road.id }]);
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
