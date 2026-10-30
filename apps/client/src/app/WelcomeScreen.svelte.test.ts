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

  function render(over: { invited?: boolean; notice?: MessageKey | null } = {}): void {
    setLocale('en');
    onsubmit.mockClear();
    onlogin.mockReset().mockResolvedValue(null);
    onregister.mockReset().mockResolvedValue(null);
    component = mount(WelcomeScreen, {
      target: document.body,
      props: { invited: false, notice: null, onsubmit, onlogin, onregister, ...over },
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

  const alert = (): string | undefined =>
    document.querySelector('[role=alert]')?.textContent.trim();
  const play = (): HTMLButtonElement | null =>
    document.querySelector<HTMLButtonElement>('button[type=submit]');

  describe('the entry screen (#629, N5)', () => {
    it('shows the title, the field and Play, no rule line and no key badge', () => {
      render();
      expect(document.querySelector('h1')?.textContent).toBe(translate('en', 'app.title'));
      expect(field('welcome.nick').placeholder).toBe(translate('en', 'welcome.nickPlaceholder'));
      expect(document.body.textContent).not.toContain('3 to 16');
      expect(document.querySelector('kbd')).toBeNull();
      expect(play()?.disabled).toBe(true);
    });

    it('tells a short nick only once the field is left, a bad character at once', () => {
      render();
      type(field('welcome.nick'), 'Da');
      expect(alert()).toBeUndefined();
      expect(play()?.disabled).toBe(true);
      field('welcome.nick').dispatchEvent(new Event('blur'));
      flushSync();
      expect(alert()).toContain(translate('en', 'welcome.error.short'));
      type(field('welcome.nick'), 'Dan ya');
      expect(alert()).toContain(translate('en', 'welcome.error.chars'));
      type(field('welcome.nick'), 'Данил_2');
      expect(alert()).toBeUndefined();
      expect(play()?.disabled).toBe(false);
    });

    it('says a taken nick shortly', () => {
      render({ notice: 'error.api.conflict' });
      expect(alert()).toContain(translate('en', 'welcome.error.taken'));
    });

    it('shows the session notice and the invite', () => {
      render({ notice: 'error.api.unauthorized', invited: true });
      expect(alert()).toContain('Signed out. Pick a nick or log in');
      expect(document.body.textContent).toContain(translate('en', 'welcome.invitedChip'));
      expect(play()?.textContent.trim()).toBe(translate('en', 'welcome.join'));
    });
  });

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
