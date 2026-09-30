import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale } from '../i18n/index.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { OrderBook } from '../match/orderBook.ts';
import { OrderController } from '../match/orderController.ts';
import type { Command } from '../protocol.gen.ts';
import { DEV_RULES, devSnapshot } from './devFeed.ts';
import { HudState } from './hudState.svelte.ts';
import SelectionPanel from './SelectionPanel.svelte';

const snapshot = devSnapshot(DEFAULT_MAP, DEV_RULES, 30);
const group = snapshot.view.groups[0];
const enemy = snapshot.view.nodes.find((n) => n.owner === 1 && n.detail === 'exact');
if (group === undefined || enemy === undefined) throw new Error('the dev snapshot is too small');

describe('SelectionPanel ordering', () => {
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
    mounted = mount(SelectionPanel, {
      target,
      props: {
        get data() {
          return hud.current;
        },
        orders,
      },
    });
    return { target, orders, book, sent };
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
});
