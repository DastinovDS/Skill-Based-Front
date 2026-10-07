import { describe, expect, it, vi } from 'vitest';
import { Api, ApiError } from './http.ts';
import { forgetGuest, GUEST_STORAGE_KEY, loadGuest, saveGuest } from './guestStore.ts';

function respond(status: number, body: unknown = {}): typeof fetch {
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

describe('Api', () => {
  it('creates a guest with the nick in the body and no token', async () => {
    const fetchFn = respond(201, { player_id: 7, token: 'tok' });
    const guest = await new Api(fetchFn).createGuest('Nick');
    expect(guest).toEqual({ playerId: 7, token: 'tok' });
    const [url, init] = vi.mocked(fetchFn).mock.calls[0] ?? [];
    expect(url).toBe('/api/guest');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"nick":"Nick"}');
    expect(init?.headers).not.toHaveProperty('Authorization');
  });

  it('sends the token in the Authorization header, never in the URL', async () => {
    const fetchFn = respond(200, { code: 'abc' });
    await new Api(fetchFn).joinInvite('secret-token', 'a/b');
    const [url, init] = vi.mocked(fetchFn).mock.calls[0] ?? [];
    expect(url).toBe('/api/matches/a%2Fb/join');
    expect(url).not.toContain('secret-token');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer secret-token' });
  });

  it('sends the map only when one is chosen', async () => {
    const fetchFn = respond(201, {});
    const api = new Api(fetchFn);
    await api.createBotMatch('t', 'hard', null);
    await api.createBotMatch('t', 'easy', 'pereval');
    const bodies = vi.mocked(fetchFn).mock.calls.map(([, init]) => init?.body);
    expect(bodies).toEqual(['{"level":"hard"}', '{"level":"easy","map_id":"pereval"}']);
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'blocked'],
    [404, 'not_found'],
    [409, 'conflict'],
    [422, 'invalid'],
    [429, 'rate_limited'],
    [503, 'unavailable'],
    [500, 'server'],
  ])('maps HTTP %i to %s', async (status, code) => {
    const error = await new Api(respond(status)).me('t').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(code);
  });

  it('reports a failed request as network', async () => {
    const api = new Api(() => Promise.reject(new TypeError('offline')));
    await expect(api.maps()).rejects.toMatchObject({ code: 'network' });
  });
});

describe('guest store', () => {
  function memory(): Storage {
    const data = new Map<string, string>();
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

  it('round-trips and forgets', () => {
    const storage = memory();
    expect(loadGuest(() => storage)).toBeNull();
    saveGuest(() => storage, { token: 't', nick: 'Nick' });
    expect(loadGuest(() => storage)).toEqual({ token: 't', nick: 'Nick' });
    forgetGuest(() => storage);
    expect(loadGuest(() => storage)).toBeNull();
  });

  it('ignores damaged content and a failing storage', () => {
    const storage = memory();
    storage.setItem(GUEST_STORAGE_KEY, '{"token":1}');
    expect(loadGuest(() => storage)).toBeNull();
    const broken = (): Storage => {
      throw new Error('blocked');
    };
    expect(loadGuest(broken)).toBeNull();
    expect(() => {
      saveGuest(broken, { token: 't', nick: 'n' });
      forgetGuest(broken);
    }).not.toThrow();
  });

  it('creates public matches, reads the lobby and cancels an invite', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ matches: [{ code: 'c' }] }), { status: 200 })),
    );
    const api = new Api(fetchFn);
    await api.createInvite('t', null, true);
    await api.createInvite('t', 'pereval');
    expect(await api.lobby('t')).toEqual([{ code: 'c' }]);
    fetchFn.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(api.cancelInvite('t', 'a/b')).resolves.toBeUndefined();
    const calls = fetchFn.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([url, init]) => [init.method, url, init.body])).toEqual([
      ['POST', '/api/matches', '{"public":true}'],
      ['POST', '/api/matches', '{"map_id":"pereval"}'],
      ['GET', '/api/lobby', undefined],
      ['DELETE', '/api/matches/a%2Fb', undefined],
    ]);
  });
});
