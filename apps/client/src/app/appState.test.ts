import { describe, expect, it, vi } from 'vitest';
import { Api, ApiError, type Invite, type PlayerProfile } from '../api/http.ts';
import { GUEST_STORAGE_KEY } from '../api/guestStore.ts';
import type { MatchEndMsg } from '../protocol.gen.ts';
import { AppState } from './appState.svelte.ts';

const invite = (code: string): Invite => ({
  code,
  state: 'joined',
  public: false,
  map_id: 'pass',
  host_nick: 'Host',
  guest_nick: 'Guest',
  you_ready: false,
  opponent_ready: false,
  expires_in_s: 100,
  match_id: null,
});

function memory(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  } as unknown as Storage;
}

function setup(search: string, storage = memory(), api: Partial<Api> = {}) {
  const replaceUrl = vi.fn();
  const app = new AppState({
    api: api as Api,
    storage: () => storage,
    location: { search, pathname: '/', hash: '' },
    replaceUrl,
  });
  return { app, storage, replaceUrl };
}

describe('AppState', () => {
  it('opens the nick form for a new visitor', async () => {
    const { app } = setup('');
    await app.start();
    expect(app.screen.name).toBe('welcome');
  });

  it('link, nick, waiting room: the invite is joined right after the nick form', async () => {
    const joinInvite = vi.fn(() => Promise.resolve(invite('abc')));
    const { app, replaceUrl, storage } = setup('?m=abc&x=1', memory(), {
      createGuest: () => Promise.resolve({ playerId: 2, token: 'tok' }),
      joinInvite,
    });
    await app.start();
    expect(app.screen.name).toBe('welcome');
    expect(app.pendingInvite).toBe('abc');
    // The code leaves the address bar, other parameters stay.
    expect(replaceUrl).toHaveBeenCalledWith('/?x=1');
    await app.register('Guest');
    expect(joinInvite).toHaveBeenCalledWith('tok', 'abc');
    expect(app.screen).toEqual({ name: 'invite', code: 'abc' });
    expect(app.pendingInvite).toBeNull();
    expect(storage.getItem(GUEST_STORAGE_KEY)).toContain('tok');
  });

  it('keeps the nick form and shows why when the nick is taken', async () => {
    const { app } = setup('', memory(), {
      createGuest: () => Promise.reject(new ApiError('conflict', 409)),
    });
    await app.start();
    await app.register('Taken');
    expect(app.screen.name).toBe('welcome');
    expect(app.notice).toBe('error.api.conflict');
  });

  it('goes straight to the menu with a saved guest, and checks it with the server', async () => {
    const storage = memory({ [GUEST_STORAGE_KEY]: '{"token":"t","nick":"Old"}' });
    const { app } = setup('', storage, {
      me: () => Promise.resolve({ player_id: 1, nick: 'Old', has_password: false }),
    });
    await app.start();
    expect(app.screen.name).toBe('menu');
    expect(app.guest?.nick).toBe('Old');
  });

  it('forgets a guest the server does not know', async () => {
    const storage = memory({ [GUEST_STORAGE_KEY]: '{"token":"t","nick":"Old"}' });
    const { app } = setup('', storage, {
      me: () => Promise.reject(new ApiError('unauthorized', 401)),
    });
    await app.start();
    expect(app.screen.name).toBe('welcome');
    expect(storage.getItem(GUEST_STORAGE_KEY)).toBeNull();
  });

  it('opens your own invite link as the waiting room instead of failing the join', async () => {
    const storage = memory({ [GUEST_STORAGE_KEY]: '{"token":"t","nick":"Host"}' });
    const { app } = setup('?m=abc', storage, {
      me: () => Promise.resolve({ player_id: 1, nick: 'Host', has_password: false }),
      joinInvite: () => Promise.reject(new ApiError('conflict', 409)),
      invite: () => Promise.resolve(invite('abc')),
    });
    await app.start();
    expect(app.screen).toEqual({ name: 'invite', code: 'abc' });
  });

  it('falls back to the menu with a message when the invite is full or gone', async () => {
    const storage = memory({ [GUEST_STORAGE_KEY]: '{"token":"t","nick":"Me"}' });
    const full = setup('?m=abc', storage, {
      me: () => Promise.resolve({ player_id: 1, nick: 'Me', has_password: false }),
      joinInvite: () => Promise.reject(new ApiError('conflict', 409)),
      invite: () => Promise.reject(new ApiError('not_found', 404)),
    });
    await full.app.start();
    expect(full.app.screen.name).toBe('menu');
    expect(full.app.notice).toBe('error.invite.full');
    const gone = setup('?m=abc', storage, {
      me: () => Promise.resolve({ player_id: 1, nick: 'Me', has_password: false }),
      joinInvite: () => Promise.reject(new ApiError('not_found', 404)),
    });
    await gone.app.start();
    expect(gone.app.screen.name).toBe('menu');
    expect(gone.app.notice).toBe('error.api.not_found');
  });

  it('returns to the running match after a reload, before the invite and the menu (#189)', async () => {
    const storage = memory({ [GUEST_STORAGE_KEY]: '{"token":"t","nick":"Me"}' });
    const joinInvite = vi.fn(() => Promise.resolve(invite('abc')));
    const activeMatch = vi.fn(() => Promise.resolve({ match_id: '42', map_id: 'pass' }));
    const { app } = setup('?m=abc', storage, {
      me: () => Promise.resolve({ player_id: 1, nick: 'Me', has_password: false }),
      activeMatch,
      joinInvite,
    });
    await app.start();
    expect(activeMatch).toHaveBeenCalledWith('t');
    expect(app.screen).toEqual({ name: 'match', matchId: '42', mapId: 'pass' });
    expect(joinInvite).not.toHaveBeenCalled();
    expect(app.pendingInvite).toBeNull();
  });

  it('opens the menu when there is no running match or the question fails', async () => {
    const storage = memory({ [GUEST_STORAGE_KEY]: '{"token":"t","nick":"Me"}' });
    const me = () => Promise.resolve({ player_id: 1, nick: 'Me', has_password: false });
    const none = setup('', storage, { me, activeMatch: () => Promise.resolve(null) });
    await none.app.start();
    expect(none.app.screen.name).toBe('menu');
    expect(none.app.activeMatch).toBeNull();
    const down = setup('', storage, {
      me,
      activeMatch: () => Promise.reject(new ApiError('network', 0)),
    });
    await down.app.start();
    expect(down.app.screen.name).toBe('menu');
  });

  it('remembers the running match for the menu and resumes it', async () => {
    const storage = memory({ [GUEST_STORAGE_KEY]: '{"token":"t","nick":"Me"}' });
    const running = { match_id: '7', map_id: 'line3' };
    const activeMatch = vi
      .fn<() => Promise<typeof running | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValue(running);
    const { app } = setup('', storage, {
      me: () => Promise.resolve({ player_id: 1, nick: 'Me', has_password: false }),
      activeMatch,
    });
    await app.start();
    expect(app.screen.name).toBe('menu');
    await app.refreshActiveMatch();
    expect(app.activeMatch).toEqual(running);
    app.resumeMatch(running);
    expect(app.screen).toEqual({ name: 'match', matchId: '7', mapId: 'line3' });
  });

  it('creates an invite and a bot match, and moves on to the right screens', async () => {
    const storage = memory({ [GUEST_STORAGE_KEY]: '{"token":"t","nick":"Me"}' });
    const createBotMatch = vi.fn(() =>
      Promise.resolve({ match_id: 'm1', map_id: 'pass', level: 'hard' as const, player: 0 }),
    );
    const { app } = setup('', storage, {
      me: () => Promise.resolve({ player_id: 1, nick: 'Me', has_password: false }),
      createInvite: () => Promise.resolve(invite('xyz')),
      createBotMatch,
    });
    await app.start();
    await app.createInvite(null);
    expect(app.screen).toEqual({ name: 'invite', code: 'xyz' });
    await app.playBot('hard', 'pass');
    expect(createBotMatch).toHaveBeenCalledWith('t', 'hard', 'pass');
    expect(app.screen).toEqual({ name: 'match', matchId: 'm1', mapId: 'pass' });
  });

  it('creates a public match and goes to its waiting room', async () => {
    const createInvite = vi.fn(() => Promise.resolve({ ...invite('pub'), public: true }));
    const storage = memory({ [GUEST_STORAGE_KEY]: '{"token":"t","nick":"Old"}' });
    const { app } = setup('', storage, {
      me: () => Promise.resolve({ player_id: 1, nick: 'Old', has_password: false }),
      createInvite,
    });
    await app.start();
    await app.createInvite('pass', true);
    expect(createInvite).toHaveBeenCalledWith('t', 'pass', true);
    expect(app.screen).toEqual({ name: 'invite', code: 'pub' });
  });

  it('keeps a failed create or bot start on its screen and answers the line to show (#473)', async () => {
    const storage = memory({ [GUEST_STORAGE_KEY]: '{"token":"t","nick":"Me"}' });
    const { app } = setup('', storage, {
      me: () => Promise.resolve({ player_id: 1, nick: 'Me', has_password: false }),
      createInvite: () => Promise.reject(new ApiError('unavailable', 503)),
      createBotMatch: () => Promise.reject(new ApiError('network', 0)),
    });
    await app.start();
    app.go({ name: 'create', public: false });
    expect(await app.createInvite(null)).toBe('error.api.unavailable');
    expect(app.screen).toEqual({ name: 'create', public: false });
    app.go({ name: 'bot' });
    expect(await app.playBot('easy', null)).toBe('error.api.network');
    expect(app.screen).toEqual({ name: 'bot' });
    expect(app.notice).toBeNull();
  });

  it('starts over from the menu when the session is lost during a create (401)', async () => {
    const storage = memory({ [GUEST_STORAGE_KEY]: '{"token":"t","nick":"Me"}' });
    const { app } = setup('', storage, {
      me: () => Promise.resolve({ player_id: 1, nick: 'Me', has_password: false }),
      createInvite: () => Promise.reject(new ApiError('unauthorized', 401)),
    });
    await app.start();
    expect(await app.createInvite(null)).toBeNull();
    expect(app.screen.name).toBe('welcome');
    expect(app.notice).toBe('error.api.unauthorized');
  });

  it('"Back" from a replay opened on the result screen returns to that result screen (#259)', () => {
    const { app } = setup('');
    const end: MatchEndMsg = {
      type: 'match_end',
      tick: 100,
      reason: 'timer',
      winner: 0,
      vp: [3, 5],
      rating: null,
      rated: false,
      unrated_reason: 'casual',
      calibration: null,
    };
    app.finishMatch('7', 0, end);
    const result = app.screen;
    app.openReplay('7');
    expect(app.screen).toMatchObject({ name: 'replay', matchId: '7' });
    app.closeReplay();
    expect(app.screen).toBe(result); // the same result: the verdict and the rating are not lost
  });

  it('"Back" from a replay opened from nowhere goes to the menu', () => {
    const { app } = setup('');
    app.go({ name: 'replay', matchId: '7' });
    app.closeReplay();
    expect(app.screen.name).toBe('welcome'); // no guest here: the nick form is the menu's stand-in
  });

  describe('accounts (#374)', () => {
    const me = (nick: string, hasPassword: boolean) => () =>
      Promise.resolve({ player_id: 1, nick, has_password: hasPassword });
    const saved = (storage: Storage): unknown =>
      JSON.parse(storage.getItem(GUEST_STORAGE_KEY) ?? 'null');

    it('login: keeps the token and the real nick of the account, then opens the menu', async () => {
      const login = vi.fn(() => Promise.resolve({ playerId: 1, token: 'fresh' }));
      const { app, storage } = setup('', memory(), {
        login,
        me: me('RealNick', true),
        activeMatch: () => Promise.resolve(null),
      });
      await app.start();
      expect(await app.login('realnick', 'a long password')).toBeNull();
      expect(login).toHaveBeenCalledWith('realnick', 'a long password');
      expect(app.guest).toEqual({ token: 'fresh', nick: 'RealNick', hasPassword: true });
      expect(saved(storage)).toEqual({ token: 'fresh', nick: 'RealNick', hasPassword: true });
      expect(app.screen.name).toBe('menu');
    });

    it('login: a wrong nick or password stays on the form and saves nothing', async () => {
      const { app, storage } = setup('', memory(), {
        login: () => Promise.reject(new ApiError('unauthorized', 401)),
      });
      await app.start();
      expect(await app.login('nick', 'bad password')).toEqual({ key: 'error.account.wrongLogin' });
      expect(app.guest).toBeNull();
      expect(app.screen.name).toBe('welcome');
      expect(storage.getItem(GUEST_STORAGE_KEY)).toBeNull();
    });

    it('login: an invite link opened before it is joined right after', async () => {
      const joinInvite = vi.fn(() => Promise.resolve(invite('abc')));
      const { app } = setup('?m=abc', memory(), {
        login: () => Promise.resolve({ playerId: 1, token: 'fresh' }),
        me: me('Nick', true),
        activeMatch: () => Promise.resolve(null),
        joinInvite,
      });
      await app.start();
      await app.login('Nick', 'a long password');
      expect(joinInvite).toHaveBeenCalledWith('fresh', 'abc');
      expect(app.screen).toEqual({ name: 'invite', code: 'abc' });
    });

    it('login: works with the typed nick when the nick lookup fails', async () => {
      const { app } = setup('', memory(), {
        login: () => Promise.resolve({ playerId: 1, token: 'fresh' }),
        me: () => Promise.reject(new ApiError('network', 0)),
        activeMatch: () => Promise.resolve(null),
      });
      await app.start();
      await app.login('Typed', 'a long password');
      expect(app.guest).toEqual({ token: 'fresh', nick: 'Typed', hasPassword: true });
    });

    it('registration: a guest, then its password; the NEW token is the one kept', async () => {
      const setPassword = vi.fn(() => Promise.resolve({ playerId: 2, token: 'renewed' }));
      const { app, storage } = setup('', memory(), {
        createGuest: () => Promise.resolve({ playerId: 2, token: 'first' }),
        setPassword,
        activeMatch: () => Promise.resolve(null),
      });
      await app.start();
      expect(await app.registerAccount('Newbie', 'a long password')).toBeNull();
      expect(setPassword).toHaveBeenCalledWith('first', 'a long password');
      expect(app.guest).toEqual({ token: 'renewed', nick: 'Newbie', hasPassword: true });
      expect(saved(storage)).toEqual({ token: 'renewed', nick: 'Newbie', hasPassword: true });
      expect(app.screen.name).toBe('menu');
    });

    it('registration: a taken nick fails before any password is sent', async () => {
      const setPassword = vi.fn();
      const { app, storage } = setup('', memory(), {
        createGuest: () => Promise.reject(new ApiError('conflict', 409)),
        setPassword,
      });
      await app.start();
      expect(await app.registerAccount('Taken', 'a long password')).toEqual({
        key: 'error.api.conflict',
      });
      expect(setPassword).not.toHaveBeenCalled();
      expect(storage.getItem(GUEST_STORAGE_KEY)).toBeNull();
      expect(app.screen.name).toBe('welcome');
    });

    it('registration: if only the password fails, the guest stays and the menu says so', async () => {
      const { app, storage } = setup('', memory(), {
        createGuest: () => Promise.resolve({ playerId: 2, token: 'first' }),
        setPassword: () => Promise.reject(new ApiError('rate_limited', 429, 60)),
        activeMatch: () => Promise.resolve(null),
      });
      await app.start();
      expect(await app.registerAccount('Newbie', 'a long password')).toBeNull();
      expect(app.guest).toEqual({ token: 'first', nick: 'Newbie', hasPassword: false });
      expect(saved(storage)).toEqual({ token: 'first', nick: 'Newbie', hasPassword: false });
      expect(app.screen.name).toBe('menu');
      expect(app.notice).toBe('error.account.registerNoPassword');
    });

    it('sets the password of a guest without an old one and saves the new token', async () => {
      const setPassword = vi.fn(() => Promise.resolve({ playerId: 1, token: 'renewed' }));
      const storage = memory({ [GUEST_STORAGE_KEY]: '{"token":"old","nick":"Me"}' });
      const { app } = setup('', storage, {
        me: me('Me', false),
        activeMatch: () => Promise.resolve(null),
        setPassword,
      });
      await app.start();
      expect(await app.setPassword('a long password', 'ignored')).toBeNull();
      expect(setPassword).toHaveBeenCalledWith('old', 'a long password', undefined);
      expect(app.guest).toEqual({ token: 'renewed', nick: 'Me', hasPassword: true });
      expect(saved(storage)).toEqual({ token: 'renewed', nick: 'Me', hasPassword: true });
    });

    it('changes the password with the old one; a wrong old one keeps the token', async () => {
      const setPassword = vi
        .fn<
          (
            token: string,
            password: string,
            old?: string,
          ) => Promise<{ playerId: number; token: string }>
        >()
        .mockRejectedValueOnce(new ApiError('wrong_password', 403))
        .mockResolvedValueOnce({ playerId: 1, token: 'renewed' });
      const storage = memory({
        [GUEST_STORAGE_KEY]: '{"token":"old","nick":"Me","hasPassword":true}',
      });
      const { app } = setup('', storage, {
        me: me('Me', true),
        activeMatch: () => Promise.resolve(null),
        setPassword,
      });
      await app.start();
      expect(await app.setPassword('another long one', 'wrong')).toEqual({
        key: 'error.api.wrong_password',
      });
      expect(app.guest?.token).toBe('old');
      expect(await app.setPassword('another long one', 'right one')).toBeNull();
      expect(setPassword).toHaveBeenLastCalledWith('old', 'another long one', 'right one');
      expect(app.guest?.token).toBe('renewed');
      expect(saved(storage)).toMatchObject({ token: 'renewed', hasPassword: true });
    });

    it('a password change with an unknown token forgets the guest', async () => {
      const storage = memory({ [GUEST_STORAGE_KEY]: '{"token":"old","nick":"Me"}' });
      const { app } = setup('', storage, {
        me: me('Me', false),
        activeMatch: () => Promise.resolve(null),
        setPassword: () => Promise.reject(new ApiError('unauthorized', 401)),
      });
      await app.start();
      expect(await app.setPassword('a long password', '')).toBeNull();
      expect(app.guest).toBeNull();
      expect(app.screen.name).toBe('welcome');
      expect(storage.getItem(GUEST_STORAGE_KEY)).toBeNull();
    });

    it('logout: the device forgets the token and shows the welcome screen', async () => {
      const storage = memory({
        [GUEST_STORAGE_KEY]: '{"token":"old","nick":"Me","hasPassword":true}',
      });
      const { app } = setup('', storage, {
        me: me('Me', true),
        activeMatch: () => Promise.resolve({ match_id: '1', map_id: 'pass' }),
      });
      await app.start();
      app.go({ name: 'menu' });
      app.logout();
      expect(app.guest).toBeNull();
      expect(app.activeMatch).toBeNull();
      expect(app.screen.name).toBe('welcome');
      expect(storage.getItem(GUEST_STORAGE_KEY)).toBeNull();
    });

    it('the token replaced by a login elsewhere is refused at the start: back to welcome with a note', async () => {
      const storage = memory({
        [GUEST_STORAGE_KEY]: '{"token":"stale","nick":"Me","hasPassword":true}',
      });
      const { app } = setup('', storage, {
        me: () => Promise.reject(new ApiError('unauthorized', 401)),
      });
      await app.start();
      expect(app.screen.name).toBe('welcome');
      expect(app.notice).toBe('error.api.unauthorized');
      expect(storage.getItem(GUEST_STORAGE_KEY)).toBeNull();
    });

    it('with the server unreachable at the start, the saved guest and its password flag stay', async () => {
      const storage = memory({
        [GUEST_STORAGE_KEY]: '{"token":"t","nick":"Me","hasPassword":true}',
      });
      const { app } = setup('', storage, {
        me: () => Promise.reject(new ApiError('network', 0)),
        activeMatch: () => Promise.resolve(null),
      });
      await app.start();
      expect(app.guest).toEqual({ token: 't', nick: 'Me', hasPassword: true });
    });
  });
  describe('the start menu (#471, DEC-34)', () => {
    const saved = () =>
      memory({ [GUEST_STORAGE_KEY]: '{"token":"t","nick":"Me","hasPassword":true}' });
    const meWith = (calibration: { played: number; total: number } | null) => () =>
      Promise.resolve({ player_id: 1, nick: 'Me', has_password: true, calibration });

    it('keeps the calibration of /api/me and asks for it again when the menu opens', async () => {
      let played = 2;
      const { app } = setup('', saved(), {
        me: () => meWith({ played, total: 5 })(),
        activeMatch: () => Promise.resolve(null),
      });
      await app.start();
      expect(app.calibration).toEqual({ played: 2, total: 5 });
      played = 3;
      await app.refreshProfile();
      expect(app.calibration).toEqual({ played: 3, total: 5 });
    });

    it('a failed refresh keeps what the chip showed', async () => {
      let fail = false;
      const { app } = setup('', saved(), {
        me: () =>
          fail ? Promise.reject(new ApiError('network', 0)) : meWith({ played: 1, total: 5 })(),
        activeMatch: () => Promise.resolve(null),
      });
      await app.start();
      fail = true;
      await app.refreshProfile();
      expect(app.calibration).toEqual({ played: 1, total: 5 });
    });

    it('counts the queue ban from now, and a logout forgets it with the calibration', async () => {
      const { app } = setup('', saved(), {
        me: meWith({ played: 1, total: 5 }),
        activeMatch: () => Promise.resolve(null),
      });
      await app.start();
      const before = Date.now();
      app.banQueue(287);
      expect(app.queueBanUntil).toBeGreaterThanOrEqual(before + 287_000);
      expect(app.queueBanUntil).toBeLessThanOrEqual(Date.now() + 287_000);
      app.logout();
      expect(app.queueBanUntil).toBeNull();
      expect(app.calibration).toBeNull();
    });

    it('draws the bundled menu map behind the screens without a request (#474)', async () => {
      const maps = vi.fn(() => Promise.resolve([]));
      const { app } = setup('', memory(), { maps });
      expect(app.backdrop.meta.name).toBe('valley');
      await app.start();
      expect(app.screen.name).toBe('welcome');
      expect(maps).not.toHaveBeenCalled();
    });
  });
  describe('the leaderboard and the rating of the chip (#78)', () => {
    const saved = () =>
      memory({ [GUEST_STORAGE_KEY]: '{"token":"t","nick":"Me","hasPassword":true}' });
    const profile = (rating: number | null) => () =>
      Promise.resolve({ player_id: 7, rating } as PlayerProfile);

    it('learns the own id and the displayed rating when the menu opens', async () => {
      const player = vi.fn(profile(1480));
      const { app } = setup('', saved(), {
        me: () => Promise.resolve({ player_id: 7, nick: 'Me', has_password: true }),
        activeMatch: () => Promise.resolve(null),
        player,
      });
      await app.start();
      expect(app.playerId).toBe(7);
      await app.refreshProfile();
      expect(app.rating).toBe(1480);
      expect(player).toHaveBeenCalledWith(7, 't');
    });

    it('asks for no rating of a guest or of a calibrating account', async () => {
      const player = vi.fn(profile(1480));
      const guest = setup('', saved(), {
        me: () => Promise.resolve({ player_id: 7, nick: 'Me', has_password: false }),
        activeMatch: () => Promise.resolve(null),
        player,
      });
      await guest.app.start();
      await guest.app.refreshProfile();
      const calibrating = setup('', saved(), {
        me: () =>
          Promise.resolve({
            player_id: 7,
            nick: 'Me',
            has_password: true,
            calibration: { played: 1, total: 5 },
          }),
        activeMatch: () => Promise.resolve(null),
        player,
      });
      await calibrating.app.start();
      await calibrating.app.refreshProfile();
      expect(player).not.toHaveBeenCalled();
      expect(guest.app.rating).toBeNull();
      expect(calibrating.app.rating).toBeNull();
    });

    it('keeps the rating when its request fails, and a logout forgets it', async () => {
      let fail = false;
      const { app } = setup('', saved(), {
        me: () => Promise.resolve({ player_id: 7, nick: 'Me', has_password: true }),
        activeMatch: () => Promise.resolve(null),
        player: () => (fail ? Promise.reject(new ApiError('network', 0)) : profile(1480)()),
      });
      await app.start();
      await app.refreshProfile();
      fail = true;
      await app.refreshProfile();
      expect(app.rating).toBe(1480);
      app.logout();
      expect(app.rating).toBeNull();
      expect(app.playerId).toBeNull();
    });

    it('opens the board or the Replays row and remembers the chosen player for "Back"', async () => {
      const { app } = setup('', saved(), {
        me: () => Promise.resolve({ player_id: 7, nick: 'Me', has_password: true }),
        activeMatch: () => Promise.resolve(null),
      });
      await app.start();
      app.openBoard();
      expect(app.screen).toEqual({ name: 'leaderboard', mode: 'board', player: null });
      app.selectPlayer(3);
      expect(app.screen).toEqual({ name: 'leaderboard', mode: 'board', player: 3 });
      app.openReplay('55');
      expect(app.screen).toMatchObject({ name: 'replay', matchId: '55' });
      app.closeReplay();
      expect(app.screen).toEqual({ name: 'leaderboard', mode: 'board', player: 3 });
      app.openBoard('history');
      expect(app.screen).toEqual({ name: 'leaderboard', mode: 'history', player: null });
    });
  });
});
