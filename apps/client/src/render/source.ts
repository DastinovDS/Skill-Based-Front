import type { EventMsg } from '../protocol.gen.ts';
import type { RenderFrame } from '../net/interpolate.ts';

/**
 * What the renderer draws, asked every frame. The match controller (CLI-06) serves it from a
 * `SnapshotBuffer` and the event stream; the dev screen serves fixtures.
 */
/** Delays of planned orders and of "Defense" in ticks (`ruleset_public.orders`). */
export interface OrderDelays {
  readonly planned: number;
  readonly defense: number;
}

/** `ruleset_public.capacity` in ticks: the arc of the overcrowding pill fills over `attritionTicks`. */
export interface CapacityTicks {
  readonly attritionTicks: number;
  readonly graceTicks: number;
}

export interface RenderSource {
  /** Overcrowding numbers for the pill beside an overcrowded city; without them no pill. */
  readonly capacityTicks?: CapacityTicks;
  /** Delays for the countdown on order arrows; without them the arrows show no countdown. */
  readonly orderDelays?: OrderDelays;
  /** Ticks per second (`ruleset_public.tick_hz`), for the age of fog memories. Default 10. */
  readonly tickHz?: number;
  /** Ticks between the rounds of a fight (`ruleset_public.combat.round_ticks`). Default 10. */
  readonly roundTicks?: number;
  /** The frame to draw now; `null` until the first snapshot. */
  frame(): RenderFrame | null;
  /**
   * Events received so far (fight marks use the recent ones). Return the same array while
   * nothing new arrived: the renderer rebuilds its marks when the array or its length changes.
   */
  events(): readonly EventMsg[];
}
