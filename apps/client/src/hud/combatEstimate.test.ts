// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CombatPublic, Mode, Terrain, WelcomeMsg } from '../protocol.gen.ts';
import {
  estimateCombat,
  type AttackerInput,
  type CombatEstimate,
  type DefenderInput,
} from './combatEstimate.ts';

// The shared DEC-07 vectors (packages/protocol/vectors/combat.json): the expected values come from
// mechanics.md, not from this code. Read as raw text and parsed here (like protocol.test.ts).
interface VectorGroup {
  units: number;
  charged: number;
  mode: Mode;
}
interface Side {
  role: string;
  bonus: { source: string; amount: number } | null;
  groups: VectorGroup[];
}
interface Vector {
  id: number;
  location: string;
  terrain: Terrain | null;
  sides: { a: Side; b: Side };
  expected: {
    pool: { a: number; b: number } | null;
    losses: { a: number; b: number };
    bounce: { a: boolean; b: boolean };
    node_owner_after: string | null;
  };
}
interface VectorFile {
  params: CombatPublic & { terrain_defense_mod: Record<Terrain, number> };
  vectors: Vector[];
}

const files = import.meta.glob<string>('../../../../packages/protocol/vectors/combat.json', {
  eager: true,
  import: 'default',
  query: '?raw',
});
const vectorText = Object.values(files)[0];
if (vectorText === undefined) {
  throw new Error('combat.json not found');
}
const file = JSON.parse(vectorText) as VectorFile;
const rules: CombatPublic = file.params;

const welcomeFiles = import.meta.glob<string>(
  '../../../../packages/protocol/fixtures/server/welcome.json',
  { eager: true, import: 'default', query: '?raw' },
);

// Only fights where a attacks an enemy node are estimated (edge and neutral fights are not).
const nodeAttacks = file.vectors.filter(
  (v) => v.location === 'node_attack' || v.location === 'empty_enemy_node',
);

const sum = (groups: VectorGroup[], pick: (g: VectorGroup) => number): number =>
  groups.reduce((total, g) => total + pick(g), 0);

function attackerOf(v: Vector): AttackerInput {
  const side = v.sides.a;
  return {
    units: sum(side.groups, (g) => g.units),
    firingCharged: sum(side.groups, (g) => (g.mode === 'build' ? 0 : g.charged)),
    planned: side.bonus?.source === 'planned_order',
  };
}

function modesOf(side: Side): Mode[] {
  return [...new Set(side.groups.map((g) => g.mode))];
}

function exactDefenderOf(v: Vector): DefenderInput {
  const side = v.sides.b;
  return {
    visibility: 'exact',
    units: sum(side.groups, (g) => g.units),
    charged: sum(side.groups, (g) => g.charged),
    modes: modesOf(side),
  };
}

function terrainOf(v: Vector): Terrain {
  if (v.terrain === null) {
    throw new Error(`vector ${String(v.id)} has no terrain`);
  }
  return v.terrain;
}

describe('the vector file', () => {
  it('has the same rule numbers as the ruleset the server sends', () => {
    const text = Object.values(welcomeFiles)[0];
    if (text === undefined) {
      throw new Error('welcome.json not found');
    }
    const welcome = JSON.parse(text) as WelcomeMsg;
    expect(welcome.ruleset_public.combat).toEqual(file.params);
  });

  it('has node attacks to check', () => {
    expect(nodeAttacks.length).toBeGreaterThan(8);
  });
});

describe('estimateCombat on the DEC-07 vectors, enemy seen in full', () => {
  it.each(nodeAttacks.map((v) => [v.id, v] as const))('vector %i', (_id, v) => {
    const estimate = estimateCombat(rules, attackerOf(v), exactDefenderOf(v), terrainOf(v));
    const { expected } = v;
    expect(estimate.kind).toBe('exact');
    if (estimate.kind !== 'exact') {
      return;
    }
    expect(estimate.attackerLosses).toBe(expected.losses.a);
    expect(estimate.defenderLosses).toBe(expected.losses.b);
    expect(estimate.captures).toBe(expected.node_owner_after === 'a');
    // Without a defender there is no fight and the vector has no pools.
    if (expected.pool !== null) {
      expect(estimate.attackerPool).toBe(expected.pool.a);
      expect(estimate.defenderPool).toBe(expected.pool.b);
    }
  });

  it('the attacker bounces exactly when it does not take the node', () => {
    for (const v of nodeAttacks) {
      const estimate = estimateCombat(rules, attackerOf(v), exactDefenderOf(v), terrainOf(v));
      if (estimate.kind === 'exact') {
        expect(!estimate.captures, `vector ${String(v.id)}`).toBe(v.expected.bounce.a);
      }
    }
  });

  it('the bonus amounts of the vectors are the ruleset numbers', () => {
    for (const v of nodeAttacks) {
      for (const side of [v.sides.a, v.sides.b]) {
        if (side.bonus?.source === 'planned_order') {
          expect(side.bonus.amount).toBe(rules.planned_bonus);
        }
        if (side.bonus?.source === 'defense_mode') {
          expect(side.bonus.amount).toBe(rules.defense_bonus);
        }
      }
    }
  });
});

describe('estimateCombat on the DEC-07 vectors, enemy not seen in full', () => {
  // The ceiling is the capacity of the node: the true garrison (or more) is the tightest case.
  const slack = [0, 1, 4];

  it.each(nodeAttacks.map((v) => [v.id, v] as const))(
    'vector %i stays under the ceiling',
    (_id, v) => {
      const garrison = sum(v.sides.b.groups, (g) => g.units);
      for (const extra of slack) {
        for (const modes of [modesOf(v.sides.b), null]) {
          const defender: DefenderInput = {
            visibility: 'partial',
            capacity: garrison + extra,
            modes,
          };
          const estimate = estimateCombat(rules, attackerOf(v), defender, terrainOf(v));
          expect(estimate.kind).toBe('upper_bound');
          if (estimate.kind !== 'upper_bound') {
            continue;
          }
          const label = `vector ${String(v.id)}, capacity +${String(extra)}`;
          expect(estimate.defenderPoolMax, label).toBeGreaterThanOrEqual(v.expected.pool?.b ?? 0);
          expect(estimate.attackerLossesMax, label).toBeGreaterThanOrEqual(v.expected.losses.a);
          expect(estimate.defenderUnitsMax, label).toBeGreaterThanOrEqual(garrison);
        }
      }
    },
  );
});

describe('estimateCombat special cases', () => {
  const attacker: AttackerInput = { units: 3, firingCharged: 3, planned: false };

  it('a build-mode group makes the answer an upper bound: its charges do not shoot', () => {
    const defender: DefenderInput = {
      visibility: 'exact',
      units: 4,
      charged: 4,
      modes: ['attack', 'build'],
    };
    const estimate: CombatEstimate = estimateCombat(rules, attacker, defender, 'forest');
    expect(estimate).toMatchObject({
      kind: 'upper_bound',
      defenderPoolMax: 4,
      defenderUnitsMax: 4,
    });
  });

  it('only build groups: nothing shoots at the attacker', () => {
    const defender: DefenderInput = { visibility: 'partial', capacity: 5, modes: ['build'] };
    expect(estimateCombat(rules, attacker, defender, 'mountains')).toMatchObject({
      kind: 'upper_bound',
      defenderPoolMax: 0,
      attackerLossesMax: 0,
    });
  });

  it('a planned attack adds the planned bonus of the ruleset', () => {
    const defender: DefenderInput = { visibility: 'exact', units: 0, charged: 0, modes: [] };
    const planned = estimateCombat(rules, { ...attacker, planned: true }, defender, 'forest');
    expect(planned).toMatchObject({ kind: 'exact', attackerPool: 3 + rules.planned_bonus });
  });

  it('uses the numbers it is given, not built-in ones', () => {
    const harsh: CombatPublic = {
      terrain_defense_mod: { plains: 0, forest: 5, mountains: 0 },
      planned_bonus: 0,
      defense_bonus: 0,
    };
    const defender: DefenderInput = {
      visibility: 'exact',
      units: 2,
      charged: 2,
      modes: ['attack'],
    };
    expect(estimateCombat(harsh, attacker, defender, 'forest')).toMatchObject({
      defenderPool: 7,
      attackerLosses: 3,
    });
  });
});
