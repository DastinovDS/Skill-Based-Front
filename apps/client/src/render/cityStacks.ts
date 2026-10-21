/**
 * The units standing in a city, as the map draws them (UI round 2, #236): one icon per city and
 * side, whatever the number of groups. Splitting a group never changes the picture, because the
 * icon shows the total.
 *
 * Pure functions, no PixiJS. Numbers come from the snapshot; nothing is inferred.
 */
import type { Mode, PlayerId } from '../protocol.gen.ts';
import type { RenderGroup } from '../net/interpolate.ts';
import type { Point } from './camera.ts';
import type { TokenSpot } from './layout.ts';

/** The groups of one side standing in one city. */
export interface CityStack {
  readonly node: number;
  readonly owner: PlayerId;
  /** Group ids in the order of the frame (the order the list menu shows them). */
  readonly ids: readonly string[];
  readonly units: number;
  readonly charged: number;
  /** Distinct modes of the groups ("Defense" shows as the shield of the icon). */
  readonly modes: readonly Mode[];
  /**
   * The Defense bonus the own groups in "Defense" hold and its cap (DEC-30), the server's numbers
   * summed over the groups; `null` for the opponent's stack (it shows the mode only, DEC-30,
   * item 5) and when no group of the stack has the numbers.
   */
  readonly defense: DefenseBonus | null;
}

/** The gathered "Defense" bonus and its cap. */
export interface DefenseBonus {
  readonly bonus: number;
  readonly cap: number;
}

/** A drawn city icon: the stack and where its triangle is (hit testing, anchors). */
export interface CityIcon extends CityStack {
  readonly spot: TokenSpot;
}

/** Key of the icon of a side in a city. */
export function stackKey(node: number, owner: PlayerId): string {
  return `n${String(node)}:${String(owner)}`;
}

/**
 * The groups standing in cities, one stack per city and side, in the order of the first group of
 * each. Groups on a road are not part of any stack. `me`: the side of a group without `owner`.
 */
export function stackGroups(groups: readonly RenderGroup[], me: PlayerId): CityStack[] {
  const stacks = new Map<
    string,
    {
      node: number;
      owner: PlayerId;
      ids: string[];
      units: number;
      charged: number;
      modes: Mode[];
      defense: DefenseBonus | null;
    }
  >();
  for (const item of groups) {
    if (item.location.kind !== 'node') continue;
    const node = item.location.node;
    const owner = item.owner ?? me;
    const key = stackKey(node, owner);
    let stack = stacks.get(key);
    if (stack === undefined) {
      stack = { node, owner, ids: [], units: 0, charged: 0, modes: [], defense: null };
      stacks.set(key, stack);
    }
    stack.ids.push(item.group.id);
    stack.units += item.group.units;
    stack.charged += item.group.charged;
    if (!stack.modes.includes(item.group.mode)) stack.modes.push(item.group.mode);
    // Only the own groups carry the number; the opponent's stack never shows one, whatever the data.
    const { defense_bonus: bonus, defense_cap: cap } = item.group;
    if (owner === me && bonus !== null && cap !== null) {
      stack.defense = {
        bonus: (stack.defense?.bonus ?? 0) + bonus,
        cap: (stack.defense?.cap ?? 0) + cap,
      };
    }
  }
  return [...stacks.values()];
}

/**
 * Where the icon of a side stands: the middle of its city. The opponent's moves beside it only
 * when `shared`: an own icon already stands in the middle of that city.
 */
export function iconPoint(
  city: Point,
  marker: Point | undefined,
  mine: boolean,
  shared: boolean,
): Point {
  return mine || !shared || marker === undefined ? city : marker;
}
