/**
 * The hints of the first match (`docs/design/tutorial.md`, section 5): one card at a time, each
 * shown once in this browser, never with "Turn off hints", H4 and H5 never once their Advanced
 * chapter is done. A hint never pauses the match; it goes away after `HINT_SHOW_MS` or by its close
 * button. The triggers are `hints.ts`; `current` is replaced when a hint shows or goes, not per
 * snapshot.
 */
import type { ChapterId, ServerMsg } from '../protocol.gen.ts';
import { HintWatcher, type HintShow } from './hints.ts';
import type { HintId, TutorialProgress } from './progress.ts';

/** A hint closes itself after this long (section 5). */
export const HINT_SHOW_MS = 12_000;
/** After a hint goes, the next one waits this long, so two cards do not read as one. */
export const HINT_GAP_MS = 1_500;

/** The Advanced chapter that teaches what a hint points at: done, the hint never shows. */
const TAUGHT_BY: Partial<Record<HintId, ChapterId>> = {
  H4: 'group-orders',
  H5: 'rally-points',
};

/** The part of the tutorial progress the hints read and write. */
export interface HintProgress {
  readonly current: TutorialProgress;
  hintShown(id: HintId): void;
  turnHintsOff(): void;
}

export interface HintClock {
  now(): number;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const REAL_CLOCK: HintClock = {
  now: () => performance.now(),
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export class HintCoach {
  /** The hint on screen, or null. */
  current = $state.raw<HintShow | null>(null);
  /** Bumped whenever another hint shows: its card and its mark start their motion again. */
  seq = $state(0);
  readonly #watcher: HintWatcher;
  readonly #progress: HintProgress;
  readonly #clock: HintClock;
  #timer: unknown = null;
  /** The time the card still has before it closes itself, and when it was last counted. */
  #left = 0;
  #since = 0;
  #held = false;
  #quietUntil = 0;

  constructor(watcher: HintWatcher, progress: HintProgress, clock: HintClock = REAL_CLOCK) {
    this.#watcher = watcher;
    this.#progress = progress;
    this.#clock = clock;
  }

  /** Every message of the match: the snapshots and the events feed the triggers. */
  onMessage(msg: ServerMsg): void {
    if (msg.type === 'snapshot') this.#watcher.onSnapshot(msg);
    else if (msg.type === 'event') this.#watcher.onEvent(msg);
    else return;
    this.#pick();
  }

  #pick(): void {
    const progress = this.#progress.current;
    if (this.current !== null || progress.hintsOff) return;
    if (this.#clock.now() < this.#quietUntil) return;
    for (const hint of this.#watcher.ready()) {
      const taughtBy = TAUGHT_BY[hint.id];
      if (progress.hints.includes(hint.id) || (taughtBy && progress.done.includes(taughtBy))) {
        this.#watcher.drop(hint.id);
        continue;
      }
      this.#watcher.drop(hint.id);
      this.#progress.hintShown(hint.id);
      this.current = hint;
      this.seq += 1;
      this.#held = false;
      this.#left = HINT_SHOW_MS;
      this.#run();
      return;
    }
  }

  #run(): void {
    this.#since = this.#clock.now();
    this.#timer = this.#clock.setTimeout(() => {
      this.#timer = null;
      this.close();
    }, this.#left);
  }

  /**
   * The pointer or the focus is on the card: its time stands still while it is read (WCAG 2.2.1),
   * and runs on from where it was when they leave.
   */
  hold(on: boolean): void {
    if (this.current === null || on === this.#held) return;
    this.#held = on;
    if (on) {
      if (this.#timer !== null) this.#clock.clearTimeout(this.#timer);
      this.#timer = null;
      this.#left = Math.max(0, this.#left - (this.#clock.now() - this.#since));
    } else {
      this.#run();
    }
  }

  /** The close button, or the time is up. */
  close(): void {
    if (this.#timer !== null) this.#clock.clearTimeout(this.#timer);
    this.#timer = null;
    if (this.current === null) return;
    this.current = null;
    this.#quietUntil = this.#clock.now() + HINT_GAP_MS;
  }

  /** "Turn off hints": this one goes, no other shows again. */
  turnOff(): void {
    this.#progress.turnHintsOff();
    this.close();
  }

  /** Dev scenes: `hint` shows at once and stays (a frozen scene fires no trigger). */
  pin(hint: HintShow): void {
    this.current = hint;
    this.seq += 1;
  }

  destroy(): void {
    if (this.#timer !== null) this.#clock.clearTimeout(this.#timer);
    this.#timer = null;
  }
}
