import { describe, expect, it } from 'vitest';
import { CHARGE_STEP_TICKS, MARCH_CYCLE, cycleCharge, marchLocation } from './devMotion.ts';

describe('cycleCharge', () => {
  it('goes from full to empty and back one unit a step', () => {
    const seen = Array.from({ length: 8 }, (_, i) => cycleCharge(4, i * CHARGE_STEP_TICKS, 0));
    expect(seen).toEqual([4, 3, 2, 1, 0, 1, 2, 3]);
    expect(cycleCharge(4, 8 * CHARGE_STEP_TICKS, 0)).toBe(4);
  });

  it('leaves a single unit alone', () => {
    expect(cycleCharge(1, 500, 3)).toBe(1);
  });
});

describe('marchLocation', () => {
  const road = { id: 7, a: 1, b: 2 };
  it('waits, walks out, waits and walks back', () => {
    expect(marchLocation(road, 0)).toEqual({ kind: 'node', node: 1 });
    expect(marchLocation(road, 40 + 75)).toEqual({
      kind: 'edge',
      edge: 7,
      from_node: 1,
      progress: 500,
    });
    expect(marchLocation(road, 40 + 150)).toEqual({ kind: 'node', node: 2 });
    expect(marchLocation(road, 190 + 40 + 75)).toEqual({
      kind: 'edge',
      edge: 7,
      from_node: 2,
      progress: 500,
    });
    expect(marchLocation(road, MARCH_CYCLE)).toEqual({ kind: 'node', node: 1 });
  });
});
