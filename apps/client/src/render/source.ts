import type { EventMsg, PlayerId } from '../protocol.gen.ts';
import type { RenderFrame } from '../net/interpolate.ts';

/**
 * What the renderer draws, asked every frame. The match controller (CLI-06) serves it from a
 * `SnapshotBuffer` and the event stream; the dev screen serves fixtures.
 */
/** Delays of planned orders in ticks (`ruleset_public.orders`). */
export interface OrderDelays {
  readonly planned: number;
}

/** `ruleset_public.capacity` in ticks: the arc of the overcrowding pill fills over `attritionTicks`. */
export interface CapacityTicks {
  readonly attritionTicks: number;
  readonly graceTicks: number;
}

/**
 * `ruleset_public.city_upgrades` and `factory`: the durations of the city builds in ticks and the
 * charges they cost (the lozenges of the Crown arc of a build, #847). Without the charges a build
 * shows only the charges it still owes.
 */
export interface CityDevelopment {
  readonly barracks: number;
  /** Ticks from the full payment to a factory (`factory.build_ticks`, DEC-41). */
  readonly factory?: number;
  /** The charges the barracks costs (`city_upgrades.barracks_charges`) and a factory (`factory.cost`). */
  readonly barracksCharges?: number;
  readonly factoryCharges?: number;
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
   * What a recruit pays as it walks to the rally point of its city, hundredths
   * (`ruleset_public.recruit.rally_cost`, DEC-48, item H3): the CP mark of each queued walk on the
   * ring (#930, W4). Without it (or 0) no walk marks.
   */
  readonly rallyCost?: number;
  /**
   * Places of the warehouse of an own province (`ruleset_public.city_upgrades.warehouse_province`,
   * DEC-41, item 13); 0 or absent: a province shows no stock.
   */
  readonly provinceWarehouse?: number;
  /**
   * The city development of DEC-26 (`ruleset_public.city_upgrades`): the durations of the barracks
   * and factory builds for the build mark over an own city. Dev scenes without it draw cities
   * without the build marks and the barracks tower.
   */
  readonly cityUpgrades?: CityDevelopment | null;
  /**
   * Ticks a road fortification takes to build (`ruleset_public.fort.build_ticks`, DEC-43, item D):
   * the part done of the line of an own build. Without it an own build shows no part done.
   */
  readonly fortBuildTicks?: number;
  /**
   * Dev scenes only (#819): the owners of the nodes just before the first snapshot, so that a frozen
   * scene shows the capture of the nodes whose owner differs as under way.
   */
  readonly floodFrom?: readonly (PlayerId | null)[];
  /** Dev scenes only: the captures under way stay this old (ms), to be looked at frame by frame. */
  readonly floodHoldMs?: number;
  /** The frame to draw now; `null` until the first snapshot. */
  frame(): RenderFrame | null;
  /**
   * Events received so far (fight marks use the recent ones). Return the same array while
   * nothing new arrived: the renderer rebuilds its marks when the array or its length changes.
   */
  events(): readonly EventMsg[];
}
