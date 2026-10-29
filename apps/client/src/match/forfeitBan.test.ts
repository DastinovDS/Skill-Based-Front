import { describe, expect, it } from 'vitest';
import type { UnratedReason } from '../protocol.gen.ts';
import { forfeitCountsTowardBan } from './forfeitBan.ts';

describe('forfeitCountsTowardBan (DEC-34, item 3)', () => {
  it('counts in a rated match', () => {
    expect(forfeitCountsTowardBan({ rated: true, unrated_reason: null })).toBe(true);
  });

  it('counts when only the opponent is rated (calibrating)', () => {
    expect(forfeitCountsTowardBan({ rated: false, unrated_reason: 'opponent_calibrating' })).toBe(
      true,
    );
  });

  it.each<UnratedReason>(['casual', 'guest', 'opponent_guest', 'opponent_limit'])(
    'does not count when the match is unrated for %s',
    (reason) => {
      expect(forfeitCountsTowardBan({ rated: false, unrated_reason: reason })).toBe(false);
    },
  );
});
