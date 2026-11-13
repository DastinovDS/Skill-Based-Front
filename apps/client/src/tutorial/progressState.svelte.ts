/**
 * The tutorial progress of this browser, reactive (`progress.ts`; `docs/design/tutorial.md`, 7.8):
 * a chapter done, the entry popup turned off, the first match and its hints. Saved at once.
 */
import type { ChapterId } from '../protocol.gen.ts';
import {
  EMPTY_PROGRESS,
  loadProgress,
  saveProgress,
  type HintId,
  type TutorialProgress,
} from './progress.ts';

export class TutorialProgressState {
  current = $state.raw<TutorialProgress>(EMPTY_PROGRESS);
  readonly #storage: () => Storage;

  constructor(storage: () => Storage) {
    this.#storage = storage;
    this.current = loadProgress(storage);
  }

  #set(next: TutorialProgress): void {
    this.current = next;
    saveProgress(this.#storage, next);
  }

  /** A chapter reached its goal. */
  complete(chapter: ChapterId): void {
    if (this.current.done.includes(chapter)) return;
    this.#set({ ...this.current, done: [...this.current.done, chapter] });
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
