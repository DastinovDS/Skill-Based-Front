/**
 * Navigation of the client (CLI-09, #65): which screen is shown, the guest, and the transitions
 * between screens. State, not a router: the address carries only the invite code (`?m=<code>`,
 * read once and removed from the address bar) and the replay viewer (`?replay=<id>`, main.ts).
 * The screens are dumb; every API call that changes the screen lives here, so it is testable
 * without a DOM.
 */
import { SvelteURLSearchParams } from 'svelte/reactivity';
import { Api, ApiError, type ActiveMatch, type ApiErrorCode, type BotLevel } from '../api/http.ts';
import { forgetGuest, loadGuest, saveGuest } from '../api/guestStore.ts';
import type { MessageKey } from '../i18n/index.ts';
import type { MatchEndMsg, PlayerId } from '../protocol.gen.ts';

export type Screen =
  /** Checking the saved guest. */
  | { readonly name: 'boot' }
  | { readonly name: 'welcome' }
  | { readonly name: 'menu' }
  /** Pick the map of a private or public match, then create it. */
  | { readonly name: 'create'; readonly public: boolean }
  /** The public lobby: open matches of other players (LOB-01). */
  | { readonly name: 'lobby' }
  | { readonly name: 'bot' }
  /** The waiting room of an invite (host and guest). */
  | { readonly name: 'invite'; readonly code: string }
  | { readonly name: 'match'; readonly matchId: string; readonly mapId: string }
  | {
      readonly name: 'result';
      readonly matchId: string;
      readonly me: PlayerId;
      readonly end: MatchEndMsg;
    }
  | { readonly name: 'replay'; readonly matchId: string };

export interface Guest {
  readonly token: string;
  readonly nick: string;
}

export interface AppStateOptions {
  api?: Api;
  storage?: () => Storage;
  /** The page address, read once for the invite code. */
  location?: Pick<Location, 'search' | 'pathname' | 'hash'>;
  /** Removes the invite code from the address bar. */
  replaceUrl?: (url: string) => void;
}

/** The UI string for an API failure. */
const API_ERRORS: Record<ApiErrorCode, MessageKey> = {
  unauthorized: 'error.api.unauthorized',
  blocked: 'error.api.blocked',
  not_found: 'error.api.not_found',
  conflict: 'error.api.conflict',
  invalid: 'error.api.invalid',
  rate_limited: 'error.api.rate_limited',
  unavailable: 'error.api.unavailable',
  network: 'error.api.network',
  server: 'error.api.server',
};

export function apiErrorKey(error: unknown): MessageKey {
  return API_ERRORS[error instanceof ApiError ? error.code : 'network'];
}

export class AppState {
  screen = $state.raw<Screen>({ name: 'boot' });
  guest = $state.raw<Guest | null>(null);
  /** The code of an invite link opened before the guest was known. */
  pendingInvite = $state.raw<string | null>(null);
  /** Why the last action failed, shown on the screen it fell back to. */
  notice = $state.raw<MessageKey | null>(null);
  /** The running match of the guest, known from the server: the menu offers to return to it. */
  activeMatch = $state.raw<ActiveMatch | null>(null);

  readonly api: Api;
  readonly #storage: () => Storage;
  readonly #location: Pick<Location, 'search' | 'pathname' | 'hash'>;
  readonly #replaceUrl: (url: string) => void;

  constructor(opts: AppStateOptions = {}) {
    this.api = opts.api ?? new Api();
    this.#storage = opts.storage ?? (() => window.localStorage);
    this.#location = opts.location ?? window.location;
    this.#replaceUrl =
      opts.replaceUrl ??
      ((url) => {
        window.history.replaceState(null, '', url);
      });
  }

  /** The first screen: the invite code from the address, the saved guest, then welcome or menu. */
  async start(): Promise<void> {
    this.#takeInviteFromUrl();
    const saved = loadGuest(this.#storage);
    if (saved !== null) {
      try {
        const me = await this.api.me(saved.token);
        this.guest = { token: saved.token, nick: me.nick };
      } catch (error) {
        if (error instanceof ApiError && error.code === 'unauthorized') {
          forgetGuest(this.#storage);
        } else {
          // The server cannot be reached: keep the guest, the next action shows the failure.
          this.guest = saved;
        }
      }
    }
    await this.#proceed();
  }

  /** The nick form: makes a guest on the server, then goes on to the invite or the menu. */
  async register(nick: string): Promise<void> {
    this.notice = null;
    try {
      const created = await this.api.createGuest(nick);
      this.guest = { token: created.token, nick };
      saveGuest(this.#storage, this.guest);
    } catch (error) {
      this.notice = apiErrorKey(error);
      return;
    }
    await this.#proceed();
  }

  /**
   * Asks the server for the running match of the guest (#189). Best effort: a failure leaves the
   * menu as it is, the next action shows the problem.
   */
  async refreshActiveMatch(): Promise<ActiveMatch | null> {
    const guest = this.guest;
    if (guest === null) return null;
    let found: ActiveMatch | null;
    try {
      found = await this.api.activeMatch(guest.token);
    } catch {
      found = null;
    }
    this.activeMatch = found;
    return found;
  }

  /** Back to the running match (the socket reconnects with the same token, DEC-05). */
  resumeMatch(match: ActiveMatch): void {
    this.go({ name: 'match', matchId: match.match_id, mapId: match.map_id });
  }

  go(screen: Screen): void {
    this.notice = null;
    this.screen = screen;
  }

  /** Back to the menu (or to the nick form without a guest), optionally with a message. */
  menu(notice: MessageKey | null = null): void {
    this.screen = { name: this.guest === null ? 'welcome' : 'menu' };
    this.notice = notice;
  }

  async createInvite(mapId: string | null, isPublic = false): Promise<void> {
    const guest = this.#requireGuest();
    try {
      const invite = await this.api.createInvite(guest.token, mapId, isPublic);
      this.go({ name: 'invite', code: invite.code });
    } catch (error) {
      this.#fail(error);
    }
  }

  async playBot(level: BotLevel, mapId: string | null): Promise<void> {
    const guest = this.#requireGuest();
    try {
      const match = await this.api.createBotMatch(guest.token, level, mapId);
      this.go({ name: 'match', matchId: match.match_id, mapId: match.map_id });
    } catch (error) {
      this.#fail(error);
    }
  }

  /** The match ended: the result screen needs the side we played to say who won. */
  finishMatch(matchId: string, me: PlayerId, end: MatchEndMsg): void {
    this.activeMatch = null;
    this.go({ name: 'result', matchId, me, end });
  }

  /** The saved guest is not known to the server: start over with a new nick. */
  forget(): void {
    forgetGuest(this.#storage);
    this.guest = null;
  }

  #takeInviteFromUrl(): void {
    const params = new SvelteURLSearchParams(this.#location.search);
    const code = params.get('m');
    if (code === null || code === '') return;
    this.pendingInvite = code;
    // The code is a secret of the two players: do not leave it in the address bar and history.
    params.delete('m');
    const rest = params.toString();
    this.#replaceUrl(
      `${this.#location.pathname}${rest === '' ? '' : `?${rest}`}${this.#location.hash}`,
    );
  }

  async #proceed(): Promise<void> {
    const guest = this.guest;
    if (guest === null) {
      this.screen = { name: 'welcome' };
      return;
    }
    // A page reload (or a new tab) in a running match: go back to it inside the reconnect window.
    const running = await this.refreshActiveMatch();
    if (running !== null) {
      this.pendingInvite = null; // joining another match is a 409 while this one runs
      this.resumeMatch(running);
      return;
    }
    const code = this.pendingInvite;
    if (code === null) {
      this.screen = { name: 'menu' };
      return;
    }
    this.pendingInvite = null;
    try {
      const invite = await this.api.joinInvite(guest.token, code);
      this.go({ name: 'invite', code: invite.code });
    } catch (error) {
      await this.#openOwnInvite(guest, code, error);
    }
  }

  /** Your own link (or one you already joined) is a 409 on join but a normal GET: open it. */
  async #openOwnInvite(guest: Guest, code: string, joinError: unknown): Promise<void> {
    if (joinError instanceof ApiError && joinError.code === 'conflict') {
      try {
        const invite = await this.api.invite(guest.token, code);
        this.go({ name: 'invite', code: invite.code });
        return;
      } catch {
        this.screen = { name: 'menu' };
        this.notice = 'error.invite.full';
        return;
      }
    }
    this.#fail(joinError);
  }

  #fail(error: unknown): void {
    if (error instanceof ApiError && error.code === 'unauthorized') {
      this.forget();
    }
    this.menu(apiErrorKey(error));
  }

  #requireGuest(): Guest {
    if (this.guest === null) throw new Error('no guest: the screen is only shown with one');
    return this.guest;
  }
}
