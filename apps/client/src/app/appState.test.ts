import { describe, expect, it, vi } from 'vitest';
import { Api, ApiError, type Invite } from '../api/http.ts';
import { GUEST_STORAGE_KEY } from '../api/guestStore.ts';
import { AppState } from './appState.svelte.ts';

const invite = (code: string): Invite => ({
  code,
  state: 'joined',
  map_id: 'pereval',
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
      me: () => Promise.resolve({ player_id: 1, nick: 'Old' }),
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
      me: () => Promise.resolve({ player_id: 1, nick: 'Host' }),
      joinInvite: () => Promise.reject(new ApiError('conflict', 409)),
      invite: () => Promise.resolve(invite('abc')),
    });
    await app.start();
    expect(app.screen).toEqual({ name: 'invite', code: 'abc' });
  });

  it('falls back to the menu with a message when the invite is full or gone', async () => {
    const storage = memory({ [GUEST_STORAGE_KEY]: '{"token":"t","nick":"Me"}' });
    const full = setup('?m=abc', storage, {
      me: () => Promise.resolve({ player_id: 1, nick: 'Me' }),
      joinInvite: () => Promise.reject(new ApiError('conflict', 409)),
      invite: () => Promise.reject(new ApiError('not_found', 404)),
    });
    await full.app.start();
    expect(full.app.screen.name).toBe('menu');
    expect(full.app.notice).toBe('error.invite.full');
    const gone = setup('?m=abc', storage, {
      me: () => Promise.resolve({ player_id: 1, nick: 'Me' }),
      joinInvite: () => Promise.reject(new ApiError('not_found', 404)),
    });
    await gone.app.start();
    expect(gone.app.screen.name).toBe('menu');
    expect(gone.app.notice).toBe('error.api.not_found');
  });

  it('creates an invite and a bot match, and moves on to the right screens', async () => {
    const storage = memory({ [GUEST_STORAGE_KEY]: '{"token":"t","nick":"Me"}' });
    const createBotMatch = vi.fn(() =>
      Promise.resolve({ match_id: 'm1', map_id: 'pereval', level: 'hard' as const, player: 0 }),
    );
    const { app } = setup('', storage, {
      me: () => Promise.resolve({ player_id: 1, nick: 'Me' }),
      createInvite: () => Promise.resolve(invite('xyz')),
      createBotMatch,
    });
    await app.start();
    await app.createInvite(null);
    expect(app.screen).toEqual({ name: 'invite', code: 'xyz' });
    await app.playBot('hard', 'pereval');
    expect(createBotMatch).toHaveBeenCalledWith('t', 'hard', 'pereval');
    expect(app.screen).toEqual({ name: 'match', matchId: 'm1', mapId: 'pereval' });
  });
});
