import { describe, expect, it } from 'vitest';
import { CAPACITY_PULSE, capacityPulse } from './capacityPulse.ts';

describe('the capacity ring pulse of a recruit with no room (#765, B21)', () => {
  const beat = CAPACITY_PULSE.ms / CAPACITY_PULSE.beats;

  it('swells twice by its size and settles, never by colour', () => {
    expect(capacityPulse(0, false)).toEqual({ scale: 1, alpha: 1 });
    expect(capacityPulse(beat / 2, false)?.scale).toBeCloseTo(1 + CAPACITY_PULSE.swell);
    expect(capacityPulse(beat, false)?.scale).toBeCloseTo(1);
    expect(capacityPulse(beat * 1.5, false)?.scale).toBeCloseTo(1 + CAPACITY_PULSE.swell);
    expect(capacityPulse(beat / 2, false)?.alpha).toBe(1);
  });

  it('dims and comes back instead with "less motion": the size stays', () => {
    const mid = capacityPulse(beat / 2, true);
    expect(mid?.scale).toBe(1);
    expect(mid?.alpha).toBeCloseTo(1 - CAPACITY_PULSE.dim);
    expect(capacityPulse(beat, true)?.alpha).toBeCloseTo(1);
  });

  it('is over after its time, and not begun before the refusal', () => {
    expect(capacityPulse(CAPACITY_PULSE.ms, false)).toBeNull();
    expect(capacityPulse(-1, false)).toBeNull();
  });
});
