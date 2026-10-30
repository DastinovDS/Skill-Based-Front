import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale } from '../i18n/index.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { OrderBook } from '../match/orderBook.ts';
import { OrderController } from '../match/orderController.ts';
import type { Command } from '../protocol.gen.ts';
import { DEV_RULES, devSnapshot } from './devFeed.ts';
import { HudState } from './hudState.svelte.ts';
import SplitMenu from './SplitMenu.svelte';

const snapshot = devSnapshot(DEFAULT_MAP, DEV_RULES, 30);
const first = snapshot.view.groups[0];
if (first === undefined) throw new Error('the dev snapshot has no group');
const group = { ...first, units: 6, charged: 2 };

describe('SplitMenu', () => {
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
    hud.onSnapshot({ ...snapshot, view: { ...snapshot.view, groups: [group] } });
    const sent: Command[] = [];
    const orders = new OrderController({
      hud,
      map: DEFAULT_MAP,
      rules: DEV_RULES,
      book: new OrderBook(),
      send: (cmd) => sent.push(cmd),
    });
    orders.click({ kind: 'group', id: group.id }, false);
    const target = document.body.appendChild(document.createElement('div'));
    mounted = mount(SplitMenu, { target, props: { orders } });
    return { target, orders, sent };
  }

  it('is not there until S opens it', () => {
    const { target, orders } = render();
    expect(target.querySelector('[role="dialog"]')).toBeNull();
    orders.toggleSplit();
    flushSync();
    expect(target.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('splits the amount of the slider; the charged go first', () => {
    setLocale('en');
    const { target, orders, sent } = render();
    orders.toggleSplit();
    flushSync();
    const slider = target.querySelector<HTMLInputElement>('input[type="range"]');
    if (slider === null) throw new Error('no slider');
    expect([slider.min, slider.max, slider.value]).toEqual(['1', '5', '3']);
    slider.value = '4';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    // The two groups of the preview: 4 go (both charged units first), 2 stay (none charged).
    expect(target.querySelector('.goes .n')?.textContent).toBe('4');
    expect(target.querySelector('.goes .charged')?.textContent).toBe('2 charged');
    expect(target.querySelector('.stays .count')?.textContent).toBe('2');
    expect(target.querySelector('.stays .line:last-child')?.textContent).toBe('0 charged');
    const confirm = target.querySelector<HTMLButtonElement>('.confirm');
    confirm?.dispatchEvent(new PointerEvent('pointerenter'));
    flushSync();
    expect(confirm?.classList.contains('hover')).toBe(true); // hover highlights
    confirm?.click();
    flushSync();
    expect(sent).toEqual([{ type: 'split', group: group.id, n: 4 }]);
    expect(target.querySelector('[role="dialog"]')).toBeNull();
  });

  it('closes on a click outside without splitting', () => {
    const { target, orders, sent } = render();
    orders.toggleSplit();
    flushSync();
    target.querySelector<HTMLButtonElement>('.backdrop')?.click();
    flushSync();
    expect(target.querySelector('[role="dialog"]')).toBeNull();
    expect(sent).toEqual([]);
  });
});
