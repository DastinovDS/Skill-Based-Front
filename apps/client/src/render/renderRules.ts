/**
 * The rule numbers the map draws with (ARC-C02, #482), made in one place: `renderRules` from the
 * `ruleset_public` of `welcome` (a live match, the dev screen and the dev match), the replay from
 * the header of its file (`replay/replayFile.ts`, `replayRenderRules`). A `RenderSource` carries
 * one `RenderRules`; the scene and its views read the numbers from it, never a ruleset of their
 * own. A number the map does not have is a neutral value (`NO_RENDER_RULES`): the mark it times
 * is left out.
 *
 * Only numbers of the ruleset: what they mean for a match is the server's (AGENTS.md 7.1).
 */
import type { RulesetPublic } from '../protocol.gen.ts';
import type { BuildingKind } from './buildingLayout.ts';

/** Ticks a second before a source says (`ruleset_public.tick_hz` of every ruleset). */
export const DEFAULT_TICK_HZ = 10;

/**
 * Ticks between the rounds of a fight when the source does not say (DEC-32): the value of every
 * ruleset (`combat.round_ticks = 20`). Dev scenes without a ruleset and replay files of format 1
 * and 2 (their header has no `round_ticks`) use it; a live match and a format 3 replay say it.
 */
export const DEFAULT_ROUND_TICKS = 20;

/** Delays of planned orders in ticks (`ruleset_public.orders`). */
export interface OrderDelays {
  readonly planned: number;
}

/**
 * One building of a city (DEC-26, DEC-41): the ticks from its full payment to the building, and
 * the charges it costs (the row of owed lozenges beside a build, #847, #954); `null`: the price is
 * not known (a replay written between the two parts of #905), the build shows only what it owes.
 */
export interface BuildingRule {
  readonly ticks: number;
  readonly charges: number | null;
}

/** The buildings of a city by kind: a new building is one more key of `BuildingKind`. */
export type BuildingRules = Readonly<Record<BuildingKind, BuildingRule>>;

export interface RenderRules {
  /** `tick_hz`: the age of fog memories, walk and fight timings. */
  readonly tickHz: number;
  /** `combat.round_ticks`: the rounds of a fight and the walks of a capture (DEC-24, DEC-32). */
  readonly roundTicks: number;
  /** The countdown on order arrows; `null`: no countdown. */
  readonly orderDelays: OrderDelays | null;
  /** `recruit.unit_ticks` (DEC-25): the progress of a recruit queue; `null`: no queue marks. */
  readonly recruitTicks: number | null;
  /** `recruit.queue_max` (DEC-25): the free slots of the selected city; `null`: none shown. */
  readonly recruitQueueMax: number | null;
  /**
   * `recruit.rally_cost` under `recruit.rally_point` (DEC-48, item H3), hundredths: the CP mark of
   * each queued walk on the ring (#930, W4); 0: no walk marks.
   */
  readonly rallyCost: number;
  /** `city_upgrades.warehouse_province` (DEC-41, item 13); 0: a province shows no stock. */
  readonly provinceWarehouse: number;
  /**
   * The city development (DEC-26, `city_upgrades` and `factory`): the build marks over an own city
   * and the barracks icon; `null`: cities without them (dev scenes, old replays).
   */
  readonly buildings: BuildingRules | null;
  /** `fort.build_ticks` (DEC-43, item D): the part done of an own road fortification; 0: none. */
  readonly fortBuildTicks: number;
}

/** A source that has no ruleset yet (before `welcome`) or none at all: every mark it times is off. */
export const NO_RENDER_RULES: RenderRules = {
  tickHz: DEFAULT_TICK_HZ,
  roundTicks: DEFAULT_ROUND_TICKS,
  orderDelays: null,
  recruitTicks: null,
  recruitQueueMax: null,
  rallyCost: 0,
  provinceWarehouse: 0,
  buildings: null,
  fortBuildTicks: 0,
};

/** The buildings of `ruleset_public`: the barracks of `city_upgrades`, the factory of `factory`. */
export function buildingRules(rules: RulesetPublic): BuildingRules {
  return {
    barracks: {
      ticks: rules.city_upgrades.barracks_ticks,
      charges: rules.city_upgrades.barracks_charges,
    },
    factory: { ticks: rules.factory.build_ticks, charges: rules.factory.cost },
  };
}

/** Every number the map draws with, from the `ruleset_public` of a match. */
export function renderRules(rules: RulesetPublic): RenderRules {
  return {
    tickHz: rules.tick_hz,
    roundTicks: rules.combat.round_ticks,
    // A plan has no fixed delay, it gathers its bonus (DEC-41, item 10; #894).
    orderDelays: { planned: 0 },
    recruitTicks: rules.recruit.unit_ticks,
    recruitQueueMax: rules.recruit.queue_max,
    rallyCost: rules.recruit.rally_point ? rules.recruit.rally_cost : 0,
    provinceWarehouse: rules.city_upgrades.warehouse_province,
    buildings: buildingRules(rules),
    fortBuildTicks: rules.fort.build_ticks,
  };
}
