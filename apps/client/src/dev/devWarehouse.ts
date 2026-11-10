/**
 * The warehouse numbers of an own city in the dev scenes: the dev feed's own fake gives every city
 * the capacity of its node, which would draw a capital with ten places. A picture for the eyes, not
 * game logic.
 */
import type { NodeKind } from '../protocol.gen.ts';

/** Charges a city holds at the start by its kind (the warehouse capacity of the scene). */
const START: Readonly<Record<NodeKind, number>> = {
  capital: 6,
  city_large: 2,
  city_medium: 2,
  city_small: 1,
  province: 0,
};

/** Warehouse capacity of an own city of `kind` (`warehouse_cap` of the view). */
export function warehouseCapOf(kind: NodeKind): number {
  return START[kind];
}
