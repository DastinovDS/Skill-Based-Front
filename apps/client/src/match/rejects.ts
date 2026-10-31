import type { MessageKey } from '../i18n/messages.ts';

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
  NOT_INTERNAL: 'reject.NOT_INTERNAL',
  MAX_WIDTH: 'reject.MAX_WIDTH',
  NOT_CITY: 'reject.NOT_CITY',
  CITY_BUSY: 'reject.CITY_BUSY',
  EDGE_BUSY: 'reject.EDGE_BUSY',
  NOT_ENOUGH_CHARGES: 'reject.NOT_ENOUGH_CHARGES',
  NO_CHANGE: 'reject.NO_CHANGE',
  STANCE_COOLDOWN: 'reject.STANCE_COOLDOWN',
  NOTHING_TO_CANCEL: 'reject.NOTHING_TO_CANCEL',
  NOT_CAPITAL: 'reject.NOT_CAPITAL',
  CITY_FULL: 'reject.CITY_FULL',
  QUEUE_FULL: 'reject.QUEUE_FULL',
  FEATURE_DISABLED: 'reject.FEATURE_DISABLED',
  ALREADY_BUILT: 'reject.ALREADY_BUILT',
  WAREHOUSE_MAX: 'reject.WAREHOUSE_MAX',
  NO_BARRACKS: 'reject.NO_BARRACKS',
  STACK_LIMIT: 'reject.STACK_LIMIT',
  IN_FIGHT: 'reject.IN_FIGHT',
  TARGET_FULL: 'reject.TARGET_FULL',
  NOT_SOURCE: 'reject.NOT_SOURCE',
  LINE_LIMIT: 'reject.LINE_LIMIT',
  LINE_CYCLE: 'reject.LINE_CYCLE',
  FACTORY_LIMIT: 'reject.FACTORY_LIMIT',
} as const satisfies Record<string, MessageKey>;

/**
 * Codes whose general message would mislead for one command (economy v2, DEC-41, #649): the same
 * code means another thing for a factory, a bunker, a supply line or a plan. Keyed `code:command`.
 */
export const REJECT_MESSAGES_BY_COMMAND = {
  'ALREADY_BUILT:build_factory': 'reject.ALREADY_BUILT.factory',
  'ALREADY_BUILT:build_bunker': 'reject.ALREADY_BUILT.bunker',
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
 * reads differently there; a code this client does not know gets a generic one.
 */
export function rejectMessageKey(code: string, command?: string): MessageKey {
  const special = `${code}:${command ?? ''}`;
  if (Object.hasOwn(REJECT_MESSAGES_BY_COMMAND, special)) {
    return REJECT_MESSAGES_BY_COMMAND[special as keyof typeof REJECT_MESSAGES_BY_COMMAND];
  }
  return Object.hasOwn(REJECT_MESSAGES, code)
    ? REJECT_MESSAGES[code as keyof typeof REJECT_MESSAGES]
    : 'reject.unknown';
}
