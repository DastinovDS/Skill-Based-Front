import type { MessageKey } from '../i18n/messages.ts';
import type { RulesetPublic } from '../protocol.gen.ts';

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
  NOT_ADJACENT: 'reject.NOT_ADJACENT',
  NOT_INTERNAL: 'reject.NOT_INTERNAL',
  MAX_WIDTH: 'reject.MAX_WIDTH',
  ROAD_KIND_MISMATCH: 'reject.ROAD_KIND_MISMATCH',
  NOT_CITY: 'reject.NOT_CITY',
  NOT_SUPPLIED: 'reject.NOT_SUPPLIED',
  CITY_BUSY: 'reject.CITY_BUSY',
  EDGE_BUSY: 'reject.EDGE_BUSY',
  NOT_ENOUGH_CHARGES: 'reject.NOT_ENOUGH_CHARGES',
  NO_CHANGE: 'reject.NO_CHANGE',
  STANCE_COOLDOWN: 'reject.STANCE_COOLDOWN',
  NOTHING_TO_CANCEL: 'reject.NOTHING_TO_CANCEL',
  NOT_CAPITAL: 'reject.NOT_CAPITAL',
  CITY_FULL: 'reject.CITY_FULL',
  RECRUIT_COOLDOWN: 'reject.RECRUIT_COOLDOWN',
} as const satisfies Record<string, MessageKey>;

/** The message for a `reject_code` from `ack`; a code this client does not know gets a generic one. */
export function rejectMessageKey(code: string): MessageKey {
  return Object.hasOwn(REJECT_MESSAGES, code)
    ? REJECT_MESSAGES[code as keyof typeof REJECT_MESSAGES]
    : 'reject.unknown';
}

/** Price of a move order in hundredths of CP, from the ruleset the server sent. */
export function moveCost(rules: RulesetPublic, planned: boolean): number {
  return planned ? rules.cost.planned_move : rules.cost.move;
}
