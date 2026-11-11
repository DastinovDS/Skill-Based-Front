/**
 * The plain signs of the three ways on the main menu (#968, ui-style 74, D): an hourglass for the
 * queue, a cog for the bot, a chain link for the invite. Drawn in the cut language of
 * `theme/cutIcons.ts` (a dark casing under an ink line, square ends; a solid ruled in ink) from the
 * mockup `docs/design/mockups/menu-icons.html` (variant D). Ink only: the choice reads by shape and
 * brightness, never by colour.
 */
import type { Way } from './play.ts';

/** One part of a sign: its outline, whether its inside is ruled, and the weight of its line. */
export interface SignPart {
  readonly d: string;
  /** The inside is a dark plate with ruled ink lines. */
  readonly ruled: boolean;
  /** Scale of the line weight. */
  readonly lw: number;
}

export interface Sign {
  /** The view box [x, y, width, height]. */
  readonly box: readonly [number, number, number, number];
  readonly parts: readonly SignPart[];
}

const part = (d: string, ruled = false, lw = 1): SignPart => ({ d, ruled, lw });

/** The line weight of a sign, before the weight of a part. */
export const SIGN_LINE = 0.82;

export const WAY_SIGNS: Readonly<Record<Way, Sign>> = {
  // The queue: two glass halves with the sand above and below, a cap at each end.
  match: {
    box: [-14, -13, 28, 26],
    parts: [
      part(
        'M-6.2 -10 C-6.2 -4.6 -1.5 -2.4 -1.5 0 C-1.5 2.4 -6.2 4.6 -6.2 10 M6.2 -10 C6.2 -4.6 1.5 -2.4 1.5 0 C1.5 2.4 6.2 4.6 6.2 10',
      ),
      part(
        'M-4.9 -6.4 L4.9 -6.4 C3.8 -4.1 1.2 -2.6 0 -1.1 C-1.2 -2.6 -3.8 -4.1 -4.9 -6.4 Z',
        true,
        0.5,
      ),
      part('M-5.2 9.4 C-4.2 6.1 -1.6 4.8 0 3.2 C1.6 4.8 4.2 6.1 5.2 9.4 Z', true, 0.5),
      part('M0 -0.6 L0 3', false, 0.5),
      part('M-8.6 -12.4 L8.6 -12.4 L8.6 -10 L-8.6 -10 Z', true, 0.9),
      part('M-8.6 10 L8.6 10 L8.6 12.4 L-8.6 12.4 Z', true, 0.9),
    ],
  },
  // The bot: a ten-toothed cog with an axle hole, a ring cut into it.
  bot: {
    box: [-14, -13, 28, 26],
    parts: [
      part(
        'M-1.82 -9.22 L-1.35 -11.92 L1.35 -11.92 L1.82 -9.22 L3.95 -8.53 L5.91 -10.44 L8.1 -8.85 L6.89 -6.39 L8.21 -4.58 L10.92 -4.97 L11.76 -2.4 L9.33 -1.12 L9.33 1.12 L11.76 2.4 L10.92 4.97 L8.21 4.58 L6.89 6.39 L8.1 8.85 L5.91 10.44 L3.95 8.53 L1.82 9.22 L1.35 11.92 L-1.35 11.92 L-1.82 9.22 L-3.95 8.53 L-5.91 10.44 L-8.1 8.85 L-6.89 6.39 L-8.21 4.58 L-10.92 4.97 L-11.76 2.4 L-9.33 1.12 L-9.33 -1.12 L-11.76 -2.4 L-10.92 -4.97 L-8.21 -4.58 L-6.89 -6.39 L-8.1 -8.85 L-5.91 -10.44 L-3.95 -8.53 Z M4.2 0 C4.2 2.32 2.32 4.2 0 4.2 C-2.32 4.2 -4.2 2.32 -4.2 0 C-4.2 -2.32 -2.32 -4.2 0 -4.2 C2.32 -4.2 4.2 -2.32 4.2 0 Z',
        true,
      ),
      part(
        'M6.6 0 C6.6 3.65 3.65 6.6 0 6.6 C-3.65 6.6 -6.6 3.65 -6.6 0 C-6.6 -3.65 -3.65 -6.6 0 -6.6 C3.65 -6.6 6.6 -3.65 6.6 0 Z',
        false,
        0.5,
      ),
    ],
  },
  // The invite: two links of a chain at 45 degrees, the lower one drawn over the upper where they cross.
  friend: {
    box: [-14, -13, 28, 26],
    parts: [
      part(
        'M-8.56 3.04 L-2.9 -2.62 C-1.38 -4.14 1.09 -4.14 2.62 -2.62 C4.14 -1.09 4.14 1.38 2.62 2.9 L-3.04 8.56 C-4.56 10.08 -7.03 10.08 -8.56 8.56 C-10.08 7.03 -10.08 4.56 -8.56 3.04 Z',
        false,
        1.45,
      ),
      part(
        'M-2.62 -2.9 L3.04 -8.56 C4.56 -10.08 7.03 -10.08 8.56 -8.56 C10.08 -7.03 10.08 -4.56 8.56 -3.04 L2.9 2.62 C1.38 4.14 -1.09 4.14 -2.62 2.62 C-4.14 1.09 -4.14 -1.38 -2.62 -2.9 Z',
        false,
        1.45,
      ),
      part('M2.62 -2.62 C4.14 -1.09 4.14 1.38 2.62 2.9', false, 1.45),
    ],
  },
};
