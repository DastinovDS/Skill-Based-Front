import { describe, expect, it, vi } from 'vitest';
import { Api, ApiError, parseRetryAfter } from './http.ts';
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

  it('asks for the active match with the token in the header', async () => {
    const fetchFn = respond(200, { match_id: '5', map_id: 'pass' });
    const found = await new Api(fetchFn).activeMatch('tok');
    expect(found).toEqual({ match_id: '5', map_id: 'pass' });
    const [url, init] = vi.mocked(fetchFn).mock.calls[0] ?? [];
    expect(url).toBe('/api/me/active-match');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer tok' });
    expect(await new Api(respond(200, null)).activeMatch('tok')).toBeNull();
  });

  it('sends the map only when one is chosen', async () => {
    const fetchFn = respond(201, {});
    const api = new Api(fetchFn);
    await api.createBotMatch('t', 'hard', null);
    await api.createBotMatch('t', 'easy', 'pass');
    const bodies = vi.mocked(fetchFn).mock.calls.map(([, init]) => init?.body);
    expect(bodies).toEqual(['{"level":"hard"}', '{"level":"easy","map_id":"pass"}']);
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

describe('Api accounts (#374)', () => {
  it('logs in with nick and password in the body, no token, and returns the new token', async () => {
    const fetchFn = respond(200, { player_id: 3, token: 'fresh' });
    const guest = await new Api(fetchFn).login('Nick', 'correct horse');
    expect(guest).toEqual({ playerId: 3, token: 'fresh' });
    const [url, init] = vi.mocked(fetchFn).mock.calls[0] ?? [];
    expect(url).toBe('/api/login');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"nick":"Nick","password":"correct horse"}');
    expect(init?.headers).not.toHaveProperty('Authorization');
  });

  it('sets a password with the token in the header, the old password only when given', async () => {
    const fetchFn = respond(200, { player_id: 3, token: 'fresh' });
    const api = new Api(fetchFn);
    await api.setPassword('tok', 'new password');
    const changed = await api.setPassword('tok', 'newer password', 'new password');
    expect(changed.token).toBe('fresh');
    const calls = vi.mocked(fetchFn).mock.calls;
    expect(calls.map(([url, init]) => [url, init?.body])).toEqual([
      ['/api/account/password', '{"password":"new password"}'],
      ['/api/account/password', '{"password":"newer password","old_password":"new password"}'],
    ]);
    expect(calls[0]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer tok' });
  });

  it('tells a wrong old password from a blocked account (both 403)', async () => {
    const wrong = await new Api(respond(403, { detail: 'wrong password' }))
      .setPassword('t', 'x')
      .catch((e: unknown) => e);
    expect(wrong).toMatchObject({ code: 'wrong_password', status: 403 });
    const blocked = await new Api(respond(403, { detail: 'account is blocked' }))
      .login('n', 'p')
      .catch((e: unknown) => e);
    expect(blocked).toMatchObject({ code: 'blocked', status: 403 });
    const bare = await new Api(() => Promise.resolve(new Response(null, { status: 403 })))
      .login('n', 'p')
      .catch((e: unknown) => e);
    expect(bare).toMatchObject({ code: 'blocked' });
  });

  it('keeps the wait of a 429 from Retry-After', async () => {
    const limited = (headers: Record<string, string>): typeof fetch =>
      vi.fn(() =>
        Promise.resolve(new Response('{"detail":"too many logins"}', { status: 429, headers })),
      );
    const timed = await new Api(limited({ 'Retry-After': '540' }))
      .login('n', 'p')
      .catch((e: unknown) => e);
    expect(timed).toMatchObject({ code: 'rate_limited', retryAfterS: 540 });
    const untimed = await new Api(limited({})).login('n', 'p').catch((e: unknown) => e);
    expect(untimed).toMatchObject({ code: 'rate_limited', retryAfterS: null });
  });

  it('tells a queue ban from the entry rate limit and keeps the time left (DEC-34)', async () => {
    const ban = { detail: { code: 'queue_banned', message: 'locked', retry_after_s: 287 } };
    const banned = await new Api(respond(429, ban)).joinQueue('t').catch((e: unknown) => e);
    expect(banned).toMatchObject({ code: 'queue_banned', status: 429, retryAfterS: 287 });
    // The header is the fallback when the body has no time.
    const noTime = await new Api(
      vi.fn(() =>
        Promise.resolve(
          new Response('{"detail":{"code":"queue_banned"}}', {
            status: 429,
            headers: { 'Retry-After': '60' },
          }),
        ),
      ),
    )
      .joinQueue('t')
      .catch((e: unknown) => e);
    expect(noTime).toMatchObject({ code: 'queue_banned', retryAfterS: 60 });
    const limited = await new Api(respond(429, { detail: 'too many' }))
      .joinQueue('t')
      .catch((e: unknown) => e);
    expect(limited).toMatchObject({ code: 'rate_limited' });
  });

  it.each([
    ['120', 120],
    [' 7 ', 7],
    ['0', null],
    ['-5', null],
    ['1.5', null],
    ['Wed, 21 Oct 2026 07:28:00 GMT', null],
    ['', null],
    [null, null],
  ])('reads Retry-After %j as %j', (header, seconds) => {
    expect(parseRetryAfter(header)).toBe(seconds);
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
    saveGuest(() => storage, { token: 't', nick: 'Nick', hasPassword: true });
    expect(loadGuest(() => storage)).toEqual({ token: 't', nick: 'Nick', hasPassword: true });
    forgetGuest(() => storage);
    expect(loadGuest(() => storage)).toBeNull();
  });

  it('reads a saved guest from before accounts as one without a password', () => {
    const storage = memory();
    storage.setItem(GUEST_STORAGE_KEY, '{"token":"t","nick":"Old"}');
    expect(loadGuest(() => storage)).toEqual({ token: 't', nick: 'Old', hasPassword: false });
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
      saveGuest(broken, { token: 't', nick: 'n', hasPassword: false });
      forgetGuest(broken);
    }).not.toThrow();
  });

  it('creates public matches, reads the lobby and cancels an invite', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ matches: [{ code: 'c' }] }), { status: 200 })),
    );
    const api = new Api(fetchFn);
    await api.createInvite('t', null, true);
    await api.createInvite('t', 'pass');
    expect(await api.lobby('t')).toEqual([{ code: 'c' }]);
    fetchFn.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(api.cancelInvite('t', 'a/b')).resolves.toBeUndefined();
    const calls = fetchFn.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([url, init]) => [init.method, url, init.body])).toEqual([
      ['POST', '/api/matches', '{"public":true}'],
      ['POST', '/api/matches', '{"map_id":"pass"}'],
      ['GET', '/api/lobby', undefined],
      ['DELETE', '/api/matches/a%2Fb', undefined],
    ]);
  });
});
