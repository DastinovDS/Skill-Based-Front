/**
 * The keys of the replay viewer (ui-style 13.7): `Space` play or pause, `Left` and `Right` five
 * seconds back and forth, `1`, `2`, `3` the speeds, `Home` fit the map, `Esc` back.
 */
import { SPEEDS, type Speed } from './replayPlayer.ts';

export type ReplayKeyAction =
  | { readonly kind: 'toggle' }
  | { readonly kind: 'skip'; readonly seconds: number }
  | { readonly kind: 'speed'; readonly speed: Speed }
  | { readonly kind: 'fit' }
  | { readonly kind: 'back' };

export const SKIP_SECONDS = 5;

export interface ReplayKeyInput {
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  /** The key went down on a button, a link or a field that has its own use for it. */
  readonly onControl: boolean;
}

const DIGITS: Record<string, Speed> = {
  Digit1: SPEEDS[0],
  Numpad1: SPEEDS[0],
  Digit2: SPEEDS[1],
  Numpad2: SPEEDS[1],
  Digit3: SPEEDS[2],
  Numpad3: SPEEDS[2],
};

/** What a key press does in the viewer; `null`: not ours. */
export function replayKey(input: ReplayKeyInput): ReplayKeyAction | null {
  if (input.ctrlKey || input.metaKey || input.altKey) return null;
  switch (input.code) {
    // A focused button takes Space (and Enter) itself: the press is its click.
    case 'Space':
      return input.onControl ? null : { kind: 'toggle' };
    case 'ArrowLeft':
      return { kind: 'skip', seconds: -SKIP_SECONDS };
    case 'ArrowRight':
      return { kind: 'skip', seconds: SKIP_SECONDS };
    case 'Home':
      return { kind: 'fit' };
    case 'Escape':
      return { kind: 'back' };
    default: {
      const speed = DIGITS[input.code];
      return speed === undefined ? null : { kind: 'speed', speed };
    }
  }
}
