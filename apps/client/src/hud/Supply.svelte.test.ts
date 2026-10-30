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
    mounted.push(mount(SupplyBanner, { target, props: { orders, names: hud.nodeName } }));
    mounted.push(mount(SupplyMenu, { target, props: { orders, names: hud.nodeName } }));
    return { target, orders, hud, sent };
  }

  const stepper = (target: HTMLElement) => ({
    less: target.querySelector<HTMLButtonElement>('button[aria-label="Lower rear minimum"]'),
    more: target.querySelector<HTMLButtonElement>('button[aria-label="Raise rear minimum"]'),
    value: target.querySelector('output')?.textContent ?? null,
  });

  it('the pill and its rear minimum stepper appear with the mode, not before (S3, #627)', () => {
    setLocale('en');
    const { target, orders } = render();
    expect(target.querySelector('.supply')).toBeNull();
    orders.toggleSupplyMode();
    flushSync();
    const pill = target.querySelector('.supply');
    expect(pill?.textContent).toContain('Supply');
    expect(pill?.textContent).toContain('Tab');
    expect(stepper(target).value).toBe('1');
    // No hint, no legend and no slider any more: the pill is the whole panel.
    expect(target.querySelector('input[type="range"]')).toBeNull();
    expect(target.querySelector('ul')).toBeNull();
    orders.toggleSupplyMode();
    flushSync();
    expect(target.querySelector('.supply')).toBeNull();
  });

  it('minus and plus send one step of set_rear_min each, like the [ and ] keys', () => {
    setLocale('en');
    const { target, orders, sent } = render();
    orders.toggleSupplyMode();
    flushSync();
    stepper(target).more?.click();
    expect(sent).toEqual([{ type: 'set_rear_min', n: 2 }]);
    // Two quick presses before the snapshot are two steps (stepRearMin).
    stepper(target).more?.click();
    expect(sent.at(-1)).toEqual({ type: 'set_rear_min', n: 3 });
  });

  it('shows the value of the server and turns a button off at its end', () => {
    setLocale('en');
    const { target, orders, hud } = render();
    orders.toggleSupplyMode();
    flushSync();
    hud.onSnapshot(withFronts([null, null], 0));
    flushSync();
    expect(stepper(target).value).toBe('0');
    expect(stepper(target).less?.disabled).toBe(true);
    expect(stepper(target).more?.disabled).toBe(false);
    hud.onSnapshot(withFronts([null, null], DEV_RULES.supply.rear_min_max));
    flushSync();
    expect(stepper(target).value).toBe(String(DEV_RULES.supply.rear_min_max));
    expect(stepper(target).more?.disabled).toBe(true);
  });

  it('a transfer pick adds one line with the source city, only while picking', () => {
    setLocale('en');
    const { target, orders } = render();
    orders.toggleSupplyMode();
    flushSync();
    expect(target.querySelector('.pick')).toBeNull();
    orders.ui.patch({ transferFrom: city });
    flushSync();
    expect(target.querySelector('.pick')?.textContent).toContain('pick a destination');
    orders.cancelTransferPick();
    flushSync();
    expect(target.querySelector('.pick')).toBeNull();
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
});
