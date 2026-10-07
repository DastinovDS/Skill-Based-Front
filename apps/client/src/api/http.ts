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
export type BotLevel = Schemas['CreateBotMatch']['level'];
export const BOT_LEVELS: readonly BotLevel[] = ['easy', 'normal', 'hard', 'expert'];

export type ApiErrorCode =
  /** 401: the token is unknown (the guest was removed): the saved identity is useless. */
  | 'unauthorized'
  /** 403: the account is blocked by the operator (MOD-01). */
  | 'blocked'
  /** 404: no such invite, expired, or not yours; not in the matchmaking queue. */
  | 'not_found'
  /** 409: nick taken, own invite, invite full, waiting for the second player, bot match running. */
  | 'conflict'
  /** 422: nick or map rejected. */
  | 'invalid'
  /** 429: too many guests from this address, matches created or nick changes (MOD-01). */
  | 'rate_limited'
  /** 503: no maps or the server is restarting. */
  | 'unavailable'
  /** The request did not reach the server, or the answer was not understood. */
  | 'network'
  | 'server';

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
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

  /** The player of a saved token; `unauthorized` if the server does not know it any more. */
  me(token: string): Promise<Schemas['Me']> {
    return this.#request('GET', '/api/me', token);
  }

  /** The running match of the guest (after a page reload or in another tab), `null` if none. */
  activeMatch(token: string): Promise<ActiveMatch | null> {
    return this.#request('GET', '/api/me/active-match', token);
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
  async lobby(token: string): Promise<LobbyEntry[]> {
    return (await this.#request<Schemas['LobbyOut']>('GET', '/api/lobby', token)).matches;
  }

  /** Leave the waiting room: the server drops an invite that has not started. */
  async cancelInvite(token: string, code: string): Promise<void> {
    await this.#request('DELETE', `/api/matches/${encodeURIComponent(code)}`, token);
  }

  invite(token: string, code: string): Promise<Invite> {
    return this.#request('GET', `/api/matches/${encodeURIComponent(code)}`, token);
  }

  joinInvite(token: string, code: string): Promise<Invite> {
    return this.#request('POST', `/api/matches/${encodeURIComponent(code)}/join`, token);
  }

  readyInvite(token: string, code: string): Promise<Invite> {
    return this.#request('POST', `/api/matches/${encodeURIComponent(code)}/ready`, token);
  }

  /** Enter the matchmaking queue (MM-01); the status if already in it. */
  joinQueue(token: string): Promise<QueueStatus> {
    return this.#request('POST', '/api/queue', token);
  }

  /** The queue status; `not_found` once the player is out of the queue. Also the heartbeat. */
  queueStatus(token: string): Promise<QueueStatus> {
    return this.#request('GET', '/api/queue', token);
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
      });
    } catch {
      throw new ApiError('network', 0);
    }
    if (!response.ok) {
      throw new ApiError(STATUS_CODES[response.status] ?? 'server', response.status);
    }
    if (response.status === 204) return undefined as T;
    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError('network', response.status);
    }
  }
}
