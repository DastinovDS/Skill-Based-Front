import type { CityChoice } from '../match/orderController.ts';

/** What the radial menu of an own city needs to know about the city (a part of `NodeInfo`). */
export interface CityState {
  readonly hasBarracks: boolean | null;
  /** The city is a factory (`null`: not told). */
  readonly factory?: boolean | null;
}

/**
 * The sectors of the menu of an own city, in order (DEC-26, DEC-41). A sector that has nothing to
 * do is not drawn at all (it is not dimmed): recruit in a city known to have no barracks (#315),
 * the barracks once the city has one, the factory once the city is one. An unknown state (`null`:
 * the snapshot does not say) keeps the sector, the server decides. An own province (`province`)
 * has only "Fortify road" (DEC-43, item D); a city has it too.
 *
 * #762, by the same rule (nothing to do: not drawn): no factory while the own factories are at
 * `factory.max` (`factoriesFull`, the counter of the top bar tells why), no "Fortify road" in a node
 * whose every road has its line already, built or being built (`canFortify` false). The menu may
 * then be empty (an own province with every road fortified): nothing is drawn.
 */
export function cityChoices(
  city: CityState | null,
  province = false,
  factoriesFull = false,
  canFortify = true,
): CityChoice[] {
  if (province) return canFortify ? ['fortify'] : [];
  const choices: CityChoice[] = [];
  if (city?.hasBarracks !== false) choices.push('recruit');
  if (city?.hasBarracks !== true) choices.push('barracks');
  if (city?.factory !== true && !factoriesFull) choices.push('factory');
  // Fortify a road: one line per road of the node, so the sector is there while a road has none.
  if (canFortify) choices.push('fortify');
  return choices;
}
