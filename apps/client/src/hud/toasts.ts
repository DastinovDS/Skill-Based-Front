/**
 * Which events and answers become a toast (ui-style 10.4, U2). Pure; `toastState.svelte.ts` keeps
 * the list. Toasts are for fights, captures and lost cities, attrition, a lost recruit queue and a
 * refused command; VP awards are only in the score of the top bar, and everything else is in the
 * journal.
 */
import type { PlayerId } from '../protocol.gen.ts';
import { eventText } from './eventText.ts';
import type { HudEvent } from './hudData.ts';
import type { IconName } from './icons.ts';
import type { NodeNamer } from './nodeName.ts';

/** The colour of the left edge: own, the opponent, a warning, neutral (the icon says it as well). */
export type ToastTone = 'mine' | 'enemy' | 'warn' | 'neutral';

export interface ToastBody {
  readonly tone: ToastTone;
  readonly icon: IconName;
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
    default:
      return { tone: 'warn', icon: 'alert', text };
  }
}
