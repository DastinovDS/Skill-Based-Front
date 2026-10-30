/**
 * The HTTP API of the server (ID-01, SRV-05, SRV-06, LOB-01, MM-01, maps) as plain async functions. Types come
 * from `api.gen.ts` (generated from the FastAPI OpenAPI document, never edited by hand).
 * Plain TypeScript, no Svelte state. The token goes in the `Authorization` header only.
 */
import type { components } from '../api.gen.ts';
import type { MapFile } from '../protocol.gen.ts';

type Schemas = components['schemas'];
export type Invite = Schemas['InviteOut'];
export type ActiveMatch = Schemas['ActiveMatch'];
export type BotMatch = Schemas['BotMatchOut'];
export type LobbyEntry = Schemas['LobbyEntry'];
export type QueueStatus = Schemas['QueueStatus'];
export type MapSummary = Schemas['MapSummary'];
export type Leaderboard = Schemas['Leaderboard'];
export type LeaderboardEntry = Schemas['LeaderboardEntry'];
export type PlayerProfile = Schemas['PlayerProfile'];
export type MatchEntry = Schemas['MatchEntry'];
export type MatchKind = Schemas['MatchKind'];
export type ReplayLinkState = Schemas['ReplayLinkState'];
export type RecordTally = Schemas['Record'];
export type BotLevel = Schemas['CreateBotMatch']['level'];
export const BOT_LEVELS: readonly BotLevel[] = ['easy', 'normal', 'hard', 'expert'];

export type ApiErrorCode =
  /** 401: the token is unknown (the guest was removed): the saved identity is useless. */
  | 'unauthorized'
  /** 403: the account is blocked by the operator (MOD-01). */
  | 'blocked'
  /** 403 `wrong password`: the old password of a password change is wrong (#374). */
  | 'wrong_password'
  /** 404: no such invite, expired, or not yours; not in the matchmaking queue. */
  | 'not_found'
  /** 409: nick taken, own invite, invite full, waiting for the second player, bot match running. */
  | 'conflict'
  /** 422: nick, map or password rejected. */
  | 'invalid'
  /** 429: too many guests, matches created, nick or password changes, logins (MOD-01, #374). */
  | 'rate_limited'
  /** 429 with a `QueueBan` body: banned from the matchmaking queue for repeated resigns (DEC-34). */
  | 'queue_banned'
  /** 503: no maps or the server is restarting. */
  | 'unavailable'
  /** 503 "server is full" or "server is busy" (a cap of running matches #412, all password hashers busy): try again in a minute. */
  | 'full'
  /** The request did not reach the server, or the answer was not understood. */
  | 'network'
  | 'server';

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
    /** 429: seconds to wait, from `Retry-After` (or the ban body), when the server named them. */
    readonly retryAfterS: number | null = null,
  ) {
    super(`api error: ${code} (${String(status)})`);
    this.name = 'ApiError';
  }
}

const STATUS_CODES: Readonly<Record<number, ApiErrorCode>> = {
  401: 'unauthorized',
  403: 'blocked',
  404: 'not_found',
  409: 'conflict',
  422: 'invalid',
  429: 'rate_limited',
  503: 'unavailable',
};

/** `Retry-After` in seconds: the HTTP-date form is not used by the server and counts as unknown. */
export function parseRetryAfter(header: string | null): number | null {
  if (header === null || !/^\d+$/.test(header.trim())) return null;
  const seconds = Number(header);
  return seconds > 0 ? seconds : null;
}

/** The error of a failed response; the body only tells some 403 and 429 answers apart. */
async function errorOf(response: Response): Promise<ApiError> {
  let code = STATUS_CODES[response.status] ?? 'server';
  let retryAfter =
    response.status === 429 ? parseRetryAfter(response.headers.get('Retry-After')) : null;
  if (response.status === 503) {
    // The 503 bodies differ: a full or busy server says so, a restarting one has no maps or says "restarting".
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === 'string' && /^server is (full|busy)\b/.test(body.detail)) {
        code = 'full';
      }
    } catch {
      // No readable body: a plain 503 is the server not being ready.
    }
  } else if (response.status === 403) {
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (body.detail === 'wrong password') code = 'wrong_password';
    } catch {
      // No readable body: a plain 403 is the blocked account.
    }
  } else if (response.status === 429) {
    // A queue ban carries `{"detail": {"code": "queue_banned", "retry_after_s": N}}` (DEC-34).
    try {
      const body = (await response.json()) as { detail?: Partial<Schemas['QueueBan']> | string };
      const detail = body.detail;
      if (typeof detail === 'object' && detail.code === 'queue_banned') {
        code = 'queue_banned';
        if (typeof detail.retry_after_s === 'number' && detail.retry_after_s > 0) {
          retryAfter = detail.retry_after_s;
        }
      }
    } catch {
      // Only `Retry-After`: the entry rate limit.
    }
  }
  return new ApiError(code, response.status, retryAfter);
}

export interface Guest {
  playerId: number;
  token: string;
}

export class Api {
  readonly #fetch: typeof fetch;

  constructor(fetchFn: typeof fetch = (...args) => fetch(...args)) {
    this.#fetch = fetchFn;
  }

  async createGuest(nick: string): Promise<Guest> {
    const body = await this.#request<Schemas['GuestCreated']>('POST', '/api/guest', null, { nick });
    return { playerId: body.player_id, token: body.token };
  }

  /** Log in with nick and password (#374). The previous token of the player stops working. */
  async login(nick: string, password: string): Promise<Guest> {
    const body = await this.#request<Schemas['GuestCreated']>('POST', '/api/login', null, {
      nick,
      password,
    });
    return { playerId: body.player_id, token: body.token };
  }

  /**
   * Set the password of a guest, or change it (`oldPassword` is needed then). The answer carries a
   * NEW token and the old one is dead at once: the caller must store the new one (#374).
   */
  async setPassword(token: string, password: string, oldPassword?: string): Promise<Guest> {
    const body = await this.#request<Schemas['GuestCreated']>(
      'POST',
      '/api/account/password',
      token,
      { password, ...(oldPassword === undefined ? {} : { old_password: oldPassword }) },
    );
    return { playerId: body.player_id, token: body.token };
  }

  /** The player of a saved token; `unauthorized` if the server does not know it any more. */
  me(token: string): Promise<Schemas['Me']> {
    return this.#request('GET', '/api/me', token);
  }

  /** The running match of the guest (after a page reload or in another tab), `null` if none. */
  activeMatch(token: string): Promise<ActiveMatch | null> {
    return this.#request('GET', '/api/me/active-match', token);
  }

  /** The top 100 (LB-01, #78). Public: no token; a 429 is the per-IP limit of public reads. */
  leaderboard(signal?: AbortSignal): Promise<Leaderboard> {
    return this.#request('GET', '/api/leaderboard', null, undefined, signal);
  }

  /**
   * The profile of a player, a guest or an account (LB-01, #78); `not_found` for an unknown or
   * blocked one. The token is optional: with it the replay links of the caller's own unrated
   * matches open, for anyone else those are `private`.
   */
  player(id: number, token: string | null, signal?: AbortSignal): Promise<PlayerProfile> {
    return this.#request('GET', `/api/players/${String(id)}`, token, undefined, signal);
  }

  maps(): Promise<MapSummary[]> {
    return this.#request('GET', '/api/maps', null);
  }

  map(id: string): Promise<MapFile> {
    return this.#request('GET', `/api/maps/${encodeURIComponent(id)}`, null);
  }

  createInvite(token: string, mapId: string | null, isPublic = false): Promise<Invite> {
    return this.#request('POST', '/api/matches', token, {
      ...(mapId === null ? {} : { map_id: mapId }),
      ...(isPublic ? { public: true } : {}),
    });
  }

  /** Open public matches of other players (LOB-01). */
  async lobby(token: string, signal?: AbortSignal): Promise<LobbyEntry[]> {
    return (await this.#request<Schemas['LobbyOut']>('GET', '/api/lobby', token, undefined, signal))
      .matches;
  }

  /** Leave the waiting room: the server drops an invite that has not started. */
  async cancelInvite(token: string, code: string): Promise<void> {
    await this.#request('DELETE', `/api/matches/${encodeURIComponent(code)}`, token);
  }

  invite(token: string, code: string, signal?: AbortSignal): Promise<Invite> {
    return this.#request(
      'GET',
      `/api/matches/${encodeURIComponent(code)}`,
      token,
      undefined,
      signal,
    );
  }

  joinInvite(token: string, code: string): Promise<Invite> {
    return this.#request('POST', `/api/matches/${encodeURIComponent(code)}/join`, token);
  }

  readyInvite(token: string, code: string): Promise<Invite> {
    return this.#request('POST', `/api/matches/${encodeURIComponent(code)}/ready`, token);
  }

  /** Enter the matchmaking queue (MM-01); the status if already in it. */
  joinQueue(token: string, signal?: AbortSignal): Promise<QueueStatus> {
    return this.#request('POST', '/api/queue', token, undefined, signal);
  }

  /** The queue status; `not_found` once the player is out of the queue. Also the heartbeat. */
  queueStatus(token: string, signal?: AbortSignal): Promise<QueueStatus> {
    return this.#request('GET', '/api/queue', token, undefined, signal);
  }

  /** Confirm the found opponent; the second confirmation starts the match. */
  confirmQueue(token: string): Promise<QueueStatus> {
    return this.#request('POST', '/api/queue/confirm', token);
  }

  /** Leave the queue, or decline the found opponent. */
  async leaveQueue(token: string): Promise<void> {
    await this.#request('DELETE', '/api/queue', token);
  }

  createBotMatch(token: string, level: BotLevel, mapId: string | null): Promise<BotMatch> {
    return this.#request('POST', '/api/bot-matches', token, {
      level,
      ...(mapId === null ? {} : { map_id: mapId }),
    });
  }

  async #request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    token: string | null,
    body?: unknown,
    /** Aborts the request (a poll that took too long): it ends as a `network` error. */
    signal?: AbortSignal,
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (token !== null) headers['Authorization'] = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        ...(signal === undefined ? {} : { signal }),
      });
    } catch {
      throw new ApiError('network', 0);
    }
    if (!response.ok) {
      throw await errorOf(response);
    }
    if (response.status === 204) return undefined as T;
    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError('network', response.status);
    }
  }
}
