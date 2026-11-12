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
