/**
 * The data of the leaderboard screen (LB-01, #78): the top list, the own profile and the profile
 * of the row that is chosen. State, not markup, so it is tested without a DOM. Each part has its
 * own loading, failure (network, the per-IP limit, unknown player) and retry; one failing never
 * blanks the other.
 */
import { SvelteMap } from 'svelte/reactivity';
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
  /** `'own'` or the id of the row that was chosen. */
  selected = $state.raw<number | 'own'>('own');
  /** The profile of the chosen player, when it is not the own one. */
  other = $state.raw<Load<PlayerProfile>>(LOADING);
  ownId = $state.raw<number | null>(null);

  readonly #api: Pick<Api, 'leaderboard' | 'player' | 'me'>;
  readonly #token: string;
  readonly #cache = new SvelteMap<number, PlayerProfile>();
  #stop = new AbortController();
  #boardRun = 0;
  #otherRun = 0;

  constructor(
    api: Pick<Api, 'leaderboard' | 'player' | 'me'>,
    token: string,
    ownId: number | null,
  ) {
    this.#api = api;
    this.#token = token;
    this.ownId = ownId;
  }

  /** The profile the right panel shows now. */
  get viewed(): Load<PlayerProfile> {
    return this.selected === 'own' ? this.own : this.other;
  }

  /** Whether the right panel shows the own profile. */
  get viewingOwn(): boolean {
    return this.selected === 'own';
  }

  /** Loads everything; `initial` is a player to show instead of the own profile. */
  async start(initial: number | null = null): Promise<void> {
    void this.loadBoard();
    const own = this.loadOwn();
    if (initial !== null) this.select(initial);
    await own;
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

  /** Chooses a row: the own one (by its id or `'own'`) or another player. */
  select(id: number | 'own'): void {
    if (id === 'own' || id === this.ownId) {
      this.selected = 'own';
      return;
    }
    this.selected = id;
    const known = this.#cache.get(id);
    if (known !== undefined) {
      this.other = { status: 'ready', value: known };
      return;
    }
    void this.#loadOther(id);
  }

  /** Asks again for the part of the screen that failed. */
  retryViewed(): void {
    if (this.selected === 'own') void this.loadOwn();
    else void this.#loadOther(this.selected);
  }

  stop(): void {
    this.#stop.abort();
    this.#boardRun += 1;
    this.#otherRun += 1;
  }

  async #loadOther(id: number): Promise<void> {
    const run = ++this.#otherRun;
    this.other = LOADING;
    let next: Load<PlayerProfile>;
    try {
      const profile = await this.#api.player(id, this.#token, this.#stop.signal);
      this.#cache.set(id, profile);
      next = { status: 'ready', value: profile };
    } catch (error) {
      next = failed(error);
    }
    if (run === this.#otherRun) this.other = next;
  }
}
