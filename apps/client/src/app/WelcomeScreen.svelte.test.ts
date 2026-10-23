import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale, translate, type MessageKey } from '../i18n/index.ts';
import type { AccountFailure } from './account.ts';
import WelcomeScreen from './WelcomeScreen.svelte';

describe('WelcomeScreen accounts (#374)', () => {
  let component: Record<string, unknown> | undefined;
  afterEach(() => {
    if (component !== undefined) void unmount(component);
    component = undefined;
    document.body.innerHTML = '';
    setLocale('en');
  });

  const onsubmit = vi.fn(() => Promise.resolve());
  const onlogin = vi.fn<(n: string, p: string) => Promise<AccountFailure | null>>();
  const onregister = vi.fn<(n: string, p: string) => Promise<AccountFailure | null>>();

  function render(): void {
    setLocale('en');
    onsubmit.mockClear();
    onlogin.mockReset().mockResolvedValue(null);
    onregister.mockReset().mockResolvedValue(null);
    component = mount(WelcomeScreen, {
      target: document.body,
      props: { invited: false, notice: null, onsubmit, onlogin, onregister },
    });
    flushSync();
  }

  function press(key: MessageKey): void {
    const label = translate('en', key);
    const found = [...document.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === label,
    );
    if (found === undefined) throw new Error(`no button ${key}`);
    found.click();
    flushSync();
  }

  function field(label: MessageKey): HTMLInputElement {
    const text = translate('en', label);
    const found = [...document.querySelectorAll('label')].find((l) =>
      l.textContent.trim().startsWith(text),
    );
    const input = found?.querySelector('input');
    if (!input) throw new Error(`no field ${label}`);
    return input;
  }

  function type(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
  }

  async function submit(): Promise<void> {
    document.querySelector('form')?.requestSubmit();
    await vi.waitFor(() => {
      expect(document.querySelector<HTMLButtonElement>('button[type=submit]')?.disabled).toBe(
        false,
      );
    });
    flushSync();
  }

  it('starts as the guest form: no password field', () => {
    render();
    expect(document.querySelector('input[type=password]')).toBeNull();
    expect(field('welcome.nick').autocomplete).toBe('nickname');
  });

  it('login form: a password field that password managers know, and the call with both values', async () => {
    render();
    press('welcome.toLogin');
    const password = field('account.password');
    expect(password.type).toBe('password');
    expect(password.autocomplete).toBe('current-password');
    expect(field('welcome.nick').autocomplete).toBe('username');
    type(field('welcome.nick'), 'Nick');
    type(password, 'a long password');
    await submit();
    expect(onlogin).toHaveBeenCalledWith('Nick', 'a long password');
    expect(onsubmit).not.toHaveBeenCalled();
  });

  it('login form: shows why it failed and keeps the form', async () => {
    render();
    press('welcome.toLogin');
    onlogin.mockResolvedValue({ key: 'error.account.wrongLogin' });
    type(field('welcome.nick'), 'Nick');
    type(field('account.password'), 'wrong password');
    await submit();
    expect(document.querySelector('[role=alert]')?.textContent).toBe('Wrong nick or password.');
    expect(field('account.password')).toBeDefined();
  });

  it('registration form: new-password fields, and no call for a short or unequal password', async () => {
    render();
    press('welcome.toRegister');
    const password = field('account.passwordNew');
    const repeat = field('account.passwordRepeat');
    expect(password.type).toBe('password');
    expect(password.autocomplete).toBe('new-password');
    expect(repeat.autocomplete).toBe('new-password');
    type(field('welcome.nick'), 'Newbie');
    type(password, 'short');
    type(repeat, 'short');
    await submit();
    expect(document.querySelector('[role=alert]')?.textContent).toBe(
      translate('en', 'error.account.passwordLength'),
    );
    type(password, 'a long password');
    type(repeat, 'a long passwore');
    await submit();
    expect(document.querySelector('[role=alert]')?.textContent).toBe(
      translate('en', 'error.account.mismatch'),
    );
    expect(onregister).not.toHaveBeenCalled();
    type(repeat, 'a long password');
    await submit();
    expect(onregister).toHaveBeenCalledWith('Newbie', 'a long password');
  });

  it('goes back to the guest form without leaving a password behind', () => {
    render();
    press('welcome.toLogin');
    type(field('account.password'), 'a long password');
    press('welcome.toGuest');
    expect(document.querySelector('input[type=password]')).toBeNull();
    press('welcome.toLogin');
    expect(field('account.password').value).toBe('');
  });
});
