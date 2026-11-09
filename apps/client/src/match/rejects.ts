import type { MessageKey } from '../i18n/messages.ts';
import type { Retreat } from '../protocol.gen.ts';

/**
 * Reject codes of the simulation (`RejectCode` in `packages/sim/src/gow_sim/commands.py`), each
 * with its message key. `rejects.test.ts` compares this list with the Python enum.
 */
export const REJECT_MESSAGES = {
  NOT_FOUND_OR_HIDDEN: 'reject.NOT_FOUND_OR_HIDDEN',
  NOT_OWNER: 'reject.NOT_OWNER',
  NOT_ENOUGH_CP: 'reject.NOT_ENOUGH_CP',
  GROUP_ON_EDGE: 'reject.GROUP_ON_EDGE',
  GROUP_BUSY: 'reject.GROUP_BUSY',
  NO_PATH: 'reject.NO_PATH',
  INVALID_ARGUMENT: 'reject.INVALID_ARGUMENT',
  NOT_SAME_NODE: 'reject.NOT_SAME_NODE',
  NOT_CITY: 'reject.NOT_CITY',
  CITY_BUSY: 'reject.CITY_BUSY',
  NO_CHANGE: 'reject.NO_CHANGE',
  NOTHING_TO_CANCEL: 'reject.NOTHING_TO_CANCEL',
  CITY_FULL: 'reject.CITY_FULL',
  QUEUE_FULL: 'reject.QUEUE_FULL',
  ALREADY_BUILT: 'reject.ALREADY_BUILT',
  NO_BARRACKS: 'reject.NO_BARRACKS',
  STACK_LIMIT: 'reject.STACK_LIMIT',
  IN_FIGHT: 'reject.IN_FIGHT',
  FACTORY_LIMIT: 'reject.FACTORY_LIMIT',
  NOT_ADJACENT: 'reject.NOT_ADJACENT',
} as const satisfies Record<string, MessageKey>;

/**
 * Codes whose general message would mislead for one command (economy v2, DEC-41, #649): the same
 * code means another thing for a factory, a bunker, a supply line or a plan. Keyed `code:command`.
 */
export const REJECT_MESSAGES_BY_COMMAND = {
  'ALREADY_BUILT:build_factory': 'reject.ALREADY_BUILT.factory',
  'ALREADY_BUILT:build_bunker': 'reject.ALREADY_BUILT.bunker',
  'ALREADY_BUILT:fortify_road': 'reject.ALREADY_BUILT.fort',
  'FEATURE_DISABLED:fortify_road': 'reject.FEATURE_DISABLED.fort',
  'ALREADY_BUILT:upgrade_warehouse': 'reject.ALREADY_BUILT.warehouse',
  'NOT_CITY:build_factory': 'reject.NOT_CITY.factory',
  'NOT_CITY:draw_line': 'reject.NOT_CITY.line',
  'NOT_OWNER:draw_line': 'reject.NOT_OWNER.line',
  'INVALID_ARGUMENT:draw_line': 'reject.INVALID_ARGUMENT.line',
  'INVALID_ARGUMENT:move': 'reject.INVALID_ARGUMENT.move',
  'NOT_FOUND_OR_HIDDEN:remove_line': 'reject.NOT_FOUND_OR_HIDDEN.line',
  'NOTHING_TO_CANCEL:release_plan': 'reject.NOTHING_TO_CANCEL.plan',
  'IN_FIGHT:release_plan': 'reject.IN_FIGHT.plan',
} as const satisfies Record<string, MessageKey>;

/**
 * The message for a `reject_code` from `ack`, told for the command `type` it answers when the code
 * reads differently there; a code this client does not know gets a generic one. Under
 * `combat.retreat = "none"` (DEC-40) `IN_FIGHT` is not "the group can only withdraw": nobody can.
 */
export function rejectMessageKey(code: string, command?: string, retreat?: Retreat): MessageKey {
  if (retreat === 'none' && code === 'IN_FIGHT' && command !== 'release_plan') {
    return 'reject.IN_FIGHT.stays';
  }
  const special = `${code}:${command ?? ''}`;
  if (Object.hasOwn(REJECT_MESSAGES_BY_COMMAND, special)) {
    return REJECT_MESSAGES_BY_COMMAND[special as keyof typeof REJECT_MESSAGES_BY_COMMAND];
  }
  return Object.hasOwn(REJECT_MESSAGES, code)
    ? REJECT_MESSAGES[code as keyof typeof REJECT_MESSAGES]
    : 'reject.unknown';
}
