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

  it('is plain text where the app gives no way home (the main screen, the boot)', () => {
    open(() => null);
    expect(document.querySelector('.mark button')).toBeNull();
    expect(document.querySelector('.mark')?.textContent.trim()).toBe(translate('en', 'app.title'));
  });

  it('is plain text without a context, and while the bar is locked', () => {
    open(undefined);
    expect(document.querySelector('.mark button')).toBeNull();
    void unmount(component as Record<string, unknown>);
    open(() => vi.fn(), true);
    expect(document.querySelector('.mark button')).toBeNull();
  });
});
