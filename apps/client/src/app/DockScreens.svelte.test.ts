import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NEW_MAP, RANDOM_GENERATED, RANDOM_POOL, type Api, type Invite } from '../api/http.ts';
import { setLocale, translate, type MessageKey } from '../i18n/index.ts';
import BotScreen from './BotScreen.svelte';
import CreateScreen from './CreateScreen.svelte';
import { fakeMapApi, makeDock } from './dockTestKit.ts';
import InviteScreen from './InviteScreen.svelte';
import { DRAWING_SLOW_MS } from './waiting.ts';

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
        .fn<(level: string, map: string) => Promise<MessageKey | null>>()
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
        (r) => r.querySelector('.lv')?.textContent === en('bot.level.expert'),
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
      expect(document.body.querySelector('.sg [aria-checked="true"] .lv')?.textContent).toBe(
        en('bot.level.expert'),
      );
      expect(document.body.querySelector('.tiles [aria-checked="true"]')?.textContent).toContain(
        'ridge',
      );
      press('Enter');
      await settle();
      expect(onstart).toHaveBeenCalledTimes(2);
    });

    it('offers the generated maps as a group of their own, with a random one', async () => {
      const onstart = vi.fn(() => Promise.resolve(null));
      const { dock } = makeDock({}, fakeMapApi(['ridge', 'gen1-5', 'gen1-17']));
      component = mount(BotScreen, {
        target: document.body,
        props: { dock, onstart, onback: vi.fn() },
      });
      await settle();
      const radios = (selector: string): string[] =>
        [...document.body.querySelectorAll<HTMLElement>(`${selector} [role="radio"]`)].map(
          (r) => r.textContent,
        );
      // The new map, the random pool map and the pool; the random generated map and the generated.
      expect(radios('.tiles:not(.gen)')).toHaveLength(3);
      expect(radios('.tiles.gen')).toHaveLength(3);
      expect(document.body.textContent).toContain(en('map.generated'));
      document.body.querySelector<HTMLElement>('.tiles.gen [role="radio"]')?.click();
      flushSync();
      button(en('bot.start')).click();
      await settle();
      expect(onstart).toHaveBeenLastCalledWith('normal', RANDOM_GENERATED);
    });

    it('picks a new map by default and says the map is being drawn while the server makes it (#889)', async () => {
      const onstart = vi.fn(() => new Promise<null>(() => undefined));
      const { dock } = makeDock();
      component = mount(BotScreen, {
        target: document.body,
        props: { dock, onstart, onback: vi.fn() },
      });
      await settle();
      expect(document.body.querySelector('.tiles [aria-checked="true"]')?.textContent).toContain(
        en('map.new'),
      );
      button(en('bot.start')).click();
      await settle();
      expect(onstart).toHaveBeenCalledWith('normal', NEW_MAP);
      expect(document.body.querySelector('h2')?.textContent).toBe(en('wait.drawing'));
      const line = document.body.querySelector('[role="status"]');
      expect(line?.textContent).toContain(en('wait.line'));
      expect(line?.querySelector('.busy')).not.toBeNull();
      await vi.advanceTimersByTimeAsync(DRAWING_SLOW_MS);
      flushSync();
      expect(document.body.querySelector('[role="status"]')?.textContent).toContain(
        en('wait.slow'),
      );
    });

    it('leaves the wait with the message and the choices kept when the map takes too long', async () => {
      let answer: (key: MessageKey | null) => void = () => undefined;
      const onstart = vi.fn(
        () =>
          new Promise<MessageKey | null>((resolve) => {
            answer = resolve;
          }),
      );
      const { dock } = makeDock();
      component = mount(BotScreen, {
        target: document.body,
        props: { dock, onstart, onback: vi.fn() },
      });
      await settle();
      button(en('bot.start')).click();
      await settle();
      answer('error.bot.slow');
      await settle();
      expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
        en('error.bot.slow'),
      );
      expect(document.body.querySelector('h2')?.textContent).toBe(en('bot.pick'));
      expect(document.body.querySelector('.tiles [aria-checked="true"]')?.textContent).toContain(
        en('map.new'),
      );
    });

    it('starts at once from the bot offer of the queue', async () => {
      const onstart = vi.fn(() => new Promise<null>(() => undefined));
      const { dock } = makeDock();
      component = mount(BotScreen, {
        target: document.body,
        props: { dock, onstart, onback: vi.fn(), start: 'normal' },
      });
      await settle();
      expect(onstart).toHaveBeenCalledTimes(1);
      expect(onstart).toHaveBeenCalledWith('normal', NEW_MAP);
      expect(document.body.querySelector('h2')?.textContent).toBe(en('wait.drawing'));
    });

    it('names the style of every level, no description (Spare), and shows the seat while it starts', async () => {
      const { dock } = makeDock();
      component = mount(BotScreen, {
        target: document.body,
        props: { dock, onstart: () => new Promise<null>(() => undefined), onback: vi.fn() },
      });
      await settle();
      expect(document.body.querySelector('.sg [aria-checked="true"] .ls')?.textContent).toBe(
        en('bot.style.normal'),
      );
      expect(document.body.querySelectorAll('.sg .ls')).toHaveLength(4);
      expect(document.body.textContent).not.toContain(en('bot.desc.normal'));
      // A pool map: nothing to draw, "Starting...".
      [...document.body.querySelectorAll<HTMLElement>('.tiles [role="radio"]')]
        .find((r) => r.textContent.includes(en('map.random')))
        ?.click();
      flushSync();
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
        .fn<(map: string) => Promise<MessageKey | null>>()
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
      expect(oncreate).toHaveBeenCalledWith(NEW_MAP);
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

    it('offers the new map, the pool and the generated maps to a friend and to the lobby (#889)', async () => {
      const oncreate = vi.fn(() => Promise.resolve(null));
      const { dock } = makeDock({}, fakeMapApi(['ridge', 'gen1-5']));
      for (const isPublic of [true, false]) {
        component = mount(CreateScreen, {
          target: document.body,
          props: { dock, isPublic, oncreate, onback: vi.fn() },
        });
        await settle();
        expect(document.body.querySelectorAll('.tiles [role="radio"]')).toHaveLength(5);
        expect(document.body.querySelector('.tiles.gen')?.textContent).toContain('gen1-5');
        expect(document.body.querySelector('[aria-checked="true"]')?.textContent).toContain(
          en('map.new'),
        );
        [...document.body.querySelectorAll<HTMLElement>('.tiles [role="radio"]')]
          .find((r) => r.textContent.includes(en('map.random')))
          ?.click();
        flushSync();
        press('Enter');
        await settle();
        expect(oncreate).toHaveBeenLastCalledWith(RANDOM_POOL);
        void unmount(component);
        document.body.innerHTML = '';
      }
      component = undefined;
      expect(oncreate).toHaveBeenCalledTimes(2);
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
      expect(document.body.querySelectorAll('.tiles [role="radio"]')).toHaveLength(2);
      press('Enter');
      await settle();
      expect(oncreate).toHaveBeenCalledWith(NEW_MAP);
    });
  });

  describe('invite', () => {
    const invite = (over: Partial<Invite> = {}): Invite => ({
      code: 'abc',
      state: 'open',
      public: false,
      map_id: 'crossroads',
      map_ready: true,
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

    it('is locked: the rail and the chip are off, Esc leaves and drops the invite', async () => {
      const cancelInvite = vi.fn(() => Promise.resolve());
      const { onleave } = render({ invite: () => Promise.resolve(invite()), cancelInvite });
      await settle();
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

    it('says the map is being drawn until the poll says it is ready (#884)', async () => {
      let ready = false;
      const invites = vi.fn(() =>
        Promise.resolve(invite({ map_id: 'live-0123456789ab', map_ready: ready })),
      );
      render({ invite: invites });
      await settle();
      expect(document.body.textContent).toContain(en('invite.mapDrawing'));
      expect(document.body.querySelector('.status.drawing')?.textContent).toContain(
        en('wait.drawing'),
      );
      ready = true;
      await vi.advanceTimersByTimeAsync(1500);
      flushSync();
      expect(document.body.querySelector('.status.drawing')).toBeNull();
      expect(document.body.textContent).toContain('Map: live-0123456789ab');
      // The waiting room polls as before, no faster.
      expect(invites).toHaveBeenCalledTimes(2);
    });

    it('both ready on a map still being drawn: the match starts when it is', async () => {
      render({
        invite: () =>
          Promise.resolve(
            invite({
              state: 'joined',
              guest_nick: 'Vega',
              map_id: 'live-0123456789ab',
              map_ready: false,
              you_ready: true,
              opponent_ready: true,
            }),
          ),
      });
      await settle();
      expect(document.body.querySelector('h2')?.textContent).toBe(en('wait.drawing'));
      expect(document.body.querySelector('[role="status"]')?.textContent).toContain(
        en('invite.drawingStart'),
      );
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
      ['a guest', { hasPassword: false, calibration: null }],
      ['a calibrating account', { calibration: { played: 2, total: 5 } }],
      ['a rated account', { calibration: null }],
    ] as const)(
      'says every match here is unrated by its chip, with no caption, for %s (#845)',
      async (_who, over) => {
        mountBot(over);
        await settle();
        // The captions the chip replaced (their dictionary entries are gone, #896).
        expect(document.body.textContent).not.toContain('Unrated, like every match');
        expect(document.body.textContent).not.toContain('Unrated: ');
        expect(document.body.querySelector('.panel .tags')?.textContent).toContain(
          en('dock.chip.unrated'),
        );
      },
    );

    it('adds the queue lock: a chip with the time and the line, bots stay open', async () => {
      mountBot({ banUntil: 287_000, now: () => 0 });
      await settle();
      expect(document.body.querySelector('.chip.ban')?.textContent).toContain('Queue locked 4:47');
      expect(document.body.querySelector('.panel')?.textContent).toContain(en('dock.banLine'));
      expect(button(en('bot.start')).disabled).toBe(false);
    });

    it('has no key hints anywhere and no letter keys on the rail (#629)', async () => {
      const calls = mountBot({});
      await settle();
      expect(document.body.querySelector('kbd')).toBeNull();
      expect(document.body.querySelectorAll('.rail .row')).toHaveLength(3);
      for (const key of ['b', 'i', 'l', 'r', 't', 'h']) press(key);
      expect(calls.oncreate).not.toHaveBeenCalled();
      expect(calls.onlobby).not.toHaveBeenCalled();
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
