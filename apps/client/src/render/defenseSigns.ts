/**
 * Which cities carry a sign of "Defense", and whose (#349, L1 "Left column"): one sign per city and
 * side, whatever shows it. An own stack in the mode gives the sign with the numbers of the server
 * (DEC-30); the opponent gives the mode only: seen in the city (`seen.enemy_modes`), standing in a
 * replay frame, or told by the public intent (`kind = defense`, DEC-08). The opponent never gets a
 * number, whatever the data (DEC-30, item 5; AGENTS.md 4.4).
 *
 * Pure functions, no PixiJS. Nothing is inferred: every sign is something the snapshot says.
 */
import type { IntentView, NodeView, PlayerId } from '../protocol.gen.ts';
import type { RenderGroup } from '../net/interpolate.ts';
import { stackGroups, type DefenseBonus } from './cityStacks.ts';

export interface DefenseSign {
  readonly node: number;
  readonly owner: PlayerId;
  /** The bonus gathered and its cap: own groups only; `null`: the mode alone. */
  readonly pips: DefenseBonus | null;
}

/** What the signs are made of: the snapshot's nodes and intents and the groups of the frame. */
export interface DefenseSource {
  readonly nodes: readonly NodeView[];
  readonly intents: readonly IntentView[];
  readonly groups: readonly RenderGroup[];
}

/**
 * The signs in the order of the cities, the own one before the opponent's. `me`: the viewing player.
 * An enemy city seen only as a memory (`detail = fog`) shows no group, but its public intent still
 * gives the sign.
 */
export function defenseSigns(source: DefenseSource, me: PlayerId): DefenseSign[] {
  const signs = new Map<string, DefenseSign>();
  const add = (sign: DefenseSign): void => {
    const key = `${String(sign.node)}:${String(sign.owner)}`;
    const old = signs.get(key);
    // The numbers win over a bare mode of the same side.
    if (old === undefined || (old.pips === null && sign.pips !== null)) signs.set(key, sign);
  };
  for (const stack of stackGroups(source.groups, me)) {
    if (!stack.modes.includes('defense')) continue;
    add({ node: stack.node, owner: stack.owner, pips: stack.owner === me ? stack.defense : null });
  }
  const enemy: PlayerId = me === 0 ? 1 : 0;
  for (const node of source.nodes) {
    const { seen } = node;
    const shown = seen !== null && node.detail !== 'fog' && seen.level !== 'fog';
    if (shown && seen.enemy_modes.includes('defense')) {
      add({ node: node.id, owner: enemy, pips: null });
    }
  }
  for (const intent of source.intents) {
    if (intent.kind !== 'defense') continue;
    add({ node: intent.origin, owner: intent.owner, pips: null });
  }
  return [...signs.values()].sort(
    (a, b) => a.node - b.node || Number(b.owner === me) - Number(a.owner === me),
  );
}

/** How many signs each city carries (the column of its barracks mark depends on it). */
export function signCounts(signs: readonly DefenseSign[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const sign of signs) counts.set(sign.node, (counts.get(sign.node) ?? 0) + 1);
  return counts;
}
