/**
 * The data of the leaderboard tab (LB-01, #78; #629): the top list and the own profile (the pinned
 * row). State, not markup, so it is tested without a DOM. Each part has its own loading, failure
 * (network, the per-IP limit) and retry; one failing never blanks the other.
 */
import { ApiError, type Api, type Leaderboard, type PlayerProfile } from '../api/http.ts';

export type FailureKind =
  /** The request did not reach the server. */
  | 'network'
  /** 429: the per-IP limit of public reads; `retryAfterS` says when to try again. */
  | 'limited'
  /** 404: unknown or blocked player. */
  | 'missing'
  | 'server';

export type Load<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly value: T }
  | {
      readonly status: 'failed';
      readonly failure: FailureKind;
      readonly retryAfterS: number | null;
    };

const LOADING = { status: 'loading' } as const;

export function failed(error: unknown): Load<never> {
  if (error instanceof ApiError) {
    if (error.code === 'network')
      return { status: 'failed', failure: 'network', retryAfterS: null };
    if (error.code === 'rate_limited') {
      return { status: 'failed', failure: 'limited', retryAfterS: error.retryAfterS };
    }
    if (error.code === 'not_found') {
      return { status: 'failed', failure: 'missing', retryAfterS: null };
    }
  }
  return { status: 'failed', failure: 'server', retryAfterS: null };
}

export class BoardState {
  board = $state.raw<Load<Leaderboard>>(LOADING);
  /** The own profile: the pinned row, the default of the right panel, the calibration. */
  own = $state.raw<Load<PlayerProfile>>(LOADING);
  ownId = $state.raw<number | null>(null);

  readonly #api: Pick<Api, 'leaderboard' | 'player' | 'me'>;
  readonly #token: string;
  #stop = new AbortController();
  #boardRun = 0;

  constructor(
    api: Pick<Api, 'leaderboard' | 'player' | 'me'>,
    token: string,
    ownId: number | null,
  ) {
    this.#api = api;
    this.#token = token;
    this.ownId = ownId;
  }

  /** Loads both parts. */
  async start(): Promise<void> {
    void this.loadBoard();
    await this.loadOwn();
  }

  async loadBoard(): Promise<void> {
    const run = ++this.#boardRun;
    this.board = LOADING;
    let next: Load<Leaderboard>;
    try {
      next = { status: 'ready', value: await this.#api.leaderboard(this.#stop.signal) };
    } catch (error) {
      next = failed(error);
    }
    if (run === this.#boardRun) this.board = next;
  }

  async loadOwn(): Promise<void> {
    this.own = LOADING;
    try {
      const id = this.ownId ?? (await this.#api.me(this.#token)).player_id;
      this.ownId = id;
      const profile = await this.#api.player(id, this.#token, this.#stop.signal);
      this.own = { status: 'ready', value: profile };
    } catch (error) {
      this.own = failed(error);
    }
  }

  stop(): void {
    this.#stop.abort();
    this.#boardRun += 1;
  }
}
