/**
 * The tutorial progress of this browser, reactive (`progress.ts`; `docs/design/tutorial.md`, 7.8):
 * a chapter done, the entry popup turned off, the first match played. Saved at once.
 */
import type { ChapterId } from '../protocol.gen.ts';
import { EMPTY_PROGRESS, loadProgress, saveProgress, type TutorialProgress } from './progress.ts';

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

  /** The first match of the chapter select was played: the tutorial counts as finished. */
  playedFirstMatch(): void {
    if (!this.current.firstMatch) this.#set({ ...this.current, firstMatch: true });
  }
}
