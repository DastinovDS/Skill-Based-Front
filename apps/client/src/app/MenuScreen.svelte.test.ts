import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale, translate, type MessageKey } from '../i18n/index.ts';
import type { Calibration } from '../protocol.gen.ts';
import MenuScreen from './MenuScreen.svelte';

describe('MenuScreen', () => {
  let component: Record<string, unknown> | undefined;
  beforeEach(() => {
    setLocale('en');
  });
  afterEach(() => {
    if (component !== undefined) void unmount(component);
    component = undefined;
    document.body.innerHTML = '';
    vi.useRealTimers();
    setLocale('en');
  });

  interface Options {
    hasActiveMatch?: boolean;
    hasPassword?: boolean;
    calibration?: Calibration | null;
    rating?: number | null;
    banUntil?: number | null;
    now?: () => number;
    notice?: MessageKey | null;
    handlers?: Partial<
      Record<
        | 'onresume'
        | 'oncreate'
        | 'onqueue'
        | 'onlobby'
        | 'onreplays'
        | 'onboard'
        | 'onbot'
        | 'onhowto'
        | 'onpassword'
        | 'onlogout',
        () => void
      >
    >;
  }

  function render(options: Options = {}): void {
    const h = options.handlers ?? {};
    component = mount(MenuScreen, {
      target: document.body,
      props: {
        nick: 'Me',
        notice: options.notice ?? null,
        oncreate: h.oncreate ?? vi.fn(),
        onqueue: h.onqueue ?? vi.fn(),
        onlobby: h.onlobby ?? vi.fn(),
        onreplays: h.onreplays ?? vi.fn(),
        onboard: h.onboard ?? vi.fn(),
        onbot: h.onbot ?? vi.fn(),
        onhowto: h.onhowto ?? vi.fn(),
        hasPassword: options.hasPassword ?? false,
        calibration: options.calibration ?? null,
        rating: options.rating ?? null,
        banUntil: options.banUntil ?? null,
        ...(options.now === undefined ? {} : { now: options.now }),
        onpassword: h.onpassword ?? vi.fn(),
        onlogout: h.onlogout ?? vi.fn(),
        hasActiveMatch: options.hasActiveMatch ?? false,
        onresume: h.onresume ?? vi.fn(),
      },
    });
    flushSync();
  }

  /** A button by its name. */
  function button(label: string): HTMLButtonElement | undefined {
    return [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
  }
  const named = (key: MessageKey): HTMLButtonElement | undefined => button(translate('en', key));

  function openAccount(): void {
    document.querySelector<HTMLButtonElement>('button.who')?.click();
    flushSync();
  }

  function press(key: string): void {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    flushSync();
  }

  it('has one main action, Play, and five quiet rows, Replays and Leaderboard among them (#78)', () => {
    const onqueue = vi.fn();
    render({ handlers: { onqueue } });
    named('menu.play')?.click();
    expect(onqueue).toHaveBeenCalledOnce();
    expect(named('menu.bot')).toBeTruthy();
    expect(named('menu.create')).toBeTruthy();
    expect(named('menu.lobby')).toBeTruthy();
    expect(named('menu.replays')).toBeTruthy();
    expect(named('menu.leaderboard')).toBeTruthy();
  });

  it('opens How to play also while a match runs (CLI-13)', () => {
    const onhowto = vi.fn();
    render({ hasActiveMatch: true, handlers: { onhowto } });
    named('help.howTo')?.click();
    expect(onhowto).toHaveBeenCalledOnce();
  });

  it('has no key hints and no letter keys on the rows', () => {
    const handlers = {
      onbot: vi.fn(),
      oncreate: vi.fn(),
      onlobby: vi.fn(),
      onreplays: vi.fn(),
      onboard: vi.fn(),
      onhowto: vi.fn(),
    };
    render({ handlers });
    expect(document.body.querySelector('kbd')).toBeNull();
    for (const key of ['b', 'i', 'l', 'r', 't', 'h', 'B']) press(key);
    for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled();
  });

  it('shows the rating of a ranked account in the corner chip', () => {
    render({ hasPassword: true, rating: 1480 });
    expect(document.body.textContent).toContain('1480');
  });

  it('plays with Enter', () => {
    const onqueue = vi.fn();
    render({ handlers: { onqueue } });
    press('Enter');
    expect(onqueue).toHaveBeenCalledOnce();
  });

  it('keeps the keys out of a text field', () => {
    const onbot = vi.fn();
    render({ handlers: { onbot } });
    const field = document.body.appendChild(document.createElement('input'));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
    expect(onbot).not.toHaveBeenCalled();
  });

  describe('the player chip in the corner', () => {
    it('shows a guest as unrated with a hint to set a password', () => {
      render({ hasPassword: false });
      expect(document.querySelector('.who')?.textContent).toContain(translate('en', 'menu.guest'));
      expect(document.body.textContent).toContain(translate('en', 'menu.guestHint'));
    });

    it('shows calibration k/5 there and nowhere else', () => {
      render({ hasPassword: true, calibration: { played: 2, total: 5 } });
      const chip = document.querySelector('.who');
      expect(chip?.textContent).toContain('Calibration 2/5');
      expect(chip?.querySelectorAll('.cells i.on')).toHaveLength(2);
      expect(chip?.querySelectorAll('.cells i')).toHaveLength(5);
      const outside = document.body.textContent.replace(chip?.textContent ?? '', '');
      expect(outside).not.toMatch(/Calibration|Rating shows/);
    });

    it('shows a calibrated account as ranked', () => {
      render({ hasPassword: true, calibration: null });
      expect(document.querySelector('.who')?.textContent).toContain(translate('en', 'menu.ranked'));
      expect(document.querySelector('.who .cells')).toBeNull();
    });
  });

  describe('a running match', () => {
    it('offers only Return, the modes are off', () => {
      const onresume = vi.fn();
      const onbot = vi.fn();
      render({ hasActiveMatch: true, handlers: { onresume, onbot } });
      named('menu.resume')?.click();
      expect(onresume).toHaveBeenCalledOnce();
      expect(named('menu.play')).toBeUndefined();
      expect(named('menu.bot')?.disabled).toBe(true);
      expect(named('menu.lobby')?.disabled).toBe(true);
      press('b');
      expect(onbot).not.toHaveBeenCalled();
      press('Enter');
      expect(onresume).toHaveBeenCalledTimes(2);
    });

    it('has no Return without a running match', () => {
      render();
      expect(named('menu.resume')).toBeUndefined();
    });
  });

  describe('a queue ban (DEC-34)', () => {
    it('replaces Play with the time left, keeps the other modes open and counts down', () => {
      vi.useFakeTimers();
      let now = 1_000_000;
      const onqueue = vi.fn();
      const onbot = vi.fn();
      render({ banUntil: now + 287_000, now: () => now, handlers: { onqueue, onbot } });
      expect(document.body.textContent).toContain('4:47');
      expect(document.body.textContent).toContain(translate('en', 'menu.banReason'));
      expect(named('menu.play')).toBeUndefined();
      press('Enter');
      expect(onqueue).not.toHaveBeenCalled();
      named('menu.bot')?.click();
      expect(onbot).toHaveBeenCalledOnce();
      now += 60_000;
      vi.advanceTimersByTime(1000);
      flushSync();
      expect(document.body.textContent).toContain('3:47');
    });

    it('gives Play back when the ban is over', () => {
      vi.useFakeTimers();
      let now = 5_000;
      render({ banUntil: now + 2_000, now: () => now });
      expect(named('menu.play')).toBeUndefined();
      now += 3_000;
      vi.advanceTimersByTime(1000);
      flushSync();
      expect(named('menu.play')).toBeTruthy();
    });
  });

  it('says why the last action failed', () => {
    render({ notice: 'error.api.network' });
    expect(document.querySelector('[role=alert]')?.textContent).toContain(
      translate('en', 'error.api.network'),
    );
  });

  describe('the account menu', () => {
    it('offers to set the password of a guest and to change the one of an account', () => {
      const onpassword = vi.fn();
      render({ hasPassword: false, handlers: { onpassword } });
      expect(named('menu.setPassword')).toBeUndefined(); // closed until the chip is pressed
      openAccount();
      expect(named('menu.changePassword')).toBeUndefined();
      named('menu.setPassword')?.click();
      expect(onpassword).toHaveBeenCalledOnce();
      void unmount(component ?? {});
      document.body.innerHTML = '';
      render({ hasPassword: true, handlers: { onpassword } });
      openAccount();
      expect(named('menu.setPassword')).toBeUndefined();
      named('menu.changePassword')?.click();
      expect(onpassword).toHaveBeenCalledTimes(2);
    });

    it('logs an account out at once', () => {
      const onlogout = vi.fn();
      render({ hasPassword: true, handlers: { onlogout } });
      openAccount();
      named('menu.logout')?.click();
      expect(onlogout).toHaveBeenCalledOnce();
    });

    it('warns a guest without a password before the logout, and lets them stay', () => {
      const onlogout = vi.fn();
      render({ hasPassword: false, handlers: { onlogout } });
      openAccount();
      named('menu.logout')?.click();
      flushSync();
      expect(onlogout).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain(translate('en', 'menu.logoutWarning'));
      named('menu.logoutCancel')?.click();
      flushSync();
      expect(document.body.textContent).not.toContain(translate('en', 'menu.logoutWarning'));
      named('menu.logout')?.click();
      flushSync();
      named('menu.logoutConfirm')?.click();
      expect(onlogout).toHaveBeenCalledOnce();
    });

    it('closes with Escape and with a click elsewhere', () => {
      render({ hasPassword: true });
      openAccount();
      expect(document.querySelector('[role=menu]')).not.toBeNull();
      press('Escape');
      expect(document.querySelector('[role=menu]')).toBeNull();
      openAccount();
      document.body.click();
      flushSync();
      expect(document.querySelector('[role=menu]')).toBeNull();
    });
  });
});
