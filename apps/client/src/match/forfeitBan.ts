import type { UnratedReason } from '../protocol.gen.ts';

/**
 * Whether a forfeit in this match counts toward the queue ban (DEC-34, item 3). The server flags
 * a match rated when at least one side's rating can change, so a calibrated player facing a
 * calibrating opponent (`opponent_calibrating`) is unrated itself but still resigns in a rated
 * match. The length comes from `welcome.forfeit_ban_s`; the client only picks the text.
 */
export function forfeitCountsTowardBan(welcome: {
  rated: boolean;
  unrated_reason: UnratedReason | null;
}): boolean {
  return welcome.rated || welcome.unrated_reason === 'opponent_calibrating';
}
