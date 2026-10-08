/**
 * Combat estimate for the HUD (CLI-08, #64; AGENTS.md 7.1). This is the ONLY place where the
 * client computes a game rule, and it is an ESTIMATE: it never decides anything and never
 * influences which commands are sent. The numbers come from `ruleset_public.combat` (PRO-01),
 * nothing is hardcoded; the function is checked against the shared DEC-07 vectors
 * (`packages/protocol/vectors/combat.json`) in combatEstimate.test.ts.
 *
 * It mirrors rules 1-4 of DEC-07 (docs/design/mechanics.md, section 4) for an attack on an enemy
 * node: the pool Q of a side is its firing charges plus its bonus (plus the terrain for the node
 * defender), the side with the larger pool kills the surplus, the node changes hands if the
 * defender is left without units, otherwise the attacker bounces.
 *
 * What the client knows about the defender decides the kind of the answer:
 * - `exact`: the enemy at the node is seen in full (totals of units and charges); every charged
 *   unit fires (DEC-16 removed the non-firing "build" mode);
 * - `upper_bound`: otherwise; then only a ceiling is known, from the node capacity ("not more
 *   than N"). The defender can hold at most `capacity` units (a garrison over capacity dies off
 *   slowly, so this is a soft ceiling: mechanics.md, section 9).
 */
import type { CombatPublic, Mode, Terrain } from '../protocol.gen.ts';

/** The attacking side: one own group (the client knows its own groups exactly). */
export interface AttackerInput {
  readonly units: number;
  /** Charges of the group that shoot: all of them (mechanics.md, rule 1; DEC-16). */
  readonly firingCharged: number;
  /** The attack is a planned order: it brings the `planned_bonus` virtual shots. */
  readonly planned: boolean;
}

/** What the player sees of the defending node. */
export type DefenderInput =
  | {
      /** Enemy totals are known (`Seen` of level `exact`). */
      readonly visibility: 'exact';
      readonly units: number;
      readonly charged: number;
      /** Distinct modes of the enemy groups there. */
      readonly modes: readonly Mode[];
    }
  | {
      /** Only presence or an old sighting: the ceiling is the node capacity. */
      readonly visibility: 'partial';
      readonly capacity: number;
      /** Distinct modes of the enemy groups, `null` if nothing current is known. */
      readonly modes: readonly Mode[] | null;
    };

export type CombatEstimate =
  | {
      readonly kind: 'exact';
      readonly attackerPool: number;
      readonly defenderPool: number;
      readonly attackerLosses: number;
      readonly defenderLosses: number;
      /** The defender has no units left: the node changes hands. */
      readonly captures: boolean;
    }
  | {
      readonly kind: 'upper_bound';
      readonly attackerPool: number;
      /** The defender pool is at most this. */
      readonly defenderPoolMax: number;
      /** The attacker loses at most this many units. */
      readonly attackerLossesMax: number;
      /** The defender has at most this many units before the fight. */
      readonly defenderUnitsMax: number;
    };

/**
 * The pool of the node defender (mechanics.md, rule 1). Terrain and the "Defense" bonus count
 * only if the defender has a firing charge; a negative terrain modifier silences that many real
 * charges (the unit keeps its charge).
 */
function defenderPool(firing: number, defenseBonus: number, terrainMod: number): number {
  if (firing <= 0) {
    return 0;
  }
  return defenseBonus + Math.max(0, terrainMod) + Math.max(0, firing + Math.min(0, terrainMod));
}

/**
 * Estimate the fight of `attacker` against the enemy node described by `defender`.
 *
 * `rules` is `ruleset_public.combat` and `terrain` the terrain of the attacked node (from the map).
 * The "Defense" bonus is counted once when the mode is present: how many groups hold it is not
 * visible (open question #133), so this is an estimate even when `exact`.
 */
export function estimateCombat(
  rules: CombatPublic,
  attacker: AttackerInput,
  defender: DefenderInput,
  terrain: Terrain,
): CombatEstimate {
  const terrainMod = rules.terrain_defense_mod[terrain];
  const attackerPool = attacker.firingCharged + (attacker.planned ? rules.planned_bonus : 0);

  if (defender.visibility === 'exact') {
    const bonus = defender.modes.includes('defense') ? rules.defense_bonus : 0;
    const pool = defenderPool(defender.charged, bonus, terrainMod);
    const defenderLosses = Math.min(Math.max(0, attackerPool - pool), defender.units);
    return {
      kind: 'exact',
      attackerPool,
      defenderPool: pool,
      attackerLosses: Math.min(Math.max(0, pool - attackerPool), attacker.units),
      defenderLosses,
      captures: defender.units - defenderLosses === 0,
    };
  }

  // Not seen in full. The ceilings: units by the capacity, firing charges by the units (none if
  // no enemy group is seen there now), the bonus only if the mode may be there.
  const unitsMax = defender.capacity;
  const firingMax = defender.modes === null || defender.modes.length > 0 ? unitsMax : 0;
  const bonusMax =
    defender.modes === null || defender.modes.includes('defense') ? rules.defense_bonus : 0;
  const poolMax = defenderPool(firingMax, bonusMax, terrainMod);
  return {
    kind: 'upper_bound',
    attackerPool,
    defenderPoolMax: poolMax,
    attackerLossesMax: Math.min(Math.max(0, poolMax - attackerPool), attacker.units),
    defenderUnitsMax: unitsMax,
  };
}
