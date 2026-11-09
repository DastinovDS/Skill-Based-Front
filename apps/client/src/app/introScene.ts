/**
 * The opening scene of the entry screen (#826, intro B "Grain" of round 3, ui-style 56): a pure
 * function of the time t in seconds, so a frame can be drawn, frozen (the dev scene) or skipped to
 * the end exactly. The letters of the title come out of the dark one by one in a fixed irregular
 * order with overlapping, uneven onsets (never left to right); the rule under the title grows; the
 * title then rises slowly to its place on the entry screen while the map comes up and the nick
 * field comes in. Once a browser session, skipped by a click or a key, never under reduced motion.
 *
 * Timings are the mockup's (`docs/design/mockups/out-of-game-style-r3.html`, `TL` and `EMERGE`)
 * with two changes: the fights at the edges are not part of this piece (the title starts after a
 * short dark beat instead of after them), and the title rises more slowly (the owner, 2026-11-08).
 */

/** The moments of the scene, in seconds from its start. */
export const INTRO = {
  /** The first letter starts to form (the mockup: 2.75 s, after the fights). */
  title: 0.6,
  /** The rule under the title grows: start and length (the mockup: 0.95 s after the title, 2.35 s). */
  rule: [1.55, 2.35],
  /** The title rises to its place: start and length (the mockup: 0.7 s; slower by the owner). */
  move: 3.8,
  moveDur: 1.6,
  /** The nick field, then Log in and Create an account: start, step, length of each. */
  menu: 4.75,
  menuPer: 0.14,
  menuDur: 0.42,
  /** The dark stage fades and the map behind comes up: start and end. */
  ambient: [3.3, 5.2],
  /** The Skip button shows after this. */
  skipFrom: 0.6,
} as const;

/**
 * [letter index, onset after `INTRO.title`, length] for the 12 letters of "Fines Imperii"
 * (0 is F, 11 the last I): hand-set in the mockup. The order jumps about the words (M, N, R, F,
 * S, I ...) and every letter overlaps several others; the gaps between onsets are uneven.
 */
export const EMERGE: readonly (readonly [number, number, number])[] = [
  [6, 0.0, 2.1],
  [2, 0.22, 1.9],
  [9, 0.41, 2.2],
  [0, 0.55, 1.8],
  [4, 0.78, 2.0],
  [11, 0.86, 1.7],
  [7, 1.07, 2.1],
  [1, 1.21, 1.6],
  [3, 1.35, 1.9],
  [10, 1.52, 1.8],
  [8, 1.66, 1.7],
  [5, 1.79, 1.6],
];

/** Onset and length of each of `n` letters: the mockup's table for 12, its pattern spread otherwise. */
export function letterTimes(n: number): readonly (readonly [number, number])[] {
  const times: [number, number][] = [];
  if (n === EMERGE.length) {
    for (const [i, start, length] of EMERGE) times[i] = [start, length];
    return times;
  }
  // Another title (a locale): the k-th letter to appear is picked by a stride that jumps about the
  // words, with the table's onsets spread over the count and its lengths in turn.
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const stride = [7, 5, 3].find((s) => gcd(s, n) === 1) ?? 1;
  const last = EMERGE[EMERGE.length - 1]?.[1] ?? 0;
  for (let k = 0; k < n; k++) {
    const start = n <= 1 ? 0 : (k * last) / (n - 1);
    times[(k * stride + Math.floor(n / 2)) % n] = [start, EMERGE[k % EMERGE.length]?.[2] ?? 1.8];
  }
  return times;
}

export const clamp = (v: number, lo = 0, hi = 1): number => Math.max(lo, Math.min(hi, v));
/** Cubic out. */
export const easeOut = (p: number): number => 1 - (1 - p) ** 3;
/** Cubic in and out. */
export const easeInOut = (p: number): number =>
  p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;

/** Progress 0..1 of each letter at t. */
export function letterProgress(times: readonly (readonly [number, number])[], t: number): number[] {
  return times.map(([start, length]) => clamp((t - INTRO.title - start) / length));
}

/** The moment the last letter is solid: from then on the real title shows, not the grain. */
export function emergeEnd(times: readonly (readonly [number, number])[]): number {
  return INTRO.title + Math.max(0, ...times.map(([start, length]) => start + length));
}

/** How many entries of the form come in one after another (the nick field, then the links). */
export const MENU_STEPS = 2;

/** The length of the whole scene. */
export const INTRO_END = Math.max(
  INTRO.move + INTRO.moveDur,
  INTRO.menu + (MENU_STEPS - 1) * INTRO.menuPer + INTRO.menuDur,
  INTRO.ambient[1],
);

export interface IntroFrame {
  /** Per letter, 0..1. */
  readonly letters: readonly number[];
  /** The letters are drawn by the grain (still forming); false: the real title shows. */
  readonly grain: boolean;
  /** The rule under the title and the interpunct, 0..1. */
  readonly rule: number;
  /** The title on its way up: 0 in the middle of the screen and large, 1 in its place. */
  readonly move: number;
  /** The entries of the form, 0..1 each. */
  readonly menu: readonly number[];
  /** The dark stage over the map, 1..0. */
  readonly cover: number;
  readonly skip: boolean;
  readonly done: boolean;
}

/** The scene at t seconds. */
export function introFrame(times: readonly (readonly [number, number])[], t: number): IntroFrame {
  const ambient = clamp((t - INTRO.ambient[0]) / (INTRO.ambient[1] - INTRO.ambient[0]));
  return {
    letters: letterProgress(times, t),
    grain: t < emergeEnd(times),
    rule: easeInOut(clamp((t - INTRO.rule[0]) / INTRO.rule[1])),
    move: easeInOut(clamp((t - INTRO.move) / INTRO.moveDur)),
    menu: Array.from({ length: MENU_STEPS }, (_, j) =>
      easeOut(clamp((t - INTRO.menu - j * INTRO.menuPer) / INTRO.menuDur)),
    ),
    cover: 1 - easeInOut(ambient),
    skip: t > INTRO.skipFrom && t < INTRO.menu,
    done: t >= INTRO_END,
  };
}

/** The mark of a session that has seen the scene (sessionStorage). */
export const INTRO_SEEN_KEY = 'sbf.introSeen';

/**
 * Whether the scene plays now, marking the session as having seen it. No storage (a private
 * window that throws, a blocked site) means no scene: the still screen at once.
 */
export function claimIntro(storage: () => Storage, reduced: boolean): boolean {
  if (reduced) return false;
  try {
    const store = storage();
    if (store.getItem(INTRO_SEEN_KEY) !== null) return false;
    store.setItem(INTRO_SEEN_KEY, '1');
    return true;
  } catch {
    return false;
  }
}
