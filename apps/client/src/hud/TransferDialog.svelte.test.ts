import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale } from '../i18n/index.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { OrderBook } from '../match/orderBook.ts';
import { OrderController } from '../match/orderController.ts';
import type { Command } from '../protocol.gen.ts';
import { DEV_RULES, devSnapshot } from './devFeed.ts';
import { HudState } from './hudState.svelte.ts';
import TransferDialog from './TransferDialog.svelte';

describe('TransferDialog', () => {
  const initial = getLocale();
  let mounted: Record<string, unknown> | undefined;

  afterEach(() => {
    if (mounted !== undefined) void unmount(mounted);
    mounted = undefined;
    setLocale(initial);
    document.body.innerHTML = '';
  });

  function render(max: number, full = false) {
    setLocale('en');
    const hud = new HudState({
      me: 0,
      nicks: ['Danya', 'Bot'],
      rules: DEV_RULES,
      map: DEFAULT_MAP,
    });
    hud.onSnapshot(devSnapshot(DEFAULT_MAP, DEV_RULES, 30));
    const sent: Command[] = [];
    const orders = new OrderController({
      hud,
      map: DEFAULT_MAP,
      rules: DEV_RULES,
      book: new OrderBook(),
      send: (cmd) => sent.push(cmd),
    });
    orders.transfer.open(0, 1, max, full);
    const target = document.body.appendChild(document.createElement('div'));
    mounted = mount(TransferDialog, { target, props: { orders, names: hud.nodeName } });
    flushSync();
    return { target, orders, sent };
  }

  it('shows the amount, the slider on the focus, and sends it with Enter', async () => {
    const { target, sent } = render(8);
    await tick();
    const slider = target.querySelector<HTMLInputElement>('input[type="range"]');
    expect([slider?.min, slider?.max, slider?.value]).toEqual(['1', '8', '4']);
    expect(document.activeElement).toBe(slider);
    expect(target.querySelector('.n')?.textContent).toBe('4');
    if (slider === null) throw new Error('no slider');
    slider.value = '6';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(target.querySelector('.n')?.textContent).toBe('6');
    target
      .querySelector('[role="dialog"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    flushSync();
    expect(sent).toEqual([{ type: 'transfer', from_node: 0, to_node: 1, n: 6 }]);
    expect(target.querySelector('[role="dialog"]')).toBeNull();
  });

  it('keeps Tab inside: slider, Send, Cancel, round again', async () => {
    const { target } = render(8);
    await tick();
    const dialog = target.querySelector('[role="dialog"]');
    const labels: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      labels.push(
        document.activeElement?.tagName === 'INPUT'
          ? 'slider'
          : (document.activeElement?.textContent ?? ''),
      );
    }
    expect(labels[0]).toContain('Send');
    expect(labels[1]).toContain('Cancel');
    expect(labels[2]).toBe('slider');
    expect(labels[3]).toContain('Send');
  });

  it('says why nothing can be sent, with an icon and words, and disables Send', () => {
    const { target } = render(0, true);
    expect(target.querySelector('input[type="range"]')).toBeNull();
    expect(target.querySelector('.dlg-line svg')).not.toBeNull();
    expect(target.textContent).toContain('no free room');
    expect(target.querySelector<HTMLButtonElement>('.pri')?.disabled).toBe(true);
  });

  it('Cancel closes without sending', () => {
    const { target, sent } = render(5);
    const cancel = [...target.querySelectorAll('button')].find((b) =>
      b.textContent.includes('Cancel'),
    );
    cancel?.click();
    flushSync();
    expect(sent).toEqual([]);
    expect(target.querySelector('[role="dialog"]')).toBeNull();
  });
});
