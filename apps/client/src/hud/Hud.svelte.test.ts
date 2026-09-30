import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale } from '../i18n/index.ts';
import Hud from './Hud.svelte';
import type { Insets } from '../render/camera.ts';
import { DEV_PLAYER, DEV_RULES, devSnapshot } from './devFeed.ts';
import { HudState } from './hudState.svelte.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';

describe('Hud language switcher', () => {
  const initial = getLocale();
  let hud: Record<string, unknown> | undefined;

  afterEach(() => {
    if (hud !== undefined) {
      void unmount(hud);
      hud = undefined;
    }
    setLocale(initial);
    document.body.innerHTML = '';
  });

  function render(
    state = new HudState({ me: DEV_PLAYER, rules: DEV_RULES, map: DEFAULT_MAP }),
    oninsets?: (insets: Insets) => void,
  ): HTMLElement {
    const target = document.body.appendChild(document.createElement('div'));
    hud = mount(Hud, {
      target,
      props: {
        rendererFailed: false,
        maps: ['pereval'],
        mapName: 'pereval',
        fps: 60,
        hud: state,
        oninsets,
        onselectmap: () => undefined,
        onfit: () => undefined,
      },
    });
    return target;
  }

  it('re-renders the HUD in the picked language', () => {
    setLocale('ru');
    const target = render();
    expect(target.querySelector('button.fit')?.textContent).toBe('Вписать карту');

    const selects = target.querySelectorAll('select');
    const language = selects[selects.length - 1];
    if (language === undefined) {
      throw new Error('no language select');
    }
    expect([...language.options].map((option) => option.textContent)).toEqual([
      'English',
      'Русский',
    ]);
    language.value = 'en';
    language.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();

    expect(target.querySelector('button.fit')?.textContent).toBe('Fit map');
    expect(getLocale()).toBe('en');
    expect(window.localStorage.getItem('sbf.locale')).toBe('en');
  });

  it('shows the numbers of the snapshot in the status bar', () => {
    setLocale('en');
    const state = new HudState({ me: DEV_PLAYER, rules: DEV_RULES, map: DEFAULT_MAP });
    const target = render(state);
    expect(target.querySelector('header dl')).toBeNull();
    state.onSnapshot(devSnapshot(DEFAULT_MAP, DEV_RULES, 250));
    flushSync();
    const bar = (target.querySelector('header')?.textContent ?? '').replace(/\s+/g, ' ');
    // Tick 250 at 10 Hz of a 7200-tick match: 695 s = 11:35 left; CP is at the cap by then.
    expect(bar).toContain('11:35');
    expect(bar).toContain('Balance');
    expect(bar).toContain('you 2 : 1 enemy');
  });

  it('collapses the side panel and reports the insets again', () => {
    const reported: Insets[] = [];
    const target = render(undefined, (insets) => reported.push(insets));
    flushSync();
    expect(target.querySelector('aside')).not.toBeNull();
    expect(reported.length).toBeGreaterThan(0);
    const toggle = target.querySelector('header button');
    if (!(toggle instanceof HTMLButtonElement)) {
      throw new Error('no panel toggle');
    }
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    toggle.click();
    flushSync();
    expect(target.querySelector('aside')).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});
