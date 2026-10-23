import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale, translate } from '../i18n/index.ts';
import MenuScreen from './MenuScreen.svelte';

describe('MenuScreen', () => {
  let component: Record<string, unknown> | undefined;
  afterEach(() => {
    if (component !== undefined) void unmount(component);
    component = undefined;
    document.body.innerHTML = '';
    setLocale('en');
  });

  function render(
    hasActiveMatch: boolean,
    onresume = vi.fn(),
    account: { hasPassword?: boolean; onlogout?: () => void; onpassword?: () => void } = {},
  ): void {
    setLocale('en');
    component = mount(MenuScreen, {
      target: document.body,
      props: {
        nick: 'Me',
        notice: null,
        oncreate: vi.fn(),
        onqueue: vi.fn(),
        onlobby: vi.fn(),
        onbot: vi.fn(),
        hasPassword: account.hasPassword ?? false,
        onpassword: account.onpassword ?? vi.fn(),
        onlogout: account.onlogout ?? vi.fn(),
        hasActiveMatch,
        onresume,
      },
    });
    flushSync();
  }

  function button(
    key:
      | 'menu.setPassword'
      | 'menu.changePassword'
      | 'menu.logout'
      | 'menu.logoutConfirm'
      | 'menu.logoutCancel',
  ): HTMLButtonElement | undefined {
    const label = translate('en', key);
    return [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
  }

  function resumeButton(): HTMLButtonElement | undefined {
    const label = translate('en', 'menu.resume');
    return [...document.querySelectorAll('button')].find((b) => b.textContent === label);
  }

  it('offers the way back into a running match', () => {
    const onresume = vi.fn();
    render(true, onresume);
    resumeButton()?.click();
    expect(onresume).toHaveBeenCalledOnce();
  });

  it('has no such button without a running match', () => {
    render(false);
    expect(resumeButton()).toBeUndefined();
  });

  it('offers to set the password of a guest and to change the one of an account', () => {
    const onpassword = vi.fn();
    render(false, vi.fn(), { hasPassword: false, onpassword });
    expect(button('menu.changePassword')).toBeUndefined();
    button('menu.setPassword')?.click();
    expect(onpassword).toHaveBeenCalledOnce();
    void unmount(component ?? {});
    document.body.innerHTML = '';
    render(false, vi.fn(), { hasPassword: true, onpassword });
    expect(button('menu.setPassword')).toBeUndefined();
    button('menu.changePassword')?.click();
    expect(onpassword).toHaveBeenCalledTimes(2);
  });

  it('logs an account out at once', () => {
    const onlogout = vi.fn();
    render(false, vi.fn(), { hasPassword: true, onlogout });
    button('menu.logout')?.click();
    expect(onlogout).toHaveBeenCalledOnce();
  });

  it('warns a guest without a password before the logout, and lets them stay', () => {
    const onlogout = vi.fn();
    render(false, vi.fn(), { hasPassword: false, onlogout });
    button('menu.logout')?.click();
    flushSync();
    expect(onlogout).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(translate('en', 'menu.logoutWarning'));
    button('menu.logoutCancel')?.click();
    flushSync();
    expect(document.body.textContent).not.toContain(translate('en', 'menu.logoutWarning'));
    button('menu.logout')?.click();
    flushSync();
    button('menu.logoutConfirm')?.click();
    expect(onlogout).toHaveBeenCalledOnce();
  });
});
