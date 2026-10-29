import { describe, expect, it } from 'vitest';
import type { GroupView, IntentView, NodeView } from '../protocol.gen.ts';
import type { RenderGroup } from '../net/interpolate.ts';
import { defenseSigns, signCounts } from './defenseSigns.ts';

const group = (over: Partial<GroupView> = {}): GroupView => ({
  id: 'g',
  units: 3,
  charged: 3,
  mode: 'defense',
  location: { kind: 'node', node: 2 },
  order: null,
  defense_bonus: 1,
  defense_cap: 3,
  ...over,
});
const render = (g: GroupView, owner?: 0 | 1): RenderGroup => ({
  group: g,
  location: g.location,
  ...(owner === undefined ? {} : { owner }),
});
const node = (id: number, enemyModes: ('attack' | 'defense')[], detail: NodeView['detail']) =>
  ({
    id,
    detail,
    seen: {
      tick: 0,
      level: detail,
      enemy_modes: enemyModes,
      enemy_units: null,
      enemy_charged: null,
      enemy_range: null,
    },
  }) as unknown as NodeView;
const intent = (over: Partial<IntentView>): IntentView => ({
  id: 'i',
  owner: 1,
  kind: 'defense',
  origin: 5,
  target: null,
  created_tick: 0,
  ...over,
});
const none = { nodes: [], intents: [], groups: [] };

describe('defenseSigns (#349)', () => {
  it('gives an own group in Defense the numbers the server sent', () => {
    const signs = defenseSigns({ ...none, groups: [render(group())] }, 0);
    expect(signs).toEqual([{ node: 2, owner: 0, pips: { bonus: 1, cap: 3 } }]);
  });

  it('gives nothing for a group in another mode', () => {
    expect(defenseSigns({ ...none, groups: [render(group({ mode: 'attack' }))] }, 0)).toEqual([]);
  });

  it('shows the opponent as the mode alone, whatever the data of its group', () => {
    const signs = defenseSigns({ ...none, groups: [render(group(), 1)] }, 0);
    expect(signs).toEqual([{ node: 2, owner: 1, pips: null }]);
  });

  it('takes the opponent from what is seen in a city, but not from a memory in the fog', () => {
    const seen = defenseSigns({ ...none, nodes: [node(4, ['defense'], 'presence')] }, 0);
    expect(seen).toEqual([{ node: 4, owner: 1, pips: null }]);
    expect(defenseSigns({ ...none, nodes: [node(4, ['defense'], 'fog')] }, 0)).toEqual([]);
    expect(defenseSigns({ ...none, nodes: [node(4, ['attack'], 'exact')] }, 0)).toEqual([]);
  });

  it('takes a city in the fog from the public intent', () => {
    const signs = defenseSigns({ ...none, intents: [intent({ origin: 7 })] }, 0);
    expect(signs).toEqual([{ node: 7, owner: 1, pips: null }]);
  });

  it('does not draw a sign twice for one side, and keeps the numbers of the group', () => {
    const signs = defenseSigns(
      {
        nodes: [],
        intents: [intent({ owner: 0, origin: 2 })],
        groups: [render(group())],
      },
      0,
    );
    expect(signs).toEqual([{ node: 2, owner: 0, pips: { bonus: 1, cap: 3 } }]);
  });

  it("puts the own sign before the opponent's in the same city, in the order of the cities", () => {
    const signs = defenseSigns(
      {
        nodes: [],
        intents: [intent({ owner: 1, origin: 2 }), intent({ owner: 1, origin: 1 })],
        groups: [render(group())],
      },
      0,
    );
    expect(signs.map((s) => [s.node, s.owner])).toEqual([
      [1, 1],
      [2, 0],
      [2, 1],
    ]);
    expect([...signCounts(signs)]).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });
});
