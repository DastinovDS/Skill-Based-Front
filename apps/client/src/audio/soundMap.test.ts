import { describe, expect, it } from 'vitest';
import type { ServerMsg } from '../protocol.gen.ts';
import { cuesOf } from './soundMap.ts';

const event = (
  kind: string,
  data: Record<string, number | string | boolean | null>,
): ServerMsg => ({
  type: 'event',
  tick: 40,
  kind,
  data,
});

describe('cuesOf', () => {
  it('makes a hit for a fight round, with a loss sound when my units died', () => {
    const quiet = event('fight_round', { losses_0: 0, losses_1: 1 });
    expect(cuesOf(quiet, 0)).toEqual([{ id: 'fightRound', tick: 40 }]);
    expect(cuesOf(quiet, 1)).toEqual([
      { id: 'fightRound', tick: 40 },
      { id: 'unitLoss', tick: 40 },
    ]);
  });

  it('plays the loss sound for my attrition only', () => {
    expect(cuesOf(event('attrition', { player: 0 }), 0)).toEqual([{ id: 'unitLoss', tick: 40 }]);
    expect(cuesOf(event('attrition', { player: 1 }), 0)).toEqual([]);
  });

  it('tells my capture from the enemy one', () => {
    expect(cuesOf(event('node_captured', { node: 3, player: 0 }), 0)[0]?.id).toBe('capture');
    expect(cuesOf(event('node_captured', { node: 3, player: 1 }), 0)[0]?.id).toBe('captureLost');
  });

  it('confirms an accepted order at once and says nothing for a rejected one', () => {
    const ack = (reject_code: string | null): ServerMsg => ({
      type: 'ack',
      seq: 1,
      applied_tick: 5,
      path: null,
      arrive_tick: null,
      reject_code,
    });
    expect(cuesOf(ack(null), 0)).toEqual([{ id: 'orderOk', tick: null }]);
    expect(cuesOf(ack('NOT_ENOUGH_CP'), 0)).toEqual([]);
  });

  it('ends the match with a win, a defeat or a draw sound', () => {
    const end = (winner: 0 | 1 | null): ServerMsg =>
      ({ type: 'match_end', tick: 9, reason: 'timer', winner, vp: [1, 1] }) as ServerMsg;
    expect(cuesOf(end(0), 0)[0]?.id).toBe('matchWin');
    expect(cuesOf(end(1), 0)[0]?.id).toBe('matchLose');
    expect(cuesOf(end(null), 0)[0]?.id).toBe('matchDraw');
  });

  it('ignores other events and messages', () => {
    expect(cuesOf(event('charges_produced', { player: 0 }), 0)).toEqual([]);
    expect(cuesOf({ type: 'pong', id: 1 }, 0)).toEqual([]);
  });
});
