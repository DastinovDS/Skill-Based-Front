/** Numbers of the top bar (ui-style 10.2). Pure, so they are tested without a DOM. */
import type { RulesetPublic, SelfView } from '../protocol.gen.ts';

/** Is the CP at its cap? Then the excess burns (DEC-02) and the bar says so. */
export const atCap = (value: number, cap: number): boolean => value >= cap;

/** The share of the tug-of-war bar that is mine, in percent: half and half while nobody scored. */
export function vpShare(mine: number, enemy: number): number {
  const total = mine + enemy;
  return total === 0 ? 50 : Math.round((100 * mine) / total);
}

/** The way to one quantum of a stance (DEC-44). */
interface QuantumProgress {
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
  if (me.cp_ticks === null || me.capital_ticks === null) return null;
  const quantum = (ticks: number, period: number): QuantumProgress => ({
    share: Math.min(1, ticks / period),
    seconds: Math.ceil(Math.max(0, period - ticks) / tick_hz),
  });
  return {
    cp: quantum(me.cp_ticks, stances.cp_period_ticks[me.stance]),
    capital: quantum(me.capital_ticks, stances.capital_period_ticks[me.stance]),
  };
}

/** The way to the next VP credit (#930, P1 "Ruled rail"; mechanics.md, section 11). */
export interface VpCountdown {
  /** Ticks until the next credit: `period - tick % period`, never 0. */
  readonly ticks: number;
  /** How much of the period has passed, 0..1 (0 right after a credit). */
  readonly share: number;
  /** Which period this is (`tick / period` rounded down): it changes at every credit. */
  readonly round: number;
}

/**
 * The rule the server documents (`ruleset_public.victory.vp_period_ticks`, #934): a credit falls on
 * every tick `t > 0` with `t % period == 0`, and a snapshot of tick `t` already includes the credit
 * of `t`, so the next one is `period - t % period` ticks away. `null` without a period. The rows of
 * `vectors/display_rules.json` (`vp_countdown`) tie it to the simulation (ARC-C03).
 */
export function vpCountdown(tick: number, period: number): VpCountdown | null {
  if (period <= 0) return null;
  const into = ((tick % period) + period) % period;
  return { ticks: period - into, share: into / period, round: Math.floor(tick / period) };
}

/**
 * The ticks of the rail: one every 5 s of the period (`period` ticks at `tickHz`), at least the two
 * ends; the shares 0..1 where they stand.
 */
export function railTicks(period: number, tickHz: number): number[] {
  const seconds = tickHz > 0 ? period / tickHz : 0;
  const n = Math.max(1, Math.round(seconds / 5));
  return Array.from({ length: n + 1 }, (_, j) => j / n);
}

/** The supply rail turns ready (its lozenge inked and lit) this many seconds before the charge. */
export const SUPPLY_READY_S = 3;

/** The supply rail under the stance chip (#1067, ui-style 80): the way to the capital's next charge. */
export interface SupplyRail {
  /** How much of the capital's period has passed, 0..1. */
  readonly share: number;
  /** Whole seconds until the charge, rounded up (the accessible name and the tooltip only). */
  readonly seconds: number;
  /** The period of the stance in force, in seconds (the rail steps once a second in less motion). */
  readonly periodSeconds: number;
  /** Where the ticks stand, 0..1: one every 5 s of the period of the stance, both ends included. */
  readonly ticks: readonly number[];
  /** The last `SUPPLY_READY_S` seconds before the charge. */
  readonly ready: boolean;
}

/**
 * The rail of the capital's charge (DEC-44): `me.capital_ticks` over the period of the stance in
 * force, the period's ticks every 5 s (2, 4 and 8 spans for Economy, Balance and War at the
 * reference periods). A stance change needs nothing here: the server carries the counter over
 * (item 4), so the share stays. `null` without stances.
 */
export function supplyRail(rules: RulesetPublic, me: SelfView): SupplyRail | null {
  const progress = stanceProgress(rules, me);
  if (progress === null) return null;
  const period = rules.stances.capital_period_ticks[me.stance];
  const { share, seconds } = progress.capital;
  return {
    share,
    seconds,
    periodSeconds: period / rules.tick_hz,
    ticks: railTicks(period, rules.tick_hz),
    ready: seconds <= SUPPLY_READY_S,
  };
}

/**
 * The fill of a rail in less motion: it steps once a whole second of the period, never between
 * (the rail is information, so it still moves).
 */
export function steppedShare(share: number, periodSeconds: number): number {
  if (periodSeconds <= 0) return share;
  return Math.floor(share * periodSeconds + 1e-6) / periodSeconds;
}
