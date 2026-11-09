import { describe, expect, it } from 'vitest';
import { CAPITAL_RESULT_DELAY_MS } from '../render/style.ts';
import { resultDelayMs } from './resultDelay.ts';

describe('resultDelayMs (#819)', () => {
  it('waits 1.7 s after the capture of a capital: render delay, flood, a settled moment (not the whole walk in)', () => {
    expect(CAPITAL_RESULT_DELAY_MS).toBe(1700);
    expect(resultDelayMs({ reason: 'capital_captured' })).toBe(CAPITAL_RESULT_DELAY_MS);
  });

  it('opens the result at once for every other end', () => {
    for (const reason of ['timer', 'forfeit', 'disconnect', 'double_defeat'] as const) {
      expect(resultDelayMs({ reason })).toBe(0);
    }
  });
});
