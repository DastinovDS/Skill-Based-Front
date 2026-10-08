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
import { HudPrefs } from './prefs.svelte.ts';

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
    options: { oninsets?: (insets: Insets) => void; hints?: boolean; dev?: boolean } = {},
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
    const prefs = new HudPrefs(() => window.localStorage);
    const fitted = vi.fn();
    const target = document.body.appendChild(document.createElement('div'));
    mounted = mount(Hud, {
      target,
      props: {
        rendererFailed: false,
        hud: state,
        orders,
        chrome,
        prefs,
        hints: options.hints ?? false,
        oninsets: options.oninsets,
        onfit: fitted,
        dev:
          options.dev === true
            ? {
                maps: ['pereval'],
                mapName: 'pereval',
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
    return { target, state, orders, book, sent, chrome, fitted };
  }

  const button = (target: HTMLElement, label: string) =>
    [...target.querySelectorAll('button')].find((b) =>
      (b.getAttribute('aria-label') ?? b.textContent).includes(label),
    );

  it('has no side panel and shows the numbers of the snapshot in the top bar', () => {
    setLocale('en');
    const { target, state } = render();
    state.onSnapshot(devSnapshot(DEFAULT_MAP, DEV_RULES, 250));
    flushSync();
    expect(target.querySelector('aside')).toBeNull();
    const bar = (target.querySelector('header')?.textContent ?? '').replace(/\s+/g, ' ');
    // Tick 250 at 10 Hz of a 7200-tick match: 695 s = 11:35 left; CP is at the cap by then.
    expect(bar).toContain('11:35');
    expect(bar).toContain('Balance');
    expect(bar).toContain('Danya');
    expect(bar).toContain('Guest');
    expect(target.querySelector('[aria-label^="VP score"]')?.getAttribute('aria-label')).toBe(
      'VP score: Danya 2, Guest 1',
    );
    // CP in whole segments of the cap: five of them for a cap of 5 CP.
    expect(target.querySelectorAll('.segment')).toHaveLength(5);
  });

  it('shows the selection card only while something is selected', () => {
    const { target, state, orders } = render();
    const snapshot = devSnapshot(DEFAULT_MAP, DEV_RULES, 30);
    state.onSnapshot(snapshot);
    flushSync();
    expect(target.querySelector('.card')).toBeNull();
    const group = snapshot.view.groups[0];
    if (group === undefined) throw new Error('no group');
    orders.click({ kind: 'group', id: group.id }, false);
    flushSync();
    expect(target.querySelector('.card')).not.toBeNull();
    orders.deselect();
    flushSync();
    expect(target.querySelector('.card')).toBeNull();
  });

  it('opens the menu with the language switcher and the fit button', () => {
    setLocale('ru');
    const { target, chrome, fitted } = render();
    expect(target.querySelector('select')).toBeNull();
    button(target, 'Меню')?.click();
    flushSync();
    expect(chrome.menuOpen).toBe(true);
    const language = target.querySelector('select');
    if (language === null) throw new Error('no language select');
    expect([...language.options].map((option) => option.textContent)).toEqual([
      'English',
      'Русский',
    ]);
    language.value = 'en';
    language.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(getLocale()).toBe('en');
    expect(window.localStorage.getItem('sbf.locale')).toBe('en');
    button(target, 'Fit map')?.click();
    expect(fitted).toHaveBeenCalledOnce();
    // The place for the settings of package F exists, and the dev pickers are not here.
    expect(target.querySelector('[data-slot="settings"]')).not.toBeNull();
    expect(target.textContent).not.toContain('pereval');
  });

  it('puts the map and scene pickers and the frame rate in the menu of the dev screen only', () => {
    setLocale('en');
    const { target } = render({ dev: true });
    button(target, 'Menu')?.click();
    flushSync();
    expect(target.textContent).toContain('pereval');
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

  it.each([
    ['en', 'Not enough CP'],
    ['ru', 'Не хватает CP'],
  ] as const)('shows a refused command as a toast in %s', (locale, text) => {
    setLocale(locale);
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
    expect(target.querySelector('[role="dialog"]')?.textContent).toContain('Home');
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
