import type { EventMsg } from '../protocol.gen.ts';
import type { RenderFrame } from '../net/interpolate.ts';

/**
 * What the renderer draws, asked every frame. The match controller (CLI-06) serves it from a
 * `SnapshotBuffer` and the event stream; the dev screen serves fixtures.
 */
/** Delays of planned orders and of "Defense" in ticks (`ruleset_public.orders`). */
export interface OrderDelays {
  readonly planned: number;
}

/** `ruleset_public.capacity` in ticks: the arc of the overcrowding pill fills over `attritionTicks`. */
export interface CapacityTicks {
  readonly attritionTicks: number;
  readonly graceTicks: number;
}

/**
 * `ruleset_public.city_upgrades` when the city development of DEC-26 is on: the durations of the
 * city builds in ticks and the warehouse levels (the places of a warehouse not built yet are drawn
 * dashed, C1).
 */
export interface CityDevelopment {
  readonly barracks: number;
  readonly warehouse: number;
  /** `warehouse_max_level`: the top level of a warehouse. */
  readonly warehouseMaxLevel: number;
  /** `warehouse_gain_per_level`: places (charges) one level adds. */
  readonly warehouseGainPerLevel: number;
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
  /**
   * Ticks of production of one recruit (`ruleset_public.recruit.unit_ticks`, DEC-25): the full
   * progress of the queue mark over an own city. Without it no queue mark.
   */
  readonly recruitTicks?: number;
  /**
   * Units a city queues at most (`ruleset_public.recruit.queue_max`, DEC-25): the slots of the queue
   * mark of the selected city, the free ones dashed. Without it the mark shows only the queued units.
   */
  readonly recruitQueueMax?: number;
  /**
   * The city development of DEC-26 when the rules have it (`ruleset_public.city_upgrades`): the
   * durations of the barracks and warehouse builds for the build mark over an own city, and the
   * warehouse bar of a foreign city shows only its charges (its capacity is hidden).
   */
  readonly cityUpgrades?: CityDevelopment | null;
  /**
   * Ticks one road level takes to build (`ruleset_public.build.ticks_per_level`): the part done of
   * the tape of an own build. Without it the tape shows no part done.
   */
  readonly roadBuildTicks?: number;
  /** The frame to draw now; `null` until the first snapshot. */
  frame(): RenderFrame | null;
  /**
   * Events received so far (fight marks use the recent ones). Return the same array while
   * nothing new arrived: the renderer rebuilds its marks when the array or its length changes.
   */
  events(): readonly EventMsg[];
}
