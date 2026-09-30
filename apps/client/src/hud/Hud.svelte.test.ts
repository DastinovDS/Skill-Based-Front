import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale } from '../i18n/index.ts';
import Hud from './Hud.svelte';

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

  function render(): HTMLElement {
    const target = document.body.appendChild(document.createElement('div'));
    hud = mount(Hud, {
      target,
      props: {
        rendererFailed: false,
        maps: ['pereval'],
        mapName: 'pereval',
        fps: 60,
        onselectmap: () => undefined,
        onfit: () => undefined,
      },
    });
    return target;
  }

  it('re-renders the HUD in the picked language', () => {
    setLocale('ru');
    const target = render();
    expect(target.querySelector('button')?.textContent).toBe('Вписать карту');

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

    expect(target.querySelector('button')?.textContent).toBe('Fit map');
    expect(getLocale()).toBe('en');
    expect(window.localStorage.getItem('sbf.locale')).toBe('en');
  });
});
