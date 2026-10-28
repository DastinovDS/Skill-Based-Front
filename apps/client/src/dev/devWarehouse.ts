/**
 * The warehouse numbers of an own city in the dev scenes, as the real view gives them (DEC-26,
 * `rulesets/mvp-1.toml`: `warehouse.start_by_kind` plus a level of `gain_per_level` each): the
 * dev feed's own fake gives every city the capacity of its node, which would draw a capital with
 * ten places and two dashed ones. A picture for the eyes, not game logic.
 */
import type { NodeKind } from '../protocol.gen.ts';
import { DEV_RULES } from '../hud/devFeed.ts';

/** `warehouse.start_by_kind` of `mvp-1`: charges a city holds at warehouse level 0. */
const START: Readonly<Record<NodeKind, number>> = {
  capital: 6,
  city_large: 2,
  city_medium: 2,
  city_small: 1,
  province: 0,
};

/** Warehouse capacity of an own city of `kind` at `level` (`warehouse_cap` of the view). */
export function warehouseCapOf(kind: NodeKind, level: number): number {
  return START[kind] + level * DEV_RULES.city_upgrades.warehouse_gain_per_level;
}
