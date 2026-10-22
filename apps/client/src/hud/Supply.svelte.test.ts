import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale } from '../i18n/index.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { OrderBook } from '../match/orderBook.ts';
import { OrderController } from '../match/orderController.ts';
import type { Command, RulesetPublic, SnapshotMsg } from '../protocol.gen.ts';
import { DEV_RULES, devSnapshot } from './devFeed.ts';
import { HudState } from './hudState.svelte.ts';
import SupplyBanner from './SupplyBanner.svelte';
import SupplyMenu from './SupplyMenu.svelte';

const base = devSnapshot(DEFAULT_MAP, DEV_RULES, 30);
const city = base.view.nodes.find((n) => n.owner === 0 && n.warehouse_cap !== null)?.id;
if (city === undefined) throw new Error('the dev snapshot has no own city');
const withFronts = (fronts: [number | null, number | null], rear_min = 1): SnapshotMsg => ({
  ...base,
  view: { ...base.view, me: { ...base.view.me, fronts, rear_min } },
});

describe('the «Supply» mode UI (DEC-28)', () => {
  const initial = getLocale();
  let mounted: Record<string, unknown>[] = [];

  afterEach(() => {
    for (const m of mounted) void unmount(m);
    mounted = [];
    setLocale(initial);
    document.body.innerHTML = '';
  });

  function render(snapshot: SnapshotMsg = base, rules: RulesetPublic = DEV_RULES) {
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
    mounted.push(mount(SupplyBanner, { target, props: { orders } }));
    mounted.push(mount(SupplyMenu, { target, props: { orders } }));
    return { target, orders, hud, sent };
  }

  const slider = (target: HTMLElement) =>
    target.querySelector<HTMLInputElement>('input[type="range"]');

  it('the banner and the slider appear with the mode, not before', () => {
    const { target, orders } = render();
    expect(slider(target)).toBeNull();
    orders.toggleSupplyMode();
    flushSync();
    const input = slider(target);
    expect(input?.min).toBe('0');
    expect(input?.max).toBe(String(DEV_RULES.supply.rear_min_max));
    expect(input?.value).toBe('1');
    orders.toggleSupplyMode();
    flushSync();
    expect(slider(target)).toBeNull();
  });

  it('the slider sends set_rear_min when released (a change), not on every step', () => {
    const { target, orders, sent } = render();
    orders.toggleSupplyMode();
    flushSync();
    const input = slider(target);
    if (input === null) throw new Error('no slider');
    input.value = '3';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(sent).toEqual([]);
    expect(target.querySelector('output')?.textContent).toBe('3');
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(sent).toEqual([{ type: 'set_rear_min', n: 3 }]);
  });

  it('shows the value of the server again when a snapshot brings a new one', () => {
    const { target, orders, hud } = render();
    orders.toggleSupplyMode();
    flushSync();
    const input = slider(target);
    if (input === null) throw new Error('no slider');
    input.value = '4';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    hud.onSnapshot(withFronts([null, null], 2));
    flushSync();
    expect(target.querySelector('output')?.textContent).toBe('2');
  });

  it('the menu of a city offers marker 1, marker 2 and the transfer, with their keys', () => {
    setLocale('en');
    const { target, orders } = render();
    orders.toggleSupplyMode();
    orders.click({ kind: 'node', id: city }, false);
    flushSync();
    const items = [...target.querySelectorAll('[role^="menuitem"]')].map((i) =>
      i.textContent.replace(/\s+/g, ' ').trim(),
    );
    expect(items).toHaveLength(3);
    expect(items[0]).toContain('marker 1');
    expect(items[1]).toContain('marker 2');
    expect(items[2]).toContain('transfer');
    // Marker 1 up, marker 2 on the right, the transfer on the left: each with its icon (#350).
    const icons = [...target.querySelectorAll('[role^="menuitem"] .glyph')];
    expect(icons.map((i) => i.getAttribute('data-icon'))).toEqual(['front1', 'front2', 'transfer']);
    expect(icons.every((i) => Number(i.querySelector('svg')?.getAttribute('width')) >= 20)).toBe(
      true,
    );
  });

  it('a marker is free in DEC-28: no price on its sector; a ruleset that prices it shows it', () => {
    setLocale('en');
    const free = render();
    free.orders.toggleSupplyMode();
    free.orders.click({ kind: 'node', id: city }, false);
    flushSync();
    expect(free.target.querySelectorAll('[role^="menuitem"]')[0]?.textContent).not.toContain('CP');

    document.body.innerHTML = '';
    const priced = render(base, { ...DEV_RULES, cost: { ...DEV_RULES.cost, front: 50 } });
    priced.orders.toggleSupplyMode();
    priced.orders.click({ kind: 'node', id: city }, false);
    flushSync();
    expect(priced.target.querySelectorAll('[role^="menuitem"]')[0]?.textContent).toContain(
      '0.5 CP',
    );
  });

  it('a marker that stands on the city offers to take it off, and the other one is off', () => {
    setLocale('en');
    const { target, orders } = render(withFronts([city, null]));
    orders.toggleSupplyMode();
    orders.click({ kind: 'node', id: city }, false);
    flushSync();
    const items = [...target.querySelectorAll('[role^="menuitem"]')];
    expect(items[0]?.textContent).toContain('remove 1');
    expect(items[1]?.getAttribute('aria-disabled')).toBe('true');
  });

  it('a click on a marker sector sends set_front', () => {
    const { target, orders, sent } = render();
    orders.toggleSupplyMode();
    orders.click({ kind: 'node', id: city }, false);
    flushSync();
    const items = [...target.querySelectorAll('[role^="menuitem"]')];
    items[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    flushSync();
    expect(sent).toEqual([{ type: 'set_front', marker: 0, node: city }]);
  });

  it('speaks Russian too', () => {
    setLocale('ru');
    const { target, orders } = render();
    orders.toggleSupplyMode();
    flushSync();
    expect(target.textContent).toContain('Минимум тыла');
    expect(target.textContent).toContain('маркер фронта');
  });
});
