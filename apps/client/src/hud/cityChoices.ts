import type { CityChoice } from '../match/orderController.ts';

/** What the radial menu of an own city needs to know about the city (a part of `NodeInfo`). */
export interface CityState {
  readonly hasBarracks: boolean | null;
  readonly warehouseLevel: number | null;
}

/**
 * The sectors of the menu of an own city, in order (DEC-26). With the city development a sector
 * that has nothing to do is not drawn at all (it is not dimmed): recruit in a city known to have
 * no barracks (#315), the barracks once the city has one, the warehouse at its top level. Without
 * the city development every city recruits. An unknown state (`null`: the snapshot does not say)
 * keeps the sector, the server decides. Roads are raised by a click in the road mode (DEC-28), not
 * from here.
 */
export function cityChoices(
  development: { readonly enabled: boolean; readonly warehouse_max_level: number },
  city: CityState | null,
): CityChoice[] {
  if (!development.enabled) return ['recruit'];
  const choices: CityChoice[] = city?.hasBarracks === false ? [] : ['recruit'];
  if (city?.hasBarracks !== true) choices.push('barracks');
  if ((city?.warehouseLevel ?? 0) < development.warehouse_max_level) choices.push('warehouse');
  return choices;
}
