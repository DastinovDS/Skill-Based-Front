import { describe, expect, it } from 'vitest';
import type { EventMsg } from '../protocol.gen.ts';
import { STAY_FADE_MS, STAY_SHOW_MS, stayMarks } from './rallyStay.ts';

const stay = (tick: number, player: number, node: number): EventMsg => ({
  type: 'event',
  tick,
  kind: 'rally_walk_no_cp',
  data: { player, group: 'g', node, target: 12 },
});

describe('stayMarks (#930: a recruit that stays home for want of CP)', () => {
  it('crosses the mark at the gate of the own city from its event, by the render tick', () => {
    const events = [stay(100, 0, 13)];
    expect(stayMarks(events, 0, 99, 10, false)).toEqual([]);
    expect(stayMarks(events, 0, 100, 10, false)).toEqual([{ node: 13, target: 12, alpha: 1 }]);
  });

  it('fades over the last 0.6 s of its 1.6 s, and stands with less motion', () => {
    const events = [stay(100, 0, 13)];
    // 1.3 s: half way through the fade.
    expect(stayMarks(events, 0, 113, 10, false)[0]?.alpha).toBeCloseTo(
      (STAY_SHOW_MS - 1300) / STAY_FADE_MS,
    );
    expect(stayMarks(events, 0, 113, 10, true)[0]?.alpha).toBe(1);
    expect(stayMarks(events, 0, 116, 10, false)).toEqual([]);
  });

  it('shows only the own events', () => {
    expect(stayMarks([stay(100, 1, 13)], 0, 100, 10, false)).toEqual([]);
  });
});
