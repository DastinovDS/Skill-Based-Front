/** Numbers of the top bar (ui-style 10.2). Pure, so they are tested without a DOM. */
import type { RulesetPublic, SelfView } from '../protocol.gen.ts';

/**
 * The CP bar, variant C "Track" (#439): one pill track from 0 to the cap. `value` and `cap` are
 * hundredths of CP, as in the protocol.
 */
export interface CpTrack {
  /** How much of the track is filled, 0..1. */
  readonly share: number;
  /** Where the whole-CP notches sit along the track, 0..100 (percent), left to right. */
  readonly notches: number[];
  /** Whether the head marker over the growing end is shown: CP above 0 and below the cap. */
  readonly head: boolean;
}

export function cpTrack(value: number, cap: number): CpTrack {
  const share = cap > 0 ? Math.min(1, Math.max(0, value / cap)) : 0;
  const notches: number[] = [];
  // One notch at every whole CP below the cap: the cell of the earlier look, as a tick.
  for (let cp = 100; cp < cap; cp += 100) notches.push((100 * cp) / cap);
  return { share, notches, head: share > 0 && share < 1 };
}

/** Is the CP at its cap? Then the excess burns (DEC-02) and the bar says so. */
export const atCap = (value: number, cap: number): boolean => value >= cap;

/** The share of the tug-of-war bar that is mine, in percent: half and half while nobody scored. */
export function vpShare(mine: number, enemy: number): number {
  const total = mine + enemy;
  return total === 0 ? 50 : Math.round((100 * mine) / total);
}

/** The way to one quantum of a stance (DEC-44). */
export interface QuantumProgress {
  /** How much of the period has passed, 0..1. */
  readonly share: number;
  /** Whole seconds until the quantum, rounded up. */
  readonly seconds: number;
}

export interface StanceProgress {
  readonly cp: QuantumProgress;
  readonly capital: QuantumProgress;
}

/**
 * The local progress of `me` over the periods of its stance: the server counts, this is the
 * display of its two numbers. `null` without `ruleset_public.stances`.
 */
export function stanceProgress(rules: RulesetPublic, me: SelfView): StanceProgress | null {
  const { stances, tick_hz } = rules;
  if (stances === null || me.cp_ticks === null || me.capital_ticks === null) return null;
  const quantum = (ticks: number, period: number): QuantumProgress => ({
    share: Math.min(1, ticks / period),
    seconds: Math.ceil(Math.max(0, period - ticks) / tick_hz),
  });
  return {
    cp: quantum(me.cp_ticks, stances.cp_period_ticks[me.stance]),
    capital: quantum(me.capital_ticks, stances.capital_period_ticks[me.stance]),
  };
}
