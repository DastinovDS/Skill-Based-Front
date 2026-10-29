import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocale, setLocale } from '../i18n/index.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { OrderBook } from '../match/orderBook.ts';
import { OrderController } from '../match/orderController.ts';
import type { Command } from '../protocol.gen.ts';
import type { Insets } from '../render/camera.ts';
import { HudChrome } from './chrome.svelte.ts';
import { DEV_PLAYER, DEV_RULES, devSnapshot } from './devFeed.ts';
import Hud from './Hud.svelte';
import { HudState } from './hudState.svelte.ts';

describe('Hud', () => {
  const initial = getLocale();
  let mounted: Record<string, unknown> | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (mounted !== undefined) {
      void unmount(mounted);
      mounted = undefined;
    }
    vi.useRealTimers();
    setLocale(initial);
    document.body.innerHTML = '';
  });

  function render(
    options: {
      oninsets?: (insets: Insets) => void;
      hints?: boolean;
      dev?: boolean;
      rendererFailed?: boolean;
      onreload?: () => void;
      onpause?: () => void;
    } = {},
  ) {
    const state = new HudState({
      me: DEV_PLAYER,
      nicks: ['Danya', 'Guest'],
      rules: DEV_RULES,
      map: DEFAULT_MAP,
    });
    const book = new OrderBook();
    const sent: Command[] = [];
    const orders = new OrderController({
      hud: state,
      map: DEFAULT_MAP,
      rules: DEV_RULES,
      book,
      send: (cmd) => sent.push(cmd),
    });
    const chrome = new HudChrome();
    const target = document.body.appendChild(document.createElement('div'));
    mounted = mount(Hud, {
      target,
      props: {
        rendererFailed: options.rendererFailed ?? false,
        onreload: options.onreload,
        onpause: options.onpause,
        hud: state,
        orders,
        chrome,
        hints: options.hints ?? false,
        oninsets: options.oninsets,
        dev:
          options.dev === true
            ? {
                maps: ['artery'],
                mapName: 'artery',
                scenes: ['demo'],
                sceneId: 'demo',
                fps: 60,
                onselectmap: () => undefined,
                onselectscene: () => undefined,
              }
            : undefined,
      },
    });
    flushSync(); // the effects (the subscription to the answers of commands) have run
    return { target, state, orders, book, sent, chrome };
  }

  const button = (target: HTMLElement, label: string) =>
    [...target.querySelectorAll('button')].find((b) =>
      (b.getAttribute('aria-label') ?? b.textContent).includes(label),
    );

  it('tells that the map stopped drawing and offers Reload (#418)', () => {
    setLocale('en');
    const onreload = vi.fn();
    const { target } = render({ rendererFailed: true, onreload });
    expect(target.querySelector('section.error')?.textContent).toContain('could not be drawn');
    button(target, 'Reload')?.click();
    expect(onreload).toHaveBeenCalledOnce();
  });

  it('shows the pause button only when a pause is offered (#448)', () => {
    setLocale('en');
    const onpause = vi.fn();
    const offered = render({ onpause });
    const live = button(offered.target, 'Pause');
    expect(live?.disabled).toBe(false);
    live?.click();
    expect(onpause).toHaveBeenCalledOnce();
    void unmount(mounted as Record<string, unknown>);
    mounted = undefined;
    document.body.innerHTML = '';

    // A rated match, or a pause already used: nothing to click.
    const none = render();
    expect(button(none.target, 'Pause')).toBeUndefined();
  });

  it('has no side panel and shows the numbers of the snapshot in the top bar', () => {
    setLocale('en');
    const { target, state } = render();
    state.onSnapshot(devSnapshot(DEFAULT_MAP, DEV_RULES, 250));
    flushSync();
    expect(target.querySelector('aside')).toBeNull();
    const bar = (target.querySelector('header')?.textContent ?? '').replace(/\s+/g, ' ');
    // Tick 250 at 10 Hz of a 9000-tick match (DEC-22): 875 s = 14:35 left; CP is at the cap.
    expect(bar).toContain('14:35');
    expect(bar).toContain('Balance');
    expect(bar).toContain('Danya');
    expect(bar).toContain('Guest');
    expect(target.querySelector('[aria-label^="VP score"]')?.getAttribute('aria-label')).toBe(
      'VP score: Danya 2, Guest 1',
    );
    // CP as one track with a notch at every whole CP below the cap: four for a cap of 5 CP.
    expect(target.querySelectorAll('.track')).toHaveLength(1);
    expect(target.querySelectorAll('.notch')).toHaveLength(4);
  });

  it('shows the CP as a track: a head marker while it grows, a ring and the word MAX at the cap (#439)', () => {
    setLocale('en');
    const { target, state } = render();
    // Tick 30 at 100 per 50 ticks: 0.6 CP of 5, growing.
    state.onSnapshot(devSnapshot(DEFAULT_MAP, DEV_RULES, 30));
    flushSync();
    const cp = (): Element | null => target.querySelector('.cp');
    expect(cp()?.getAttribute('aria-label')).toBe('CP: 0.6 of 5');
    expect(cp()?.querySelector('.head')).not.toBeNull();
    expect(cp()?.querySelector('.ring')).toBeNull();
    expect(cp()?.querySelector('.max')).toBeNull();
    // Tick 250 is at the cap: the head goes, the ring and the word come (not a colour alone, AGENTS.md 7.4).
    state.onSnapshot(devSnapshot(DEFAULT_MAP, DEV_RULES, 250));
    flushSync();
    expect(cp()?.getAttribute('aria-label')).toBe('CP: 5 of 5, at the cap');
    expect(cp()?.querySelector('.head')).toBeNull();
    expect(cp()?.querySelector('.ring')).not.toBeNull();
    expect(cp()?.querySelector('.max')?.textContent).toBe('MAX');
  });

  it('has no selection card: a selection is a data attribute, there is no hint line', () => {
    setLocale('en');
    const { target, state, orders } = render();
    const snapshot = devSnapshot(DEFAULT_MAP, DEV_RULES, 30);
    state.onSnapshot(snapshot);
    flushSync();
    const hud = target.querySelector('.hud');
    expect(hud?.getAttribute('data-selection')).toBe('none');
    expect(target.querySelector('.selection')).toBeNull();
    expect(target.querySelector('[aria-label="Orders"]')).toBeNull();
    const group = snapshot.view.groups[0];
    if (group === undefined) throw new Error('no group');
    orders.click({ kind: 'group', id: group.id }, false);
    flushSync();
    expect(hud?.getAttribute('data-selection')).toBe(`group:${group.id}`);
    expect(target.querySelector('.selection')).toBeNull();
    expect(target.querySelector('[aria-label="Orders"]')).toBeNull(); // no hint line at the bottom
    orders.deselect();
    flushSync();
    expect(hud?.getAttribute('data-selection')).toBe('none');
  });

  it('has neither the in-match menu nor the event journal nor a language switcher', () => {
    setLocale('en');
    const { target } = render();
    expect(target.querySelector('select')).toBeNull();
    expect(button(target, 'Menu')).toBeUndefined();
    expect(button(target, 'Event journal')).toBeUndefined();
    expect(target.querySelector('aside')).toBeNull();
  });

  it('puts the map and scene pickers and the frame rate in the dev panel of the dev screen only', () => {
    setLocale('en');
    expect(render().target.textContent).not.toContain('artery');
    document.body.innerHTML = '';
    const { target } = render({ dev: true });
    expect(target.textContent).toContain('artery');
    expect(target.textContent).toContain('FPS: 60');
  });

  it('reports the height of the top bar as the inset for "fit map"', () => {
    const reported: Insets[] = [];
    render({ oninsets: (insets) => reported.push(insets) });
    flushSync();
    expect(reported.length).toBeGreaterThan(0);
    expect(reported[0]).toMatchObject({ left: 0, right: 0, bottom: 0 });
  });

  it('forfeits only after the dialog is confirmed, and "Stay" has the focus', async () => {
    setLocale('en');
    const { target, sent, chrome } = render();
    button(target, 'Exit')?.click();
    flushSync();
    expect(chrome.exitOpen).toBe(true);
    expect(target.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(target.textContent).toContain('This is a forfeit');
    await vi.advanceTimersByTimeAsync(0);
    expect(document.activeElement?.textContent.trim()).toBe('Stay');
    expect(sent).toEqual([]);
    button(target, 'Stay')?.click();
    flushSync();
    expect(target.querySelector('[role="alertdialog"]')).toBeNull();
    expect(sent).toEqual([]);
    button(target, 'Exit')?.click();
    flushSync();
    button(target, 'Forfeit and leave')?.click();
    flushSync();
    expect(sent).toEqual([{ type: 'forfeit' }]);
    expect(target.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('shows a refused command as a toast', () => {
    const text = 'Not enough CP';
    setLocale('en');
    const { target, state, orders, book } = render();
    const snapshot = devSnapshot(DEFAULT_MAP, DEV_RULES, 30);
    state.onSnapshot(snapshot);
    const group = snapshot.view.groups[0];
    const enemy = snapshot.view.nodes.find((n) => n.owner === 1 && n.detail === 'exact');
    if (group === undefined || enemy === undefined) throw new Error('small dev snapshot');
    orders.click({ kind: 'group', id: group.id }, false);
    orders.click({ kind: 'node', id: enemy.id }, false);
    book.onAck({
      type: 'ack',
      seq: 1,
      applied_tick: 31,
      path: null,
      arrive_tick: null,
      reject_code: 'NOT_ENOUGH_CP',
    });
    flushSync();
    expect(target.querySelector('.toast.warn')?.textContent).toContain(text);
  });

  it('opens the help overlay from the button and closes it with its own button', () => {
    setLocale('en');
    const { target, chrome } = render();
    button(target, 'Help')?.click();
    flushSync();
    expect(chrome.helpOpen).toBe(true);
    expect(target.querySelector('[role="dialog"]')?.textContent).toContain('fit the map');
    button(target, 'Close the help')?.click();
    flushSync();
    expect(target.querySelector('[role="dialog"]')).toBeNull();
  });

  it('shows the key hints only when asked to', () => {
    setLocale('en');
    expect(render({ hints: false }).target.querySelector('[aria-label="Key hints"]')).toBeNull();
    document.body.innerHTML = '';
    expect(render({ hints: true }).target.querySelector('[aria-label="Key hints"]')).not.toBeNull();
  });

  it('turns the timer amber in the last minute and adds one toast', () => {
    setLocale('en');
    const { target, state } = render();
    state.onSnapshot(devSnapshot(DEFAULT_MAP, DEV_RULES, DEV_RULES.match_ticks - 590));
    flushSync();
    expect(target.querySelector('.timer.last')).not.toBeNull();
    expect(target.textContent).toContain('0:59');
    state.onSnapshot(devSnapshot(DEFAULT_MAP, DEV_RULES, DEV_RULES.match_ticks - 580));
    flushSync();
    expect(target.querySelectorAll('.toast')).toHaveLength(1);
    expect(target.querySelector('.toast')?.textContent).toContain('Last minute');
  });
});
