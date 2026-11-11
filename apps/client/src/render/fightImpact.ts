/**
 * What a fight does on the map besides its shots (ui-style 27.3, 29.1; #351; the shots are the Parry
 * arcs of `parryLayout.ts`, #856): the timing of the losses that pop up, the silent charge, and where on
 * the map the two sides of a fight stand.
 *
 * Pure functions, no PixiJS objects and no DOM. Nothing decides what happened: every effect is a
 * function of the fields the server sent (`fight_round`, `FightView`) and of the tick. Every duration
 * is a share of a round (`combat.round_ticks`), never fixed seconds.
 */
import type { MapFile } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import type { FightPlace } from './fightFx.ts';
import { roundEffect } from './fightFx.ts';
import { edgeEnds } from './layout.ts';
import type { Emit } from './particles.ts';
import { FIGHT_GAP, WARN } from './style.ts';

/** The two sides of a fight, as everywhere in the fight view: the viewing player and the opponent. */
export type Side = 'own' | 'enemy';

// --- Time ---------------------------------------------------------------------------------------------

/**
 * The "-N" of a round rises from this share of a round after its tick (0.6 s of 2 s: about when a Parry
 * hit lands, `parryLayout.ts`) and stays `NUMBER_SHARE` (1.0 s).
 */
export const HIT_SHARE = 0.3;
export const NUMBER_SHARE = 0.5;
/** The dim ring of a silent charge: from the tick, this share of a round (0.9 s). */
export const SILENT_SHARE = 0.45;

/** Progress 0..1 of a share-long effect that starts `from` (a share of a round) after the tick `age` ticks ago. */
export function sinceShare(
  age: number,
  from: number,
  share: number,
  roundTicks: number,
): number | null {
  return roundEffect(age - from * Math.max(1, roundTicks), share, roundTicks);
}

/** Progress of the dim ring of a silent charge (DEC-24, F2), from the tick of a round. */
export function silentProgress(age: number, roundTicks: number): number | null {
  return roundEffect(age, SILENT_SHARE, roundTicks);
}

// --- Where on the map ---------------------------------------------------------------------------------

/** Where the two sides of a fight stand on the map: the tokens of their groups. */
export interface Contacts {
  readonly own: Point;
  readonly enemy: Point;
}

/** Closer than this the two tokens would sit one on the other (the effects need two places). */
const MIN_APART = 16;

/**
 * The places of the two sides of a fight. The tokens drawn by the entity view tell it (`known`):
 * an own group's token and an enemy marker of the city or a figure on the road. What is not known is
 * the mirror of the one that is across the place of the fight, or, with none, two places
 * `FIGHT_GAP` apart along the road (a fight on a road) or across the city (a fight in a city).
 */
export function contactPoints(
  map: MapFile,
  place: FightPlace,
  known: { readonly own?: Point | undefined; readonly enemy?: Point | undefined },
  gap: number = FIGHT_GAP,
): Contacts {
  let axis: Point = { x: 1, y: 0 };
  if (place.edge !== null) {
    const ends = edgeEnds(map, place.edge);
    if (ends !== undefined) {
      const length = Math.hypot(ends.b.x - ends.a.x, ends.b.y - ends.a.y) || 1;
      axis = { x: (ends.b.x - ends.a.x) / length, y: (ends.b.y - ends.a.y) / length };
    }
  }
  const at = place.at;
  const mirror = (p: Point): Point => ({ x: 2 * at.x - p.x, y: 2 * at.y - p.y });
  const half: Point = { x: (axis.x * gap) / 2, y: (axis.y * gap) / 2 };
  let own = known.own;
  let enemy = known.enemy;
  if (own === undefined && enemy === undefined) {
    own = { x: at.x - half.x, y: at.y - half.y };
    enemy = { x: at.x + half.x, y: at.y + half.y };
  } else if (own === undefined && enemy !== undefined) {
    own =
      Math.hypot(enemy.x - at.x, enemy.y - at.y) < MIN_APART
        ? { x: at.x - half.x, y: at.y - half.y }
        : mirror(enemy);
  } else if (enemy === undefined && own !== undefined) {
    enemy =
      Math.hypot(own.x - at.x, own.y - at.y) < MIN_APART
        ? { x: at.x + half.x, y: at.y + half.y }
        : mirror(own);
  }
  if (own === undefined || enemy === undefined) throw new Error('both contacts are set');
  const apart = Math.hypot(enemy.x - own.x, enemy.y - own.y);
  if (apart < MIN_APART) {
    // Two tokens on one spot: push them along the axis so that the two sides can be told apart.
    return {
      own: { x: own.x - axis.x * (MIN_APART / 2), y: own.y - axis.y * (MIN_APART / 2) },
      enemy: { x: enemy.x + axis.x * (MIN_APART / 2), y: enemy.y + axis.y * (MIN_APART / 2) },
    };
  }
  return { own, enemy };
}

// --- The silent charge -----------------------------------------------------------------------------

/** The dim dashed ring of a silent charge at the tick of a round: no flash, no shot. */
export function silentParticle(emit: Emit, at: Point, q: number, scale: number): void {
  emit({
    kind: 'dashRing',
    x: at.x,
    y: at.y,
    size: 2 * (17 + 8 * q) * scale,
    color: WARN,
    alpha: 0.55 * (1 - q),
  });
}
