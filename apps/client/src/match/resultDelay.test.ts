import { describe, expect, it } from 'vitest';
import { CAPITAL_RESULT_DELAY_MS } from '../render/style.ts';
import { resultDelayMs } from './resultDelay.ts';

describe('resultDelayMs (#819)', () => {
  it('waits 3 s after the capture of a capital: render delay, the walk in, flood, a settled moment', () => {
    expect(CAPITAL_RESULT_DELAY_MS).toBe(3000);
    expect(resultDelayMs({ reason: 'capital_captured' })).toBe(CAPITAL_RESULT_DELAY_MS);
  });

  it('opens the result at once for every other end', () => {
    for (const reason of ['timer', 'forfeit', 'disconnect', 'double_defeat'] as const) {
      expect(resultDelayMs({ reason })).toBe(0);
    }
  });
});
