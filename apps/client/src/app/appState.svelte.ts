/**
 * Navigation of the client (CLI-09, #65): which screen is shown, the guest, and the transitions
 * between screens. State, not a router: the address carries only the invite code (`?m=<code>`,
 * read once and removed from the address bar) and the replay viewer (`?replay=<id>`, main.ts).
 * The screens are dumb; every API call that changes the screen lives here, so it is testable
 * without a DOM.
 */
import { SvelteURLSearchParams } from 'svelte/reactivity';
import { Api, ApiError, type ActiveMatch, type BotLevel } from '../api/http.ts';
import { forgetGuest, loadGuest, saveGuest } from '../api/guestStore.ts';
import type { MessageKey } from '../i18n/index.ts';
import { loginFailure, passwordFailure, type AccountFailure } from './account.ts';
import { apiErrorKey } from './apiErrors.ts';
import type { Calibration, MapFile, MatchEndMsg, PlayerId } from '../protocol.gen.ts';

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
  /** Set or change the password of the account (#374). */
  | { readonly name: 'password' }
  /** The matchmaking queue (MM-01): searching, confirming, then the rated match. */
  | { readonly name: 'queue' }
  /** The waiting room of an invite (host and guest). */
  | { readonly name: 'invite'; readonly code: string }
  | { readonly name: 'match'; readonly matchId: string; readonly mapId: string }
  | {
      readonly name: 'result';
      readonly matchId: string;
      readonly me: PlayerId;
      readonly end: MatchEndMsg;
    }
  | {
      readonly name: 'replay';
      readonly matchId: string;
      /** The screen the replay was opened from, where "Back" returns; none: the menu. */
      readonly back?: Screen;
    };

export interface Guest {
  /** Replaced by a password change and by a login: the server keeps one token per player. */
  readonly token: string;
  readonly nick: string;
  /** An account (can log in from another device) rather than a guest that is lost on logout. */
  readonly hasPassword: boolean;
}

export interface AppStateOptions {
  api?: Api;
  storage?: () => Storage;
  /** The page address, read once for the invite code. */
  location?: Pick<Location, 'search' | 'pathname' | 'hash'>;
  /** Removes the invite code from the address bar. */
  replaceUrl?: (url: string) => void;
}

export { apiErrorKey };

export class AppState {
  screen = $state.raw<Screen>({ name: 'boot' });
  guest = $state.raw<Guest | null>(null);
  /** The code of an invite link opened before the guest was known. */
  pendingInvite = $state.raw<string | null>(null);
  /** Why the last action failed, shown on the screen it fell back to. */
  notice = $state.raw<MessageKey | null>(null);
  /** The running match of the guest, known from the server: the menu offers to return to it. */
  activeMatch = $state.raw<ActiveMatch | null>(null);
  /** Calibration progress of the account (DEC-34): null for a guest and once it is over. */
  calibration = $state.raw<Calibration | null>(null);
  /** The matchmaking queue is locked until this time (ms since the epoch), or null (DEC-34). */
  queueBanUntil = $state.raw<number | null>(null);
  /** The pool map drawn behind the start screens; null until it is loaded or if it cannot be. */
  backdrop = $state.raw<MapFile | null>(null);

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
    void this.#loadBackdrop();
    const saved = loadGuest(this.#storage);
    if (saved !== null) {
      try {
        const me = await this.api.me(saved.token);
        this.guest = { token: saved.token, nick: me.nick, hasPassword: me.has_password };
        this.calibration = me.calibration ?? null;
        saveGuest(this.#storage, this.guest);
      } catch (error) {
        if (error instanceof ApiError && error.code === 'unauthorized') {
          // Another device logged in to this account (a new token) or the guest is gone.
          forgetGuest(this.#storage);
          this.notice = 'error.api.unauthorized';
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
      this.guest = { token: created.token, nick, hasPassword: false };
      saveGuest(this.#storage, this.guest);
    } catch (error) {
      this.notice = apiErrorKey(error);
      return;
    }
    await this.#proceed();
  }

  /**
   * Registration from a clean screen (#374): a guest, then at once its password. Returns why it
   * failed, or null. If only the password step fails, the guest stays (nick taken, no password):
   * the menu says so and offers "Set password".
   */
  async registerAccount(nick: string, password: string): Promise<AccountFailure | null> {
    this.notice = null;
    let token: string;
    try {
      token = (await this.api.createGuest(nick)).token;
    } catch (error) {
      return { key: apiErrorKey(error) };
    }
    let hasPassword = false;
    try {
      token = (await this.api.setPassword(token, password)).token;
      hasPassword = true;
    } catch {
      this.notice = 'error.account.registerNoPassword';
    }
    this.#remember({ token, nick, hasPassword });
    await this.#proceed();
    return null;
  }

  /** Log in with nick and password; the token of the account on other devices stops working. */
  async login(nick: string, password: string): Promise<AccountFailure | null> {
    this.notice = null;
    let token: string;
    try {
      token = (await this.api.login(nick, password)).token;
    } catch (error) {
      return loginFailure(error);
    }
    // The nick may be typed in another spelling than the account has: ask for the real one.
    let shown = nick;
    try {
      shown = (await this.api.me(token)).nick;
    } catch {
      // The typed nick will do until the next start.
    }
    this.#remember({ token, nick: shown, hasPassword: true });
    await this.#proceed();
    return null;
  }

  /**
   * Set the password of a guest, or change it (the old one is asked then). The server answers
   * with a NEW token and the old one dies at once: it is saved before anything else is asked.
   */
  async setPassword(password: string, oldPassword: string): Promise<AccountFailure | null> {
    const guest = this.#requireGuest();
    try {
      const renewed = await this.api.setPassword(
        guest.token,
        password,
        guest.hasPassword ? oldPassword : undefined,
      );
      this.#remember({ ...guest, token: renewed.token, hasPassword: true });
      return null;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'unauthorized') {
        this.#fail(error);
        return null;
      }
      return passwordFailure(error);
    }
  }

  /** "Log out": this device forgets the token. The account (with a password) can log in again. */
  logout(): void {
    this.forget();
    this.activeMatch = null;
    this.pendingInvite = null;
    this.go({ name: 'welcome' });
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

  /** The calibration of the account, asked again whenever the menu opens (a match changes it). */
  async refreshProfile(): Promise<void> {
    const guest = this.guest;
    if (guest === null) return;
    try {
      this.calibration = (await this.api.me(guest.token)).calibration ?? null;
    } catch {
      // Best effort, like the running match: the chip keeps what it showed.
    }
  }

  /** The queue refused us for repeated resigns (DEC-34): the menu counts the time down. */
  banQueue(seconds: number): void {
    this.queueBanUntil = Date.now() + seconds * 1000;
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

  /** The replay of a match, opened from the current screen: "Back" returns here (#259). */
  openReplay(matchId: string): void {
    this.go({ name: 'replay', matchId, back: this.screen });
  }

  /** "Back" on the replay screen: to the screen it was opened from, else to the menu. */
  closeReplay(): void {
    const screen = this.screen;
    if (screen.name === 'replay' && screen.back !== undefined) this.go(screen.back);
    else this.menu();
  }

  /** The saved guest is not known to the server: start over with a new nick. */
  forget(): void {
    forgetGuest(this.#storage);
    this.guest = null;
    this.calibration = null;
    this.queueBanUntil = null;
  }

  /** The map behind the start screens: `crossroads` if the pool has it, else the first. Best effort. */
  async #loadBackdrop(): Promise<void> {
    try {
      const pool = await this.api.maps();
      const pick = pool.find((m) => m.id === 'crossroads') ?? pool[0];
      if (pick !== undefined) this.backdrop = await this.api.map(pick.id);
    } catch {
      // No picture is not fatal: the screens keep the plain dark page.
    }
  }

  #remember(guest: Guest): void {
    this.guest = guest;
    saveGuest(this.#storage, guest);
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
