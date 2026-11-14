/**
 * The tutorial progress of the account (`docs/design/tutorial.md`, section 7.8): kept by the server
 * (`GET` and `PUT /api/me/tutorial`), a guest has its own. Plain TypeScript: the shapes, the
 * conversion from the wire, and the one-time import of the progress older versions kept in
 * `localStorage` (`sbf.tutorial`).
 */
import type { TutorialFlagsWire, TutorialProgressWire } from '../api/http.ts';
import type { ChapterId } from '../protocol.gen.ts';
import { ADVANCED_CHAPTERS, isChapterId, MAIN_CHAPTERS } from './chapters.ts';

/** The hints of the first match (section 5): H1 to H5. */
export type HintId = 'H1' | 'H2' | 'H3' | 'H4' | 'H5';
export const HINT_IDS: readonly HintId[] = ['H1', 'H2', 'H3', 'H4', 'H5'];

export interface TutorialProgress {
  readonly v: 1;
  /** The chapters completed at least once. */
  readonly done: readonly ChapterId[];
  /** "Don't show again" was ticked on the entry popup. */
  readonly offerOff: boolean;
  /** The first match (from the chapter select) was played: the tutorial counts as finished. */
  readonly firstMatch: boolean;
  /**
   * The match the chapter select started as the first match while it runs: a reload returns to it
   * with its hints, and its end marks the tutorial finished (`firstMatch`).
   */
  readonly firstMatchId: string | null;
  /** The first-match hints already shown (section 5). */
  readonly hints: readonly HintId[];
  /** "Turn off hints". */
  readonly hintsOff: boolean;
}

export const EMPTY_PROGRESS: TutorialProgress = {
  v: 1,
  done: [],
  offerOff: false,
  firstMatch: false,
  firstMatchId: null,
  hints: [],
  hintsOff: false,
};

/** The progress as the server sent it (it validates; an unknown id is dropped all the same). */
export function fromWire(wire: TutorialProgressWire): TutorialProgress {
  return {
    v: 1,
    done: [...new Set((wire.done ?? []).filter(isChapterId))],
    offerOff: wire.offer_off,
    firstMatch: wire.first_match,
    firstMatchId: wire.first_match_id ?? null,
    hints: HINT_IDS.filter((id) => (wire.hints ?? []).includes(id)),
    hintsOff: wire.hints_off,
  };
}

/** What `PUT` takes: the flags, never the chapters (`importDone`: the old browser's, once). */
export function toFlags(
  progress: TutorialProgress,
  importDone: readonly ChapterId[] = [],
): TutorialFlagsWire {
  return {
    offer_off: progress.offerOff,
    first_match: progress.firstMatch,
    first_match_id: progress.firstMatchId,
    hints: [...progress.hints],
    hints_off: progress.hintsOff,
    import_done: [...importDone],
  };
}

/** Nothing recorded: the state of a new account. */
export function isEmptyProgress(progress: TutorialProgress): boolean {
  return (
    progress.done.length === 0 &&
    !progress.offerOff &&
    !progress.firstMatch &&
    progress.firstMatchId === null &&
    progress.hints.length === 0 &&
    !progress.hintsOff
  );
}

/** The key older versions kept the progress under, in this browser; read once, then removed. */
const LEGACY_KEY = 'sbf.tutorial';

/** The progress an older version left in this browser, `null`: none (or damaged, or no storage). */
export function readLegacyProgress(storage: () => Storage): TutorialProgress | null {
  try {
    const raw = storage().getItem(LEGACY_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { done, offerOff, firstMatch, firstMatchId, hints, hintsOff } = parsed as Record<
      string,
      unknown
    >;
    return {
      v: 1,
      done: Array.isArray(done) ? [...new Set(done.filter(isChapterId))] : [],
      offerOff: offerOff === true,
      firstMatch: firstMatch === true,
      firstMatchId:
        typeof firstMatchId === 'string' && /^[0-9]{1,18}$/.test(firstMatchId)
          ? firstMatchId
          : null,
      hints: Array.isArray(hints) ? HINT_IDS.filter((id) => hints.includes(id)) : [],
      hintsOff: hintsOff === true,
    };
  } catch {
    return null;
  }
}

/** Removes the old key (best effort). */
export function forgetLegacyProgress(storage: () => Storage): void {
  try {
    storage().removeItem(LEGACY_KEY);
  } catch {
    // Blocked storage: nothing to remove.
  }
}

/** The place of a chapter on the chapter select (Charter, section 3). */
export type SealState = 'done' | 'next' | 'open' | 'locked';

/** A seat of Charter: a chapter, or the first match (`match`). */
export type CharterSeat = ChapterId | 'match';

/** The order of the seats: the main rule, the first match at its end, then the Advanced rule. */
export const CHARTER_ORDER: readonly CharterSeat[] = [
  ...MAIN_CHAPTERS,
  'match',
  ...ADVANCED_CHAPTERS,
];

/**
 * The state of every seat (section 3, Q8): a main chapter opens when the one before it is done; the
 * first match is open from the start; the Advanced chapters open when V is done. The next one is
 * the first open chapter not done yet.
 */
export function sealStates(progress: TutorialProgress): Readonly<Record<CharterSeat, SealState>> {
  const done = new Set<string>(progress.done);
  const states = {} as Record<CharterSeat, SealState>;
  MAIN_CHAPTERS.forEach((id, i) => {
    const before = MAIN_CHAPTERS[i - 1];
    states[id] = done.has(id)
      ? 'done'
      : before === undefined || done.has(before)
        ? 'open'
        : 'locked';
  });
  states.match = progress.firstMatch ? 'done' : 'open';
  const advancedOpen = done.has('defence');
  for (const id of ADVANCED_CHAPTERS) {
    states[id] = done.has(id) ? 'done' : advancedOpen ? 'open' : 'locked';
  }
  const next = CHARTER_ORDER.find((seat) => seat !== 'match' && states[seat] === 'open');
  if (next !== undefined) states[next] = 'next';
  return states;
}

/** The seat Charter chooses when it opens: the next chapter, else the first match. */
export function defaultSeat(progress: TutorialProgress): CharterSeat {
  const states = sealStates(progress);
  return CHARTER_ORDER.find((seat) => states[seat] === 'next') ?? 'match';
}

/** The seat a seal's "Opens after" names: the chapter before it on its rule. */
export function openedBy(seat: CharterSeat): ChapterId | null {
  const main = MAIN_CHAPTERS.findIndex((id) => id === seat);
  if (main > 0) return MAIN_CHAPTERS[main - 1] ?? null;
  if (ADVANCED_CHAPTERS.some((id) => id === seat)) return 'defence';
  return null;
}

/**
 * The entry popup may show (section 3, "Entry"): no chapter done, the first match not played, and
 * "Don't show again" not ticked. Whether the player has played a match is the caller's question.
 */
export function offerAllowed(progress: TutorialProgress): boolean {
  return progress.done.length === 0 && !progress.firstMatch && !progress.offerOff;
}
