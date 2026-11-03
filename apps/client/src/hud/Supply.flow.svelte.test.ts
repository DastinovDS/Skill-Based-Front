import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale } from '../i18n/index.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { OrderBook } from '../match/orderBook.ts';
import { OrderController } from '../match/orderController.ts';
import type { Command, SnapshotMsg } from '../protocol.gen.ts';
import { DEV_RULES_FLOW, devSnapshot } from './devFeed.ts';
import { HudState } from './hudState.svelte.ts';
import SupplyBanner from './SupplyBanner.svelte';

// The Supply panel under the supply flow (DEC-43, #705): `Supply − level +` bound to set_leaf_shift,
// the value in the HUD while it is not "front", and none of the lines UI.
const base = devSnapshot(DEFAULT_MAP, DEV_RULES_FLOW, 30);
const withShift = (shift: number, max = 3): SnapshotMsg => ({
  ...base,
  view: { ...base.view, me: { ...base.view.me, leaf_shift: shift, leaf_shift_max: max } },
});

describe('the leaf shift control', () => {
  const initial = getLocale();
  let mounted: Record<string, unknown>[] = [];

  afterEach(() => {
    for (const m of mounted) void unmount(m);
    mounted = [];
    setLocale(initial);
    document.body.innerHTML = '';
  });

  function render(snapshot: SnapshotMsg = withShift(0)) {
    const hud = new HudState({
      me: 0,
      nicks: ['Danya', 'Bot'],
      rules: DEV_RULES_FLOW,
      map: DEFAULT_MAP,
    });
    hud.onSnapshot(snapshot);
    const sent: Command[] = [];
    const orders = new OrderController({
      hud,
      map: DEFAULT_MAP,
      rules: DEV_RULES_FLOW,
      book: new OrderBook(),
      send: (cmd) => sent.push(cmd),
    });
    const target = document.body.appendChild(document.createElement('div'));
    mounted.push(mount(SupplyBanner, { target, props: { orders, names: hud.nodeName } }));
    return { target, orders, hud, sent };
  }

  const buttons = (target: HTMLElement) => ({
    back: target.querySelector<HTMLButtonElement>(
      'button[aria-label^="Move the supply level one road back"]',
    ),
    forward: target.querySelector<HTMLButtonElement>(
      'button[aria-label^="Move the supply level one road forward"]',
    ),
    value: target.querySelector('output')?.textContent ?? null,
  });

  it('shows "front" with the mode, minus on, plus off at the front', () => {
    setLocale('en');
    const { target, orders } = render();
    expect(target.querySelector('.supply')).toBeNull();
    orders.toggleSupplyMode();
    flushSync();
    const pill = target.querySelector('.supply');
    expect(pill?.textContent).toContain('Supply');
    expect(buttons(target).value).toBe('front');
    expect(buttons(target).back?.disabled).toBe(false);
    expect(buttons(target).forward?.disabled).toBe(true);
  });

  it('minus sends the next shift, plus the previous one', () => {
    setLocale('en');
    const { target, orders, sent, hud } = render(withShift(1));
    orders.toggleSupplyMode();
    flushSync();
    expect(buttons(target).value).toBe('−1');
    buttons(target).back?.click();
    expect(sent).toEqual([{ type: 'set_leaf_shift', shift: 2 }]);
    hud.onSnapshot(withShift(2));
    flushSync();
    buttons(target).forward?.click();
    expect(sent.at(-1)).toEqual({ type: 'set_leaf_shift', shift: 1 });
  });

  it('turns minus off at leaf_shift_max, with the value of the server', () => {
    setLocale('en');
    const { target, orders, hud } = render(withShift(3, 3));
    orders.toggleSupplyMode();
    flushSync();
    expect(buttons(target).value).toBe('−3');
    expect(buttons(target).back?.disabled).toBe(true);
    expect(buttons(target).forward?.disabled).toBe(false);
    hud.onSnapshot(withShift(1, 1));
    flushSync();
    expect(buttons(target).back?.disabled).toBe(true);
  });

  it('keeps the value in the HUD out of the Supply mode while it is not "front"', () => {
    setLocale('en');
    const { target, hud } = render(withShift(0));
    // At the front there is nothing to remind of.
    expect(target.querySelector('.supply')).toBeNull();
    hud.onSnapshot(withShift(2));
    flushSync();
    expect(target.querySelector('.supply')?.textContent).toContain('−2');
    hud.onSnapshot(withShift(0));
    flushSync();
    expect(target.querySelector('.supply')).toBeNull();
  });

  it('has no line hint, no auto lines toggle and no rear minimum stepper', () => {
    setLocale('en');
    const { target, orders } = render();
    orders.toggleSupplyMode();
    flushSync();
    const text = target.querySelector('.supply')?.textContent ?? '';
    expect(text).not.toContain('supply line');
    expect(text).not.toContain('Auto lines');
    expect(target.querySelector('button[aria-label="Lower rear minimum"]')).toBeNull();
    expect(target.querySelector('button[aria-pressed]')).toBeNull();
  });
});
