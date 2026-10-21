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
