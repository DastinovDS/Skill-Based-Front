/**
 * Which events become a toast (ui-style 10.4, U2; the owner's marks on the pop-up catalogue, #765).
 * Pure; `toastState.svelte.ts` keeps the list. A toast is for news the map does not tell by itself:
 * a node the enemy took, a capture that could not be paid (DEC-38) and a barracks or a factory
 * finished (#972). An own capture, a fight, attrition, a lost recruit queue and a lost rally point
 * show on the map only; there is no journal either.
 */
import type { EventMsg, PlayerId } from '../protocol.gen.ts';
import { tf } from '../i18n/index.ts';
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

/** The event kinds that can give a toast. */
export const TOAST_EVENT_KINDS: ReadonlySet<string> = new Set([
  // Only the enemy's capture (#765, A1: the own capture is the biggest thing on the map already).
  'node_captured',
  'capture_failed',
  // #972, V12: a building finished (the builder's event only), with its own icon.
  'barracks_built',
  'factory_built',
]);

function nodeOf(data: EventMsg['data']): number {
  return typeof data.node === 'number' ? data.node : 0;
}

/** The toast of `event` for player `me`, or `null`. A place is told by its name (#449). */
export function toastOf(
  event: Pick<EventMsg, 'kind' | 'data'>,
  me: PlayerId,
  names: NodeNamer,
): ToastBody | null {
  const { data } = event;
  const node = names(nodeOf(data));
  switch (event.kind) {
    case 'node_captured':
      if (data.player === me) return null;
      return { tone: 'enemy', icon: 'flag', text: tf('event.node_captured.enemy', { node }) };
    case 'capture_failed':
      // DEC-38: `bounce`, the group turns back; `encircled`, a returning group could not retake
      // its home and died.
      return {
        tone: 'warn',
        icon: 'alert',
        text: tf(
          data.result === 'encircled'
            ? 'event.capture_failed.encircled'
            : 'event.capture_failed.bounce',
          { node },
        ),
      };
    case 'barracks_built':
    case 'factory_built':
      // Only the builder gets the event; one that names the other player is not told here.
      if (typeof data.player === 'number' && data.player !== me) return null;
      return {
        tone: 'mine',
        icon: event.kind === 'barracks_built' ? 'barracks' : 'factory',
        cut: true,
        text: tf(event.kind === 'barracks_built' ? 'event.barracks_built' : 'event.factory_built', {
          node,
        }),
      };
    default:
      return null;
  }
}
