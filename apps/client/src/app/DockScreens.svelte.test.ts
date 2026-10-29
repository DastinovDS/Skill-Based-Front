import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api, Invite } from '../api/http.ts';
import { setLocale, translate, type MessageKey } from '../i18n/index.ts';
import BotScreen from './BotScreen.svelte';
import CreateScreen from './CreateScreen.svelte';
import { makeDock } from './dockTestKit.ts';
import InviteScreen from './InviteScreen.svelte';

// The Dock screens (#473) apart from the lobby: the create, bot and invite panels, the account
// notes, the queue lock and the keys of the rail.
const en = (key: MessageKey): string => translate('en', key);

describe('the Dock screens', () => {
  let component: Record<string, unknown> | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    setLocale('en');
  });
  afterEach(() => {
    if (component !== undefined) void unmount(component);
    component = undefined;
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  async function settle(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
    flushSync();
  }
  const press = (key: string): void => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    flushSync();
  };
  const button = (name: string): HTMLButtonElement => {
    const found = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent.trim().startsWith(name),
    );
    if (found === undefined) throw new Error(`no button "${name}"`);
    return found;
  };

  describe('bot', () => {
    it('starts with the chosen level and map and keeps them when the server refuses', async () => {
      const onstart = vi
        .fn<(level: string, map: string | null) => Promise<MessageKey | null>>()
        .mockResolvedValueOnce('error.api.unavailable')
        .mockResolvedValue(null);
      const { dock } = makeDock();
      component = mount(BotScreen, {
        target: document.body,
        props: { dock, onstart, onback: vi.fn() },
      });
      await settle();
      document.body.querySelector<HTMLElement>('[role="radio"][aria-checked="false"]')?.click();
      flushSync();
      const level = [...document.body.querySelectorAll<HTMLElement>('.sg [role="radio"]')].find(
        (r) => r.textContent === en('bot.level.expert'),
      );
      level?.click();
      flushSync();
      const ridge = [...document.body.querySelectorAll<HTMLElement>('.tiles [role="radio"]')].find(
        (r) => r.textContent.includes('ridge'),
      );
      ridge?.click();
      flushSync();
      button(en('bot.start')).click();
      await settle();
      expect(onstart).toHaveBeenCalledWith('expert', 'ridge');
      expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
        en('error.api.unavailable'),
      );
      // The choices are still there, on the same screen.
      expect(document.body.querySelector('.sg [aria-checked="true"]')?.textContent).toBe(
        en('bot.level.expert'),
      );
      expect(document.body.querySelector('.tiles [aria-checked="true"]')?.textContent).toContain(
        'ridge',
      );
      press('Enter');
      await settle();
      expect(onstart).toHaveBeenCalledTimes(2);
    });

    it('describes the style of the chosen bot, and shows the seat while it starts', async () => {
      const { dock } = makeDock();
      component = mount(BotScreen, {
        target: document.body,
        props: { dock, onstart: () => new Promise<null>(() => undefined), onback: vi.fn() },
      });
      await settle();
      expect(document.body.querySelector('.lvdesc')?.textContent).toContain(en('bot.style.normal'));
      expect(document.body.querySelector('.lvdesc')?.textContent).toContain(en('bot.desc.normal'));
      button(en('bot.start')).click();
      await settle();
      expect(document.body.querySelector('h2')?.textContent).toBe(en('bot.starting'));
      expect(document.body.querySelector('.vs')?.textContent).toContain('Normal bot');
      // The rail is off while the match starts.
      expect(button(en('menu.lobby')).disabled).toBe(true);
    });
  });

  describe('create', () => {
    it('creates with the chosen map and answers a failure on the screen', async () => {
      const oncreate = vi
        .fn<(map: string | null) => Promise<MessageKey | null>>()
        .mockResolvedValueOnce('error.api.network')
        .mockResolvedValue(null);
      const { dock } = makeDock();
      component = mount(CreateScreen, {
        target: document.body,
        props: { dock, oncreate, onback: vi.fn() },
      });
      await settle();
      expect(document.body.querySelector('h2')?.textContent).toBe(en('create.title'));
      expect(document.body.textContent).toContain(en('dock.chip.pause'));
      button(en('create.submit')).click();
      await settle();
      expect(oncreate).toHaveBeenCalledWith(null);
      expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
        en('error.api.network'),
      );
      button(en('create.submit')).click();
      await settle();
      expect(oncreate).toHaveBeenCalledTimes(2);
      expect(document.body.querySelector('[role="alert"]')).toBeNull();
    });

    it('marks the lobby row and promises no pauses for a public match', async () => {
      const { dock } = makeDock();
      component = mount(CreateScreen, {
        target: document.body,
        props: { dock, isPublic: true, oncreate: vi.fn(), onback: vi.fn() },
      });
      await settle();
      expect(document.body.querySelector('.rail .row.cur')?.textContent).toContain(
        en('menu.lobby'),
      );
      expect(document.body.textContent).toContain(en('dock.chip.noPause'));
    });

    it('says the map list did not load and still creates a random match', async () => {
      const { dock } = makeDock({}, { maps: () => Promise.reject(new Error('down')) });
      const oncreate = vi.fn(() => Promise.resolve(null));
      component = mount(CreateScreen, {
        target: document.body,
        props: { dock, oncreate, onback: vi.fn() },
      });
      await settle();
      expect(document.body.textContent).toContain(en('map.listFailed'));
      expect(document.body.querySelectorAll('.tiles [role="radio"]')).toHaveLength(1);
      press('Enter');
      await settle();
      expect(oncreate).toHaveBeenCalledWith(null);
    });
  });

  describe('invite', () => {
    const invite = (over: Partial<Invite> = {}): Invite => ({
      code: 'abc',
      state: 'open',
      public: false,
      map_id: 'crossroads',
      host_nick: 'Me',
      guest_nick: null,
      you_ready: false,
      opponent_ready: false,
      expires_in_s: 1800,
      match_id: null,
      ...over,
    });

    function render(api: Partial<Api>, onleave = vi.fn()) {
      const made = makeDock();
      component = mount(InviteScreen, {
        target: document.body,
        props: {
          api: api as Api,
          token: 't',
          nick: 'Me',
          code: 'abc',
          dock: made.dock,
          onstart: vi.fn(),
          onleave,
          pollMs: 1500,
        },
      });
      return { ...made, onleave };
    }

    it('shows the link of a private invite, the empty seat and the expiry', async () => {
      render({ invite: () => Promise.resolve(invite()) });
      await settle();
      expect(document.body.querySelector('h2')?.textContent).toBe(en('invite.sendLink'));
      const field = document.body.querySelector<HTMLInputElement>('input[readonly]');
      expect(field?.value).toMatch(/\/\?m=abc$/);
      expect(document.body.querySelector('.vs')?.textContent).toContain(en('invite.seatWaiting'));
      expect(document.body.textContent).toContain('The invite expires in 30 min.');
    });

    it('lists a public invite in the lobby and marks the lobby row', async () => {
      render({ invite: () => Promise.resolve(invite({ public: true })) });
      await settle();
      expect(document.body.querySelector('h2')?.textContent).toBe(en('invite.listed'));
      expect(document.body.querySelector('input[readonly]')).toBeNull();
      expect(document.body.querySelector('.rail .row.cur')?.textContent).toContain(
        en('menu.lobby'),
      );
      expect(document.body.textContent).toContain(en('dock.chip.noPause'));
    });

    it('is locked: B, I and L do nothing, the rail and the chip are off, Esc leaves and drops the invite', async () => {
      const cancelInvite = vi.fn(() => Promise.resolve());
      const { calls, onleave } = render({ invite: () => Promise.resolve(invite()), cancelInvite });
      await settle();
      for (const key of ['b', 'i', 'l', 'B']) press(key);
      expect(calls.onbot).not.toHaveBeenCalled();
      expect(calls.oncreate).not.toHaveBeenCalled();
      expect(calls.onlobby).not.toHaveBeenCalled();
      expect(button(en('menu.bot')).disabled).toBe(true);
      expect(button(en('menu.lobby')).disabled).toBe(true);
      expect(document.body.querySelector<HTMLButtonElement>('button.who')?.disabled).toBe(true);
      press('Escape');
      expect(cancelInvite).toHaveBeenCalledWith('t', 'abc');
      expect(onleave).toHaveBeenCalledWith(null);
    });

    it('shows the opponent, the ready dots and presses Ready with the button or Enter', async () => {
      const readyInvite = vi.fn(() =>
        Promise.resolve(invite({ state: 'joined', guest_nick: 'Vega', you_ready: true })),
      );
      render({
        invite: () => Promise.resolve(invite({ state: 'joined', guest_nick: 'Vega' })),
        readyInvite,
      });
      await settle();
      expect(document.body.querySelector('h2')?.textContent).toBe('Vega joined');
      expect(document.body.textContent).toContain(en('invite.pressReady'));
      expect(document.body.querySelectorAll('.vs small.y')).toHaveLength(0);
      press('Enter');
      await settle();
      expect(readyInvite).toHaveBeenCalledTimes(1);
      expect(document.body.textContent).toContain(en('invite.youReady'));
      expect(document.body.querySelectorAll('.vs small.y')).toHaveLength(1);
      expect(button(en('invite.ready')).disabled).toBe(true);
    });

    it('says "Starting..." when both are ready', async () => {
      render({
        invite: () =>
          Promise.resolve(
            invite({ state: 'joined', guest_nick: 'Vega', you_ready: true, opponent_ready: true }),
          ),
      });
      await settle();
      expect(document.body.querySelector('h2')?.textContent).toBe(en('bot.starting'));
      expect(document.body.querySelectorAll('.vs small.y')).toHaveLength(2);
    });

    it('goes back to the menu with a notice when the invite is gone', async () => {
      const { ApiError } = await import('../api/http.ts');
      const { onleave } = render({ invite: () => Promise.reject(new ApiError('not_found', 404)) });
      await settle();
      expect(onleave).toHaveBeenCalledWith('error.invite.expired');
    });
  });

  describe('the frame', () => {
    const mountBot = (over: Parameters<typeof makeDock>[0]) => {
      const { dock, calls } = makeDock(over);
      component = mount(BotScreen, {
        target: document.body,
        props: { dock, onstart: vi.fn(), onback: vi.fn() },
      });
      return calls;
    };

    it.each([
      ['a guest', { hasPassword: false, calibration: null }, 'dock.unrated.guest'],
      [
        'a calibrating account',
        { calibration: { played: 2, total: 5 } },
        'dock.unrated.calibration',
      ],
      ['a rated account', { calibration: null }, 'dock.unrated.rated'],
    ] as const)('says every match here is unrated for %s', async (_who, over, key) => {
      mountBot(over);
      await settle();
      expect(document.body.querySelector('.panel .note')?.textContent).toBe(en(key));
      expect(document.body.querySelector('.panel .tags')?.textContent).toContain(
        en('dock.chip.unrated'),
      );
    });

    it('adds the queue lock: a chip with the time, the lock block and the line, bots stay open', async () => {
      mountBot({ banUntil: 287_000, now: () => 0 });
      await settle();
      expect(document.body.querySelector('.chip.ban')?.textContent).toContain('Queue locked 4:47');
      expect(document.body.querySelector('.rail .eyebrow.warn')?.textContent).toBe(
        en('menu.eyebrow.banned'),
      );
      expect(document.body.querySelector('.panel')?.textContent).toContain(en('dock.banLine'));
      expect(button(en('bot.start')).disabled).toBe(false);
    });

    it('opens the other modes with B, I and L and ignores the key of the mode it is in', async () => {
      const calls = mountBot({});
      await settle();
      press('i');
      expect(calls.oncreate).toHaveBeenCalledTimes(1);
      press('l');
      expect(calls.onlobby).toHaveBeenCalledTimes(1);
      press('b');
      expect(calls.onbot).not.toHaveBeenCalled();
    });

    it('leaves the keys to a focused field or button', async () => {
      const calls = mountBot({});
      await settle();
      const start = button(en('bot.start'));
      start.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'i', bubbles: true, cancelable: true }),
      );
      expect(calls.oncreate).not.toHaveBeenCalled();
    });

    it('Play, dimmed, is the way back to the menu', async () => {
      const calls = mountBot({});
      await settle();
      document.body.querySelector<HTMLButtonElement>('.big.dim')?.click();
      expect(calls.onmenu).toHaveBeenCalledTimes(1);
    });
  });
});
