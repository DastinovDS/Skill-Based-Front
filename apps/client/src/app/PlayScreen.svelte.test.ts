import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NEW_MAP, RANDOM_POOL, type Api, type Invite } from '../api/http.ts';
import { setLocale, translate, type MessageKey } from '../i18n/index.ts';
import type { PlayContext, PlayState } from './play.ts';
import PlayScreen from './PlayScreen.svelte';
import { fakeMapApi, makePlay } from './playTestKit.ts';

// The main screen of direction III Plinth (#919): the ways, the word of the main button, the bot
// drawer and its map picker, the invite's link and Ready, and no rating anywhere.
const en = (key: MessageKey): string => translate('en', key);

describe('PlayScreen (#919, III Plinth)', () => {
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
  const radio = (name: string): HTMLButtonElement | undefined =>
    [...document.body.querySelectorAll<HTMLButtonElement>('[role=radio]')].find(
      (b) => (b.querySelector('.sl, .tl, .lv')?.textContent ?? b.textContent).trim() === name,
    );

  function render(state: PlayState, ctx: PlayContext, notice: MessageKey | null = null) {
    component = mount(PlayScreen, { target: document.body, props: { ctx, view: state, notice } });
    flushSync();
  }

  describe('the ways', () => {
    it.each([
      ['match', 'play.go.search', 'dock.chip.noPause'],
      ['bot', 'bot.start', 'dock.chip.pause'],
      ['friend', 'play.go.link', 'dock.chip.pause'],
    ] as const)('way %s: the main button says what happens next', async (way, verb, pause) => {
      render({ name: 'menu', way }, makePlay().ctx);
      await settle();
      expect(document.querySelector('.go')?.textContent.trim()).toBe(en(verb));
      expect(document.querySelector('.optl')?.textContent).toContain(en(pause));
      const chosen = document.querySelector('.segs [aria-checked="true"]');
      expect(chosen?.textContent).toContain(
        en(way === 'match' ? 'play.way.match' : way === 'bot' ? 'menu.bot' : 'menu.create'),
      );
    });

    it('chooses a way by a click and by the arrow keys', async () => {
      const { ctx, calls } = makePlay();
      render({ name: 'menu' }, ctx);
      await settle();
      radio(en('menu.bot'))?.click();
      expect(calls.onway).toHaveBeenCalledWith('bot');
      document
        .querySelector('[role=radiogroup]')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      expect(calls.onway).toHaveBeenLastCalledWith('bot');
    });

    it('Search and Enter go to the queue', async () => {
      const { ctx, calls } = makePlay();
      render({ name: 'menu' }, ctx);
      await settle();
      button(en('play.go.search')).click();
      press('Enter');
      expect(calls.onsearch).toHaveBeenCalledTimes(2);
    });

    it('shows "Guest" beside the nick and no rating or "Unrated" anywhere', async () => {
      render({ name: 'menu' }, makePlay().ctx);
      await settle();
      expect(document.querySelector('button.who')?.textContent).toContain(en('menu.guest'));
      expect(document.body.textContent).not.toMatch(
        /unrated|rating|calibration|leaderboard|open matches/i,
      );
    });

    it('an account shows the nick alone; the nick opens the profile, "?" How to play', async () => {
      const { ctx, calls } = makePlay({ hasPassword: true });
      render({ name: 'menu' }, ctx);
      await settle();
      const who = document.querySelector<HTMLButtonElement>('button.who');
      expect(who?.textContent.trim()).toBe('Me');
      who?.click();
      document.querySelector<HTMLButtonElement>('button.qm')?.click();
      expect(calls.onprofile).toHaveBeenCalledOnce();
      expect(calls.onhelp).toHaveBeenCalledOnce();
    });

    it('a running match turns the main button into Return', async () => {
      const { ctx, calls } = makePlay({ hasActiveMatch: true });
      render({ name: 'menu' }, ctx);
      await settle();
      button(en('menu.resume')).click();
      expect(calls.onresume).toHaveBeenCalledOnce();
      expect(radio(en('menu.bot'))?.disabled).toBe(true);
    });

    it('a locked queue disables Search and counts down on the options line (DEC-34)', async () => {
      render({ name: 'menu' }, makePlay({ banUntil: 287_000, now: () => 0 }).ctx);
      await settle();
      expect(button(en('play.go.search')).disabled).toBe(true);
      expect(document.querySelector('.optl [role=timer]')?.textContent).toContain('4:47');
    });

    it('shows a notice of the app above the plinth', async () => {
      render({ name: 'menu' }, makePlay().ctx, 'error.queue.dropped');
      await settle();
      expect(document.querySelector('.alert')?.textContent).toContain(en('error.queue.dropped'));
    });
  });

  describe('Play a bot', () => {
    it('opens the level and map drawer at once, with no option dropdowns on the plinth', async () => {
      render({ name: 'menu', way: 'bot' }, makePlay().ctx);
      await settle();
      expect(document.querySelector('.drw')).not.toBeNull();
      expect(document.querySelector('.plinth .opt')).toBeNull();
      expect(document.querySelector('.plinth select')).toBeNull();
    });

    it('offers New map (chosen), Random map and the pool maps, not the stored generated ones', async () => {
      render(
        { name: 'menu', way: 'bot' },
        makePlay({}, fakeMapApi(['crossroads', 'ridge', 'gen1-17'])).ctx,
      );
      await settle();
      const tiles = [...document.querySelectorAll('.tiles [role=radio] .tl')].map((b) =>
        b.textContent.trim(),
      );
      expect(tiles).toEqual([en('map.new'), en('map.random'), 'crossroads', 'ridge']);
      expect(radio(en('map.new'))?.getAttribute('aria-checked')).toBe('true');
    });

    it('starts with the chosen level and map, then shows the drawing in the plinth', async () => {
      const { ctx, calls } = makePlay();
      render({ name: 'menu', way: 'bot' }, ctx);
      await settle();
      radio(en('bot.level.easy'))?.click();
      flushSync();
      button(en('bot.start')).click();
      flushSync();
      expect(calls.onbot).toHaveBeenCalledWith('easy', NEW_MAP);
      expect(document.querySelector('.drw')).toBeNull();
      expect(document.querySelector('.plinth [role=status]')?.textContent).toContain(
        en('wait.drawing'),
      );
      expect(document.querySelector('.plinth .vs')?.textContent).toContain('Easy bot');
      expect(button(en('bot.start')).disabled).toBe(true);
    });

    it('a random pool map says Starting, not drawing', async () => {
      const { ctx, calls } = makePlay();
      render({ name: 'menu', way: 'bot' }, ctx);
      await settle();
      radio(en('map.random'))?.click();
      flushSync();
      button(en('bot.start')).click();
      flushSync();
      expect(calls.onbot).toHaveBeenCalledWith('normal', RANDOM_POOL);
      expect(document.querySelector('.plinth [role=status]')?.textContent).toContain(
        en('bot.starting'),
      );
    });

    it('a failure brings the drawer back with the line and the choices kept', async () => {
      const onbot = vi.fn(() => Promise.resolve<MessageKey>('error.api.unavailable'));
      render({ name: 'menu', way: 'bot' }, makePlay({ onbot }).ctx);
      await settle();
      radio(en('bot.level.hard'))?.click();
      button(en('bot.start')).click();
      await settle();
      expect(document.querySelector('.alert')?.textContent).toContain(en('error.api.unavailable'));
      expect(radio(en('bot.level.hard'))?.getAttribute('aria-checked')).toBe('true');
    });

    it('starts at once from the bot offer of the queue', async () => {
      const { ctx, calls } = makePlay();
      render({ name: 'menu', way: 'bot', start: 'normal' }, ctx);
      await settle();
      expect(calls.onbot).toHaveBeenCalledWith('normal', NEW_MAP);
    });
  });

  describe('Invite a friend', () => {
    const invite = (over: Partial<Invite> = {}): Invite => ({
      code: 'abc',
      state: 'open',
      public: false,
      map_id: 'live-0123456789ab',
      map_ready: false,
      host_nick: 'Me',
      guest_nick: null,
      you_ready: false,
      opponent_ready: false,
      expires_in_s: 1800,
      match_id: null,
      ...over,
    });

    function renderInvite(api: Partial<Api>) {
      const made = makePlay({}, { ...fakeMapApi(), ...api });
      render({ name: 'invite', code: 'abc' }, made.ctx);
      return made;
    }

    it('Get the link asks for an invite and greys while it does', async () => {
      const { ctx, calls } = makePlay();
      render({ name: 'menu', way: 'friend' }, ctx);
      await settle();
      button(en('play.go.link')).click();
      flushSync();
      expect(calls.oninvite).toHaveBeenCalledOnce();
      expect(button(en('play.go.link')).disabled).toBe(true);
      expect(document.querySelector('.plinth .vs')?.textContent).toContain(en('invite.aFriend'));
    });

    it('shows the link at once, while the map is still being drawn (variant C)', async () => {
      renderInvite({ invite: () => Promise.resolve(invite()) });
      await settle();
      const field = document.querySelector<HTMLInputElement>('#invite-link');
      expect(field?.value).toMatch(/\/\?m=abc$/);
      expect(document.querySelector('.plinth [role=status]')?.textContent).toContain(
        en('wait.drawing'),
      );
      expect(button(en('invite.copy'))).toBeDefined();
      expect(document.body.textContent).toContain('Expires in 30 min');
    });

    it('waits for a friend once the map is there', async () => {
      renderInvite({ invite: () => Promise.resolve(invite({ map_ready: true })) });
      await settle();
      expect(document.querySelector('.plinth [role=status]')?.textContent).toContain(
        en('invite.waiting'),
      );
    });

    it('locks the bar; Esc leaves and drops the invite', async () => {
      const cancelInvite = vi.fn(() => Promise.resolve());
      const { calls } = renderInvite({ invite: () => Promise.resolve(invite()), cancelInvite });
      await settle();
      expect(document.querySelector<HTMLButtonElement>('button.who')?.disabled).toBe(true);
      press('Escape');
      expect(cancelInvite).toHaveBeenCalledWith('t', 'abc');
      expect(calls.onleave).toHaveBeenCalledWith(null, 'friend');
    });

    it('a friend joined: the versus line and Ready, by the button or Enter', async () => {
      const readyInvite = vi.fn(() =>
        Promise.resolve(invite({ state: 'joined', guest_nick: 'Vega', you_ready: true })),
      );
      renderInvite({
        invite: () => Promise.resolve(invite({ state: 'joined', guest_nick: 'Vega' })),
        readyInvite,
      });
      await settle();
      expect(document.querySelector('.plinth .label')?.textContent).toBe('Vega joined');
      expect(document.querySelector('#invite-link')).toBeNull();
      press('Enter');
      await settle();
      expect(readyInvite).toHaveBeenCalledOnce();
      expect(document.querySelector('.plinth .label')?.textContent).toBe(en('invite.youReady'));
      expect(button(en('invite.ready')).disabled).toBe(true);
    });

    it('both ready on a map still being drawn: the match starts when it is', async () => {
      renderInvite({
        invite: () =>
          Promise.resolve(
            invite({ state: 'joined', guest_nick: 'Vega', you_ready: true, opponent_ready: true }),
          ),
      });
      await settle();
      expect(document.querySelector('.plinth .end [role=status]')?.textContent).toContain(
        en('invite.drawingStart'),
      );
    });

    it('goes back with a notice when the invite is gone', async () => {
      const { ApiError } = await import('../api/http.ts');
      const { calls } = renderInvite({
        invite: () => Promise.reject(new ApiError('not_found', 404)),
      });
      await settle();
      expect(calls.onleave).toHaveBeenCalledWith('error.invite.expired', 'friend');
    });
  });
});
