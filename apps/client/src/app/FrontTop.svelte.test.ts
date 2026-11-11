import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale, translate } from '../i18n/index.ts';
import FrontTop from './FrontTop.svelte';
import { HOME_KEY, type HomeGetter } from './home.ts';

// The brand of the bar is the way back to the main screen where the app allows it (#945).
describe('FrontTop brand as a way home (#945)', () => {
  let component: Record<string, unknown> | undefined;
  afterEach(() => {
    if (component !== undefined) void unmount(component);
    component = undefined;
    document.body.innerHTML = '';
  });

  function open(home: HomeGetter | undefined, locked = false): void {
    setLocale('en');
    component = mount(FrontTop, {
      target: document.body,
      props: { locked, onhelp: () => undefined },
      context: new Map(home === undefined ? [] : [[HOME_KEY, home]]),
    });
    flushSync();
  }

  it('is a named button that goes home on a click', () => {
    const go = vi.fn();
    open(() => go);
    const brand = document.querySelector<HTMLButtonElement>('.mark button');
    expect(brand).not.toBeNull();
    expect(brand?.getAttribute('aria-label')).toBe(translate('en', 'top.home'));
    brand?.click();
    expect(go).toHaveBeenCalledOnce();
  });

  const brand = (): HTMLButtonElement | null =>
    document.querySelector<HTMLButtonElement>('.mark button.home');

  it('is the same named button where the app gives no way home (main screen, boot) and does nothing', () => {
    const reload = vi.fn();
    window.addEventListener('beforeunload', reload);
    open(() => null);
    expect(brand()).not.toBeNull();
    expect(brand()?.getAttribute('aria-label')).toBe(translate('en', 'top.home'));
    expect(brand()?.disabled).toBe(false);
    brand()?.click();
    window.removeEventListener('beforeunload', reload);
    expect(reload).not.toHaveBeenCalled();
  });

  it('is the same button without a context', () => {
    open(undefined);
    expect(brand()?.getAttribute('aria-label')).toBe(translate('en', 'top.home'));
    expect(() => brand()?.click()).not.toThrow();
  });

  it('keeps the look and does nothing while the bar is locked', () => {
    const go = vi.fn();
    open(() => go, true);
    expect(brand()?.getAttribute('aria-label')).toBe(translate('en', 'top.home'));
    expect(brand()?.disabled).toBe(false);
    brand()?.click();
    expect(go).not.toHaveBeenCalled();
  });
});
