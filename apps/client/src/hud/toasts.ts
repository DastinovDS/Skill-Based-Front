/**
 * Which events and answers become a toast (ui-style 10.4, U2). Pure; `toastState.svelte.ts` keeps
 * the list. Toasts are for fights, captures and lost cities, a capture that could not be paid
 * (DEC-38), attrition, a lost recruit queue, a barracks or a factory finished (#972) and a refused command; VP awards are only in the score of the top bar, and everything else is in the
 * journal.
 */
import type { PlayerId } from '../protocol.gen.ts';
import { eventText } from './eventText.ts';
import type { HudEvent } from './hudData.ts';
import type { AnyIconName } from './icons.ts';
import type { NodeNamer } from './nodeName.ts';

/** The colour of the left edge: own, the opponent, a warning, neutral (the icon says it as well). */
type ToastTone = 'mine' | 'enemy' | 'warn' | 'neutral';

export interface ToastBody {
  readonly tone: ToastTone;
  readonly icon: AnyIconName;
  /** Draw the Engraved "Cut" icon (the building icons of the map, #972) where the icon has one. */
  readonly cut?: boolean;
  readonly text: string;
}

export interface Toast extends ToastBody {
  readonly id: number;
}

/** The event kinds with a toast. */
export const TOAST_EVENT_KINDS: ReadonlySet<string> = new Set([
  'node_captured',
  'fight_ended',
  'attrition',
  'recruit_queue_lost',
  'capture_failed',
  // #972, V12: a building finished (the builder's event only), with its own icon.
  'barracks_built',
  'factory_built',
  // DEC-48, item I3: the alerts of the recruit rally point. A recruit that stays home for want of
  // CP hangs a strip from the bar instead (#930, W10: `AlertStack`).
  'rally_point_cleared',
]);

/** The toast of `event` for player `me`, or `null` if the event goes to the journal only. */
export function toastOf(event: HudEvent, me: PlayerId, names: NodeNamer): ToastBody | null {
  if (!TOAST_EVENT_KINDS.has(event.kind)) return null;
  const text = eventText(event, me, names);
  if (text === '') return null;
  switch (event.kind) {
    case 'node_captured':
      // A lost city is the opponent's colour: the loss is the news.
      return { tone: event.data.player === me ? 'mine' : 'enemy', icon: 'flag', text };
    case 'fight_ended':
      return { tone: 'neutral', icon: 'war', text };
    case 'barracks_built':
    case 'factory_built':
      // Only the builder gets the event; one that names the other player is not told here.
      if (typeof event.data.player === 'number' && event.data.player !== me) return null;
      return {
        tone: 'mine',
        icon: event.kind === 'barracks_built' ? 'barracks' : 'factory',
        cut: true,
        text,
      };
    default:
      return { tone: 'warn', icon: 'alert', text };
  }
}
