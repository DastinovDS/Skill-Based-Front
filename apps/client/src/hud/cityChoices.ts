import type { CityChoice } from '../match/orderController.ts';

/** What the radial menu of an own city needs to know about the city (a part of `NodeInfo`). */
export interface CityState {
  readonly hasBarracks: boolean | null;
  readonly warehouseLevel: number | null;
  /** Economy v2: the city is a factory (`null`: not told, or v1). */
  readonly factory?: boolean | null;
  /** Economy v2: the node has a bunker. */
  readonly fort?: boolean | null;
}

/**
 * The sectors of the menu of an own city, in order (DEC-26). With the city development a sector
 * that has nothing to do is not drawn at all (it is not dimmed): recruit in a city known to have
 * no barracks (#315), the barracks once the city has one, the warehouse at its top level. Without
 * the city development every city recruits. An unknown state (`null`: the snapshot does not say)
 * keeps the sector, the server decides. Roads are raised by a click in the road mode (DEC-28), not
 * from here.
 *
 * Economy v2 (`v2`, DEC-41): a city also builds a factory (until it is one) and a bunker (until it
 * has one); an own province (`province`) has only the bunker, kept while it stands (a menu is never
 * empty). A ruleset without a bunker (`bunker` false, DEC-43) offers none. A ruleset with road
 * fortifications (`fort`, DEC-43, item D) gives a city and a province the "Fortify road" sector.
 */
export function cityChoices(
  development: { readonly enabled: boolean; readonly warehouse_max_level: number },
  city: CityState | null,
  v2 = false,
  province = false,
  bunker = true,
  fort = false,
): CityChoice[] {
  // Without a bunker in the rules (`mvp-4`, DEC-43) a province has no menu and a city no bunker sector.
  // Road fortifications (DEC-43, item D) are for a city and a province alike, so a province keeps a menu with them.
  if (v2 && province)
    return [...(bunker ? (['bunker'] as const) : []), ...(fort ? (['fortify'] as const) : [])];
  const choices: CityChoice[] = [];
  if (!development.enabled) choices.push('recruit');
  else {
    if (city?.hasBarracks !== false) choices.push('recruit');
    if (city?.hasBarracks !== true) choices.push('barracks');
    if ((city?.warehouseLevel ?? 0) < development.warehouse_max_level) choices.push('warehouse');
  }
  if (v2) {
    if (city?.factory !== true) choices.push('factory');
    if (bunker && city?.fort !== true) choices.push('bunker');
  }
  // Fortify a road: any number of lines, one per road of the node, so the sector is always there.
  if (v2 && fort) choices.push('fortify');
  return choices;
}
