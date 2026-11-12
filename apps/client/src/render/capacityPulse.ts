/**
 * A recruit refused for want of room (`CITY_FULL`, the pop-up catalogue of #765, B21): the capacity
 * ring of the city answers instead of a sentence. It swells twice and settles (a change of size,
 * not of colour, AGENTS.md 7.4); with "less motion" it does not move, it dims and comes back twice.
 * Pure: `CityView` applies it to the ring sprite.
 */

/** The whole pulse, ms; its beats; how much the ring swells; how far it dims with less motion. */
export const CAPACITY_PULSE = { ms: 720, beats: 2, swell: 0.16, dim: 0.6 } as const;

/** The refusal to answer: the city and when it came (`performance.now()` ms). */
export interface CapacityPulse {
  readonly node: number;
  readonly at: number;
}

/** The ring's scale and opacity `ageMs` after the refusal; `null`: the pulse is over (or not begun). */
export function capacityPulse(
  ageMs: number,
  reduced: boolean,
): { readonly scale: number; readonly alpha: number } | null {
  const P = CAPACITY_PULSE;
  if (ageMs < 0 || ageMs >= P.ms) return null;
  const phase = ((ageMs / P.ms) * P.beats) % 1;
  const beat = Math.sin(Math.PI * phase);
  return reduced ? { scale: 1, alpha: 1 - P.dim * beat } : { scale: 1 + P.swell * beat, alpha: 1 };
}
