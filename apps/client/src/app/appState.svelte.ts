/**
 * Navigation of the client (CLI-09, #65): which screen is shown, the guest, and the transitions
 * between screens. State, not a router: the address carries only the invite code (`?m=<code>`,
 * read once and removed from the address bar) and the replay viewer (`?replay=<id>`, main.ts).
 * The screens are dumb; every API call that changes the screen lives here, so it is testable
 * without a DOM.
 */
import { SvelteURLSearchParams } from 'svelte/reactivity';
import { Api, ApiError, NEW_MAP, type ActiveMatch, type BotLevel } from '../api/http.ts';
import { forgetGuest, loadGuest, saveGuest } from '../api/guestStore.ts';
import type { MessageKey } from '../i18n/index.ts';
import { loginFailure, passwordFailure, type AccountFailure } from './account.ts';
import { apiErrorKey } from './apiErrors.ts';
import { BOT_START_TIMEOUT_MS } from './waiting.ts';
import { MapCache } from './mapCache.svelte.ts';
import { MENU_MAP } from './menuMap.ts';
import type { MatchSummary } from './matchSummary.ts';
import type { ChapterId, MapFile, MatchEndMsg, PlayerColour, PlayerId } from '../protocol.gen.ts';
import type { Way } from './play.ts';
import { offerAllowed, type CharterSeat } from '../tutorial/progress.ts';
import { TutorialProgressState } from '../tutorial/progressState.svelte.ts';

/** The first match of the tutorial (#806, section 5): an easy bot on the smallest pool map (Q1). */
export const FIRST_MATCH = { level: 'easy', map: 'narrows' } as const satisfies {
  level: BotLevel;
  map: string;
};

export type Screen =
  /** Checking the saved guest. */
  | { readonly name: 'boot' }
  | { readonly name: 'welcome' }
  /**
   * The main screen (#919, III Plinth) with the way chosen on its plinth (none: Find a match).
   * `start`: Play a bot starts at once at this level on a new map (the bot offer of the queue).
   */
  | { readonly name: 'menu'; readonly way?: Way; readonly start?: BotLevel }
  /** The "How to play" page (CLI-13, #72), from the "?" of the bar. */
  | { readonly name: 'howto'; readonly back?: Screen }
  /** Set or change the password of the account (#374). */
  | { readonly name: 'password'; readonly back?: Screen }
  /**
   * The own profile (opened by the nick in the bar, #919) and the settings (from the profile,
   * #871): "Back" (Esc) returns to the screen they were opened from, none: the menu.
   */
  | { readonly name: 'profile'; readonly back?: Screen }
  | { readonly name: 'settings'; readonly back?: Screen }
  /** The matchmaking queue (MM-01): searching, confirming, then the rated match. */
  | { readonly name: 'queue' }
  /** The waiting room of an invite (host and guest). */
  | { readonly name: 'invite'; readonly code: string }
  /**
   * The tutorial (#806): the chapter select (Charter, `sel`: the seat chosen when it opens) and the
   * intro of a chapter (Sheet).
   */
  | { readonly name: 'tutorial'; readonly sel?: CharterSeat }
  | { readonly name: 'chapter'; readonly chapter: ChapterId }
  | {
      readonly name: 'match';
      readonly matchId: string;
      readonly mapId: string;
      /** A tutorial chapter: the coach draws its beats and its goal ends on the Seal. */
      readonly chapter?: ChapterId;
    }
  | {
      readonly name: 'result';
      readonly matchId: string;
      readonly mapId: string;
      readonly me: PlayerId;
      readonly end: MatchEndMsg;
      readonly summary: MatchSummary | null;
    }
  | {
      readonly name: 'replay';
      readonly matchId: string;
      /** The side the viewer played, when this screen knows it (the result screen): the replay opens as that side. */
      readonly me?: PlayerId;
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
  /** How long a bot match request may take (`BOT_START_TIMEOUT_MS`). */
  botTimeoutMs?: number;
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
  /** The own player id, known from `/api/me` once the menu has opened. */
  playerId = $state.raw<number | null>(null);
  /** The colour the player asks for in matches (DEC-49), from `/api/me`; null while unknown. */
  colour = $state.raw<PlayerColour | null>(null);
  /** The matchmaking queue is locked until this time (ms since the epoch), or null (DEC-34). */
  queueBanUntil = $state.raw<number | null>(null);
  /** The map drawn behind the start screens: the menu map, bundled at build time (#474). */
  readonly backdrop: MapFile = MENU_MAP;
  /** The tutorial progress of this browser (#806, section 7.8). */
  readonly tutorial: TutorialProgressState;
  /**
   * The entry popup that offers the tutorial (#806, section 3, "Entry") is up. Asked once per
   * entry (the first main screen after the page loads), kept in memory only.
   */
  offer = $state.raw(false);
  #offerAsked = false;
  /** The match the chapter select started as the first match: its end marks the tutorial finished. */
  #firstMatchId: string | null = null;

  readonly api: Api;
  /** The pool maps: the thumbnails and tiles of the lobby, invite and bot screens (#473). */
  readonly maps: MapCache;
  readonly #storage: () => Storage;
  readonly #location: Pick<Location, 'search' | 'pathname' | 'hash'>;
  readonly #replaceUrl: (url: string) => void;
  readonly #botTimeoutMs: number;
  /** The number of the latest colour choice (`changeColour`). */
  #colourSeq = 0;

  constructor(opts: AppStateOptions = {}) {
    this.api = opts.api ?? new Api();
    this.maps = new MapCache(this.api);
    this.#storage = opts.storage ?? (() => window.localStorage);
    this.tutorial = new TutorialProgressState(this.#storage);
    this.#botTimeoutMs = opts.botTimeoutMs ?? BOT_START_TIMEOUT_MS;
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
        this.guest = { token: saved.token, nick: me.nick, hasPassword: me.has_password };
        this.colour = me.colour;
        this.playerId = me.player_id;
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

  /**
   * The colour for the next matches (`PUT /api/me/colour`, DEC-49). Returns why it failed, or
   * null; a lost session (401) goes to the menu with its notice like any other action.
   */
  async changeColour(colour: PlayerColour): Promise<MessageKey | null> {
    const guest = this.#requireGuest();
    // Shown at once; only the answer to the latest choice settles it (the arrow keys choose fast).
    const before = this.colour;
    const seq = ++this.#colourSeq;
    this.colour = colour;
    try {
      const me = await this.api.changeColour(guest.token, colour);
      if (seq === this.#colourSeq) this.colour = me.colour;
      return null;
    } catch (error) {
      if (seq === this.#colourSeq) this.colour = before;
      if (error instanceof ApiError && error.code === 'unauthorized') {
        this.#fail(error);
        return null;
      }
      return apiErrorKey(error);
    }
  }

  /** The own profile or the settings (#871), from the account chip of the current screen. */
  openAccountPage(name: 'profile' | 'settings'): void {
    const here = this.screen;
    if (here.name === name) return;
    // The settings open from the profile (#919) and go back to it; the profile from the settings
    // is the one they came from.
    if (name === 'settings' && here.name === 'profile') {
      this.go({ name, back: here });
      return;
    }
    if (name === 'profile' && here.name === 'settings' && here.back?.name === 'profile') {
      this.go(here.back);
      return;
    }
    // Another account page is no place to come back to: keep where the first one was opened.
    const back = here.name === 'profile' || here.name === 'settings' ? here.back : here;
    this.go(back === undefined ? { name } : { name, back });
  }

  /** "Back" of the profile and the settings: the screen they were opened from, else the menu. */
  closeAccountPage(): void {
    this.closePage();
  }

  /** How to play (the "?" of the bar) or the password page, over the screen they open from. */
  openPage(name: 'howto' | 'password'): void {
    const here = this.screen;
    if (here.name === name) return;
    this.go({ name, back: here });
  }

  /** "Back" of a page (profile, settings, how to play, password): where it was opened, else the menu. */
  closePage(): void {
    const here = this.screen;
    if (
      (here.name === 'profile' ||
        here.name === 'settings' ||
        here.name === 'howto' ||
        here.name === 'password') &&
      here.back !== undefined
    ) {
      const back = here.back;
      // A bot start of the queue's offer is not repeated by coming back.
      this.go(
        back.name === 'menu'
          ? { name: 'menu', ...(back.way === undefined ? {} : { way: back.way }) }
          : back,
      );
    } else {
      this.menu();
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

  /**
   * The own id and colour, asked again whenever the menu opens. No rating is shown outside a
   * match at the MVP (#919): the account's rating and calibration are not asked for.
   */
  async refreshProfile(): Promise<void> {
    const guest = this.guest;
    if (guest === null) return;
    let me;
    try {
      me = await this.api.me(guest.token);
    } catch {
      return; // Best effort, like the running match: the screen keeps what it showed.
    }
    this.playerId = me.player_id;
    this.colour = me.colour;
  }

  /** The queue refused us for repeated resigns (DEC-34): the menu counts the time down. */
  banQueue(seconds: number): void {
    this.queueBanUntil = Date.now() + seconds * 1000;
  }

  /** Back to the running match (the socket reconnects with the same token, DEC-05), a chapter too. */
  resumeMatch(match: ActiveMatch): void {
    this.go({
      name: 'match',
      matchId: match.match_id,
      mapId: match.map_id,
      ...(match.chapter == null ? {} : { chapter: match.chapter }),
    });
  }

  // --- The tutorial (#806) ---------------------------------------------------------------------

  /**
   * The main screen of an entry (section 3, "Entry"): the popup offers the tutorial while no chapter
   * is done, the first match was not played, "Don't show again" is not ticked and the player has
   * played no match (the profile's count, a guest and an account alike). Asked once per entry.
   */
  async askOffer(): Promise<void> {
    if (this.#offerAsked) return;
    this.#offerAsked = true;
    const guest = this.guest;
    if (guest === null || !offerAllowed(this.tutorial.current)) return;
    try {
      const me = await this.api.me(guest.token);
      const profile = await this.api.player(me.player_id, guest.token);
      const { wins, losses, draws } = profile.record;
      if (wins + losses + draws > 0) return;
    } catch {
      return; // Best effort: no popup when the server cannot say.
    }
    if (this.screen.name === 'menu' && offerAllowed(this.tutorial.current)) this.offer = true;
  }

  /** The popup's answer: "Start the tutorial" (the intro of chapter I) or "Not now". */
  answerOffer(start: boolean, off: boolean): void {
    this.offer = false;
    if (off) this.tutorial.turnOfferOff();
    if (start) this.go({ name: 'chapter', chapter: 'units' });
  }

  /** The chapter select ("?" > Tutorial, "All chapters"); `sel`: the seat to choose. */
  openTutorial(sel?: CharterSeat): void {
    this.offer = false;
    this.go(sel === undefined ? { name: 'tutorial' } : { name: 'tutorial', sel });
  }

  /** The intro (Sheet) of a chapter. */
  openChapter(chapter: ChapterId): void {
    this.go({ name: 'chapter', chapter });
  }

  /** Starts a chapter (a fresh match every time); a failure is answered like `playBot`. */
  async startChapter(chapter: ChapterId): Promise<MessageKey | null> {
    const guest = this.#requireGuest();
    try {
      const match = await this.api.createTutorialMatch(guest.token, chapter);
      this.go({ name: 'match', matchId: match.match_id, mapId: match.map_id, chapter });
      return null;
    } catch (error) {
      return this.#failHere(error);
    }
  }

  /** The first match from the chapter select: an easy bot on Narrows (section 5). */
  async playFirstMatch(): Promise<MessageKey | null> {
    const failed = await this.playBot(FIRST_MATCH.level, FIRST_MATCH.map);
    const screen = this.screen;
    if (failed === null && screen.name === 'match') this.#firstMatchId = screen.matchId;
    return failed;
  }

  go(screen: Screen): void {
    this.notice = null;
    this.screen = screen;
  }

  /**
   * Back to the menu (or to the nick form without a guest), optionally with a message, with a
   * way of the plinth chosen (none: Find a match).
   */
  menu(notice: MessageKey | null = null, way?: Way): void {
    this.screen =
      this.guest === null
        ? { name: 'welcome' }
        : way === undefined
          ? { name: 'menu' }
          : { name: 'menu', way };
    this.notice = notice;
  }

  /**
   * Creates an invite (a map made for it, #884) and opens its waiting room. A failure stays on
   * the screen that asked: the answer is the line to show, or null on success. A lost session
   * (401) is not shown there: it starts over from the menu with the notice.
   */
  async createInvite(pick: string = NEW_MAP): Promise<MessageKey | null> {
    const guest = this.#requireGuest();
    try {
      const invite = await this.api.createInvite(guest.token, pick);
      this.go({ name: 'invite', code: invite.code });
      return null;
    } catch (error) {
      return this.#failHere(error);
    }
  }

  /**
   * Starts a bot match; a failure is answered like `createInvite`. The server answers once the
   * map is made (#884); a request that hangs past `BOT_START_TIMEOUT_MS` is given up.
   */
  async playBot(level: BotLevel, pick: string): Promise<MessageKey | null> {
    const guest = this.#requireGuest();
    const limit = new AbortController();
    const timer = setTimeout(() => {
      limit.abort();
    }, this.#botTimeoutMs);
    try {
      const match = await this.api.createBotMatch(guest.token, level, pick, limit.signal);
      this.go({ name: 'match', matchId: match.match_id, mapId: match.map_id });
      return null;
    } catch (error) {
      return limit.signal.aborted ? 'error.bot.slow' : this.#failHere(error);
    } finally {
      clearTimeout(timer);
    }
  }

  /** The match ended: the result screen needs the side we played to say who won. */
  finishMatch(
    matchId: string,
    mapId: string,
    me: PlayerId,
    end: MatchEndMsg,
    summary: MatchSummary | null = null,
  ): void {
    this.activeMatch = null;
    if (matchId === this.#firstMatchId) {
      this.#firstMatchId = null;
      this.tutorial.playedFirstMatch();
    }
    this.go({ name: 'result', matchId, mapId, me, end, summary });
  }

  /** The replay of a match, opened from the current screen: "Back" returns here (#259). */
  openReplay(matchId: string, me?: PlayerId): void {
    this.go({ name: 'replay', matchId, me, back: this.screen });
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
    this.playerId = null;
    this.colour = null;
    this.queueBanUntil = null;
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

  /** The line for a failure that stays on its screen; a lost session goes to the menu instead. */
  #failHere(error: unknown): MessageKey | null {
    if (error instanceof ApiError && error.code === 'unauthorized') {
      this.#fail(error);
      return null;
    }
    return apiErrorKey(error);
  }

  #requireGuest(): Guest {
    if (this.guest === null) throw new Error('no guest: the screen is only shown with one');
    return this.guest;
  }
}
