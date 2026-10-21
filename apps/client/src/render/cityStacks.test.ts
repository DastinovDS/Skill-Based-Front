import { describe, expect, it } from 'vitest';
import type { RenderGroup } from '../net/interpolate.ts';
import type { GroupView } from '../protocol.gen.ts';
import { iconPoint, stackGroups, stackKey } from './cityStacks.ts';

const group = (id: string, units: number, charged: number, mode: GroupView['mode'] = 'attack') =>
  ({
    id,
    units,
    charged,
    mode,
    order: null,
    location: { kind: 'node', node: 0 },
    defense_bonus: null,
    defense_cap: null,
  }) satisfies GroupView;
const inNode = (g: GroupView, node: number, owner?: 0 | 1): RenderGroup => ({
  group: { ...g, location: { kind: 'node', node } },
  location: { kind: 'node', node },
  ...(owner === undefined ? {} : { owner }),
});
const onRoad = (g: GroupView): RenderGroup => {
  const location = { kind: 'edge', edge: 0, from_node: 0, progress: 400 } as const;
  return { group: { ...g, location }, location };
};

describe('stackGroups', () => {
  it('makes one stack of the groups of a city: the total, whatever the split', () => {
    const whole = stackGroups([inNode(group('a', 6, 4), 3)], 0);
    const split = stackGroups([inNode(group('a', 4, 3), 3), inNode(group('b', 2, 1), 3)], 0);
    expect(whole).toHaveLength(1);
    expect(split).toHaveLength(1);
    // Splitting a group does not change what the icon shows.
    expect([split[0]?.units, split[0]?.charged]).toEqual([whole[0]?.units, whole[0]?.charged]);
    expect(split[0]?.ids).toEqual(['a', 'b']);
  });

  it('keeps cities and sides apart, and leaves groups on roads out', () => {
    const stacks = stackGroups(
      [
        inNode(group('a', 3, 3), 3),
        inNode(group('b', 1, 0), 5),
        inNode(group('c', 2, 1), 3, 1),
        onRoad(group('d', 4, 4)),
      ],
      0,
    );
    expect(stacks.map((s) => [s.node, s.owner, s.ids])).toEqual([
      [3, 0, ['a']],
      [5, 0, ['b']],
      [3, 1, ['c']],
    ]);
  });

  it('lists the modes once, so a shield shows when any group defends', () => {
    const [stack] = stackGroups(
      [
        inNode(group('a', 2, 1, 'defense'), 3),
        inNode(group('b', 2, 1), 3),
        inNode(group('c', 1, 0, 'defense'), 3),
      ],
      0,
    );
    expect(stack?.modes).toEqual(['defense', 'attack']);
  });
});

describe('where the icon stands', () => {
  it('the own one is the middle of the city, the opponent one beside it', () => {
    const city = { x: 10, y: 10 };
    const marker = { x: 50, y: 16 };
    expect(iconPoint(city, marker, true, true)).toEqual(city);
    expect(iconPoint(city, marker, false, false)).toEqual(city);
    expect(iconPoint(city, marker, false, true)).toEqual(marker);
    expect(stackKey(3, 1)).not.toBe(stackKey(3, 0));
  });
});

describe('stackGroups, the gathered Defense bonus (DEC-30)', () => {
  const defending = (id: string, units: number, bonus: number | null, cap: number | null) => ({
    ...group(id, units, units, 'defense'),
    defense_bonus: bonus,
    defense_cap: cap,
  });

  it('sums the bonus and the cap of the own groups in Defense, as the server sent them', () => {
    const stacks = stackGroups(
      [
        inNode(defending('a', 3, 2, 3), 3),
        inNode(defending('b', 2, 1, 2), 3),
        inNode(group('c', 4, 4), 3),
      ],
      0,
    );
    expect(stacks[0]?.defense).toEqual({ bonus: 3, cap: 5 });
  });

  it('has none for a stack without the numbers (a group not in Defense, or an old replay)', () => {
    expect(stackGroups([inNode(group('a', 3, 3), 3)], 0)[0]?.defense).toBeNull();
    expect(stackGroups([inNode(defending('a', 3, null, null), 3)], 0)[0]?.defense).toBeNull();
  });

  it('never has one for the opponent: it shows the mode only, whatever the data say', () => {
    const stacks = stackGroups(
      [inNode(defending('a', 3, 2, 3), 3, 1), inNode(defending('b', 2, 1, 2), 3, 0)],
      0,
    );
    expect(stacks.find((s) => s.owner === 1)?.defense).toBeNull();
    expect(stacks.find((s) => s.owner === 1)?.modes).toEqual(['defense']);
    expect(stacks.find((s) => s.owner === 0)?.defense).toEqual({ bonus: 1, cap: 2 });
    // Seen from the other side the roles swap.
    const swapped = stackGroups([inNode(defending('a', 3, 2, 3), 3, 1)], 1);
    expect(swapped[0]?.defense).toEqual({ bonus: 2, cap: 3 });
  });
});
