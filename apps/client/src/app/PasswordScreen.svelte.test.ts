import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale, translate, type MessageKey } from '../i18n/index.ts';
import type { AccountFailure } from './account.ts';
import { makeDock } from './dockTestKit.ts';
import PasswordScreen from './PasswordScreen.svelte';

describe('PasswordScreen (#374)', () => {
  let component: Record<string, unknown> | undefined;
  beforeEach(() => {
    onback = vi.fn();
  });
  afterEach(() => {
    if (component !== undefined) void unmount(component);
    component = undefined;
    document.body.innerHTML = '';
    setLocale('en');
  });

  let onback = vi.fn();

  function render(
    hasPassword: boolean,
    result: AccountFailure | null = null,
  ): ReturnType<typeof vi.fn> {
    setLocale('en');
    const onsubmit = vi.fn(() => Promise.resolve(result));
    component = mount(PasswordScreen, {
      target: document.body,
      props: { dock: makeDock({ hasPassword }).dock, hasPassword, onsubmit, onback },
    });
    flushSync();
    return onsubmit;
  }

  function field(label: MessageKey): HTMLInputElement | undefined {
    const text = translate('en', label);
    const found = [...document.querySelectorAll('label')].find((l) =>
      l.textContent.trim().startsWith(text),
    );
    return found?.querySelector('input') ?? undefined;
  }

  function type(input: HTMLInputElement | undefined, value: string): void {
    if (input === undefined) throw new Error('no field');
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
  }

  async function submit(): Promise<void> {
    document.querySelector('form')?.requestSubmit();
    await vi.waitFor(() => {
      expect(
        document.querySelector<HTMLButtonElement>('button[type=submit]')?.disabled ?? false,
      ).toBe(false);
    });
    flushSync();
  }

  it('a guest sets a password: no old password asked', async () => {
    const onsubmit = render(false);
    expect(field('account.passwordOld')).toBeUndefined();
    expect(document.querySelector('h2')?.textContent).toBe(translate('en', 'account.setTitle'));
    type(field('account.passwordNew'), 'a long password');
    type(field('account.passwordRepeat'), 'a long password');
    await submit();
    expect(onsubmit).toHaveBeenCalledWith('a long password', '');
  });

  it('an account changes it: the old password is a current-password field', async () => {
    const onsubmit = render(true);
    const old = field('account.passwordOld');
    expect(old?.type).toBe('password');
    expect(old?.autocomplete).toBe('current-password');
    expect(field('account.passwordNew')?.autocomplete).toBe('new-password');
    type(old, 'the old one');
    type(field('account.passwordNew'), 'a long password');
    type(field('account.passwordRepeat'), 'a long password');
    await submit();
    expect(onsubmit).toHaveBeenCalledWith('a long password', 'the old one');
  });

  it('says it is saved and drops the form; shows a refusal and keeps the form', async () => {
    render(true);
    type(field('account.passwordOld'), 'the old one');
    type(field('account.passwordNew'), 'a long password');
    type(field('account.passwordRepeat'), 'a long password');
    await submit();
    expect(document.querySelector('[role=status]')?.textContent).toBe(
      translate('en', 'account.saved'),
    );
    expect(document.querySelector('input')).toBeNull();
    void unmount(component ?? {});
    document.body.innerHTML = '';
    render(true, { key: 'error.api.wrong_password' });
    type(field('account.passwordOld'), 'wrong');
    type(field('account.passwordNew'), 'a long password');
    type(field('account.passwordRepeat'), 'a long password');
    await submit();
    expect(document.querySelector('[role=alert]')?.textContent).toBe('Wrong password.');
    expect(field('account.passwordOld')?.value).toBe('wrong');
  });

  it('does not ask the server for an unequal repeat', async () => {
    const onsubmit = render(false);
    type(field('account.passwordNew'), 'a long password');
    type(field('account.passwordRepeat'), 'another long one');
    await submit();
    expect(onsubmit).not.toHaveBeenCalled();
    expect(document.querySelector('[role=alert]')?.textContent).toBe(
      translate('en', 'error.account.mismatch'),
    );
  });

  it('stays in the frame of the menu: the rail with no row marked, no match chips', () => {
    render(true);
    expect(document.querySelector('main.front')).not.toBeNull();
    expect(document.querySelector('.rail [aria-current]')).toBeNull();
    expect(document.querySelector('.panel .tags')).toBeNull();
    expect(document.querySelector('.panel .pe')?.textContent).toBe(
      translate('en', 'account.eyebrow'),
    );
  });

  it('focuses the first field; Esc goes back, also from a field', () => {
    render(true);
    expect(document.activeElement).toBe(field('account.passwordOld'));
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(onback).toHaveBeenCalledOnce();
  });

  it('Enter in a field saves (the form is submitted), Enter after the save goes back', async () => {
    const onsubmit = render(false);
    expect(document.activeElement).toBe(field('account.passwordNew'));
    type(field('account.passwordNew'), 'a long password');
    type(field('account.passwordRepeat'), 'a long password');
    await submit();
    expect(onsubmit).toHaveBeenCalledOnce();
    expect(document.querySelector('form')).toBeNull();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onback).toHaveBeenCalledOnce();
  });
});
