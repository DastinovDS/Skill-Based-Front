import { describe, expect, it } from 'vitest';
import type { SelfView } from '../protocol.gen.ts';
import { DEV_RULES_FLOW, DEV_RULES_STANCES } from './devFeed.ts';
import { atCap, stanceProgress, steppedShare, supplyRail, vpShare } from './topBar.ts';

describe('atCap', () => {
  it('knows the cap', () => {
    expect(atCap(500, 500)).toBe(true);
    expect(atCap(499, 500)).toBe(false);
  });
});

describe('vpShare', () => {
  it('is half and half while nobody scored', () => {
    expect(vpShare(0, 0)).toBe(50);
  });

  it('is the share of my VP of both sides, in percent', () => {
    expect(vpShare(4, 6)).toBe(40);
    expect(vpShare(6, 0)).toBe(100);
    expect(vpShare(0, 6)).toBe(0);
  });
});

describe('stanceProgress (DEC-44)', () => {
  const me = (stance: SelfView['stance'], cp: number | null, capital: number | null): SelfView => ({
    cp: 300,
    stance,
    leaf_shift: 0,
    leaf_shift_max: 2,
    next_dispatch_tick: 10,
    cp_ticks: cp,
    capital_ticks: capital,
  });

  it('divides the counters of the view by the periods of the stance', () => {
    // War: 1 CP per 80 ticks, a charge of the capital per 400; 10 ticks are a second.
    expect(stanceProgress(DEV_RULES_STANCES, me('war', 60, 100))).toEqual({
      cp: { share: 0.75, seconds: 2 },
      capital: { share: 0.25, seconds: 30 },
    });
    // Economy: 1 CP per 200 ticks, a charge per 100; the seconds round up.
    expect(stanceProgress(DEV_RULES_STANCES, me('economy', 1, 99))).toEqual({
      cp: { share: 0.005, seconds: 20 },
      capital: { share: 0.99, seconds: 1 },
    });
  });

  it('keeps the share of the bars across a stance change', () => {
    // The server carries the counters over (DEC-44, #792): War 60 of 80 and 100 of 400 become
    // Economy 60 * 200 // 80 = 150 of 200 and 100 * 100 // 400 = 25 of 100.
    const war = stanceProgress(DEV_RULES_STANCES, me('war', 60, 100));
    const economy = stanceProgress(DEV_RULES_STANCES, me('economy', 150, 25));
    expect(economy?.cp.share).toBe(war?.cp.share);
    expect(economy?.capital.share).toBe(war?.capital.share);
    // Rounded down: Balance 33 of 100 becomes War 33 * 80 // 100 = 26 of 80, under one tick less.
    const balance = stanceProgress(DEV_RULES_STANCES, me('balance', 33, 0));
    const after = stanceProgress(DEV_RULES_STANCES, me('war', 26, 0));
    expect(after?.cp.share).toBeLessThanOrEqual(balance?.cp.share ?? 0);
    expect((balance?.cp.share ?? 0) - (after?.cp.share ?? 0)).toBeLessThan(1 / 80);
  });

  it('is null without stances in the ruleset', () => {
    expect(stanceProgress(DEV_RULES_FLOW, me('balance', null, null))).toBeNull();
  });
});

describe('supplyRail (#1067, DEC-44)', () => {
  const me = (stance: SelfView['stance'], capital: number): SelfView => ({
    cp: 300,
    stance,
    leaf_shift: 0,
    leaf_shift_max: 2,
    next_dispatch_tick: 10,
    cp_ticks: 0,
    capital_ticks: capital,
  });
  /** The rules with the capital periods of `mvp-7` after the map tempo of `narrows` (DEC-46). */
  const narrows = {
    ...DEV_RULES_STANCES,
    stances: {
      ...DEV_RULES_STANCES.stances,
      capital_period_ticks: { economy: 131, balance: 262, war: 524 },
    },
  };

  it('ticks every 5 s of the period of the stance: 2, 4 and 8 spans', () => {
    // Economy 100, Balance 200, War 400 ticks: 10, 20 and 40 s at 10 ticks a second.
    expect(supplyRail(DEV_RULES_STANCES, me('economy', 0))?.ticks).toEqual([0, 0.5, 1]);
    expect(supplyRail(DEV_RULES_STANCES, me('balance', 0))?.ticks).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(supplyRail(DEV_RULES_STANCES, me('war', 0))?.ticks).toHaveLength(9);
    // A scaled period spreads its spans evenly: 13.1, 26.2 and 52.4 s give 3, 5 and 10.
    expect(supplyRail(narrows, me('economy', 0))?.ticks).toHaveLength(4);
    expect(supplyRail(narrows, me('balance', 0))?.ticks).toHaveLength(6);
    expect(supplyRail(narrows, me('war', 0))?.ticks).toHaveLength(11);
  });

  it('fills by the capital counter and turns ready in the last 3 s', () => {
    expect(supplyRail(DEV_RULES_STANCES, me('war', 100))).toMatchObject({
      share: 0.25,
      seconds: 30,
      periodSeconds: 40,
      ready: false,
    });
    expect(supplyRail(DEV_RULES_STANCES, me('war', 370))?.ready).toBe(true);
    expect(supplyRail(DEV_RULES_STANCES, me('war', 369))?.ready).toBe(false);
  });

  it('keeps its share across a stance change: the server carries the counter over', () => {
    // War 100 of 400 becomes Economy 100 * 100 // 400 = 25 of 100 and Balance 50 of 200.
    const war = supplyRail(DEV_RULES_STANCES, me('war', 100));
    expect(supplyRail(DEV_RULES_STANCES, me('economy', 25))?.share).toBe(war?.share);
    expect(supplyRail(DEV_RULES_STANCES, me('balance', 50))?.share).toBe(war?.share);
    // Rounded down, never ahead: Economy 33 of 100 becomes War 33 * 400 // 100 = 132 of 400;
    // War 131 of 400 becomes Economy 131 * 100 // 400 = 32 of 100, under one tick less.
    const back = supplyRail(DEV_RULES_STANCES, me('economy', 32))?.share ?? 1;
    expect(back).toBeLessThanOrEqual(131 / 400);
    expect(131 / 400 - back).toBeLessThan(1 / 100);
  });

  it('is null without stances in the ruleset', () => {
    expect(supplyRail(DEV_RULES_FLOW, { ...me('balance', 0), capital_ticks: null })).toBeNull();
  });
});

describe('steppedShare', () => {
  it('steps once a whole second of the period', () => {
    expect(steppedShare(0.26, 40)).toBe(0.25);
    expect(steppedShare(0.25, 40)).toBe(0.25);
    expect(steppedShare(0.999, 10)).toBe(0.9);
  });
});
