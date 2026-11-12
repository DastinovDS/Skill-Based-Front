import type { MessageKey } from '../i18n/messages.ts';
import type { OrderFeedback } from './orderUi.svelte.ts';

/**
 * Reject codes of the simulation (`RejectCode` in `packages/sim/src/gow_sim/commands.py`).
 * `rejects.test.ts` compares this list with the Python enum.
 *
 * A refused command is no toast (the owner's marks on the pop-up catalogue, #765): the map answers
 * it (a refused ghost shakes and fades, the CP gauge flashes for `NOT_ENOUGH_CP`, the capacity ring
 * pulses for `CITY_FULL`), the menus do not offer what would be refused, and the console keeps a
 * line of every refusal for the developers. Only a code this client does not know is still told
 * (`reject.unknown`): the client and the server are out of step.
 */
export const REJECT_CODES = [
  'NOT_FOUND_OR_HIDDEN',
  'NOT_OWNER',
  'NOT_ENOUGH_CP',
  'GROUP_ON_EDGE',
  'GROUP_BUSY',
  'NO_PATH',
  'INVALID_ARGUMENT',
  'NOT_SAME_NODE',
  'NOT_CITY',
  'CITY_BUSY',
  'NO_CHANGE',
  'NOTHING_TO_CANCEL',
  'CITY_FULL',
  'QUEUE_FULL',
  'ALREADY_BUILT',
  'NO_BARRACKS',
  'STACK_LIMIT',
  'IN_FIGHT',
  'FACTORY_LIMIT',
  'NOT_ADJACENT',
] as const;

const KNOWN: ReadonlySet<string> = new Set(REJECT_CODES);

/** A code of the simulation this client knows (else the server is newer than the client). */
export function isKnownReject(code: string): boolean {
  return KNOWN.has(code);
}

/**
 * The reason a group order went without some of its groups (DEC-48, item B3: the toast
 * `orders.dropped` stays). A member is checked like a `Move` of that group, so only the codes of a
 * move come here; any other gets the generic text.
 */
export const DROPPED_REASONS = {
  NOT_FOUND_OR_HIDDEN: 'reject.NOT_FOUND_OR_HIDDEN',
  NOT_OWNER: 'reject.NOT_OWNER',
  GROUP_ON_EDGE: 'reject.GROUP_ON_EDGE',
  GROUP_BUSY: 'reject.GROUP_BUSY',
  NO_PATH: 'reject.NO_PATH',
  STACK_LIMIT: 'reject.STACK_LIMIT',
  // DEC-48, item B4: the one member the client can send that is not valid stands in the target.
  INVALID_ARGUMENT: 'reject.INVALID_ARGUMENT.groupMove',
  // A member in a fight is not part of the order (DEC-40; under "round" it could only withdraw).
  IN_FIGHT: 'reject.IN_FIGHT.stays',
} as const satisfies Record<string, MessageKey>;

/** The reason of the members a group order dropped with `code`; `planned`: a planned order. */
export function droppedReasonKey(code: string, planned = false): MessageKey {
  // A planned order is not split (DEC-48, decision (10), #940): the target is closed to it.
  if (planned && code === 'STACK_LIMIT') return 'reject.STACK_LIMIT.planned';
  return Object.hasOwn(DROPPED_REASONS, code)
    ? DROPPED_REASONS[code as keyof typeof DROPPED_REASONS]
    : 'reject.unknown';
}

/**
 * The toast of a refused or lost command: only a code this client does not know (#765, B5, told
 * without the command word, B1). A lost answer is no toast either (B2): the status bar says
 * "Reconnecting".
 */
export function refusalToast(feedback: OrderFeedback): MessageKey | null {
  return feedback.kind === 'rejected' && !isKnownReject(feedback.code) ? 'reject.unknown' : null;
}

/** The console line of a refused or lost command (the developers still see each one, #765). */
export function refusalLine(feedback: OrderFeedback): string | null {
  if (feedback.kind === 'rejected') {
    return `[client] command refused: ${feedback.cmd.type} ${feedback.code}`;
  }
  if (feedback.kind === 'lost') return `[client] command lost: ${feedback.cmd.type}`;
  return null;
}
