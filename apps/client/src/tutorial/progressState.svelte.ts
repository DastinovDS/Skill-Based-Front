/**
 * The tutorial progress of the account, reactive (`progress.ts`; `docs/design/tutorial.md`, 7.8):
 * a chapter done, the entry popup turned off, the first match and its hints. The server keeps it
 * (`GET` and `PUT /api/me/tutorial`); a change shows at once and is sent in the background, in
 * order. The chapters done are the server's to record (it sees the goal); a chapter completed here
 * is shown at once and the server has it by the time the match ends. Without the server the
 * progress lives until the page closes.
 */
import type { Api } from '../api/http.ts';
import type { ChapterId } from '../protocol.gen.ts';
import {
  EMPTY_PROGRESS,
  forgetLegacyProgress,
  fromWire,
  isEmptyProgress,
  readLegacyProgress,
  toFlags,
  type HintId,
  type TutorialProgress,
} from './progress.ts';

export class TutorialProgressState {
  current = $state.raw<TutorialProgress>(EMPTY_PROGRESS);
  readonly #api: Api;
  readonly #storage: () => Storage;
  #token: string | null = null;
  /** The sends in flight, one after the other: the last flags win. */
  #queue: Promise<void> = Promise.resolve();

  constructor(api: Api, storage: () => Storage) {
    this.#api = api;
    this.#storage = storage;
  }

  /**
   * Loads the progress of the account with `token` (a start, a login, a new guest). When the
   * account has none and the browser holds the old `sbf.tutorial`, that is sent once and removed.
   * Best effort: a server that cannot be reached leaves the empty progress.
   */
  async load(token: string): Promise<void> {
    this.#token = token;
    this.current = EMPTY_PROGRESS;
    let loaded: TutorialProgress;
    try {
      loaded = fromWire(await this.#api.tutorialProgress(token));
    } catch {
      return;
    }
    if (this.#token !== token) return; // another account loaded meanwhile
    this.current = loaded;
    const legacy = readLegacyProgress(this.#storage);
    if (legacy === null || !isEmptyProgress(loaded) || isEmptyProgress(legacy)) {
      forgetLegacyProgress(this.#storage);
      return;
    }
    // The old browser progress goes to the account once; the key stays until the server took it.
    this.current = legacy;
    try {
      await this.#api.saveTutorialFlags(token, toFlags(legacy, legacy.done));
      forgetLegacyProgress(this.#storage);
    } catch {
      // Not taken: the next start tries again.
    }
  }

  /** The account left (log out, forgotten): the next one loads its own. */
  clear(): void {
    this.#token = null;
    this.current = EMPTY_PROGRESS;
  }

  #send(importDone: readonly ChapterId[] = []): void {
    const token = this.#token;
    if (token === null) return;
    const flags = toFlags(this.current, importDone);
    this.#queue = this.#queue
      .then(() => this.#api.saveTutorialFlags(token, flags))
      .then(
        () => undefined,
        () => undefined, // Not saved: the next change sends the flags again.
      );
  }

  #set(next: TutorialProgress): void {
    this.current = next;
    this.#send();
  }

  /**
   * A chapter reached its goal. The server records it itself; this only shows it at once (Charter
   * opens straight after) and sends nothing.
   */
  complete(chapter: ChapterId): void {
    if (this.current.done.includes(chapter)) return;
    this.current = { ...this.current, done: [...this.current.done, chapter] };
  }

  /** "Don't show again" on the entry popup. */
  turnOfferOff(): void {
    if (!this.current.offerOff) this.#set({ ...this.current, offerOff: true });
  }

  /** The chapter select started the first match: kept, so a reload keeps its hints and its mark. */
  startedFirstMatch(matchId: string): void {
    if (this.current.firstMatchId !== matchId)
      this.#set({ ...this.current, firstMatchId: matchId });
  }

  /** The match is the first match the chapter select started (it may run on after a reload). */
  isFirstMatch(matchId: string): boolean {
    return this.current.firstMatchId === matchId;
  }

  /** The first match ended: the tutorial counts as finished. */
  playedFirstMatch(): void {
    if (!this.current.firstMatch || this.current.firstMatchId !== null) {
      this.#set({ ...this.current, firstMatch: true, firstMatchId: null });
    }
  }

  /** A hint of the first match showed: never again. */
  hintShown(id: HintId): void {
    if (!this.current.hints.includes(id)) {
      this.#set({ ...this.current, hints: [...this.current.hints, id] });
    }
  }

  /** "Turn off hints". */
  turnHintsOff(): void {
    if (!this.current.hintsOff) this.#set({ ...this.current, hintsOff: true });
  }
}
