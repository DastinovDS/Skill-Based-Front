import { describe, expect, it } from 'vitest';
import type { GroupView, OrderView } from '../protocol.gen.ts';
import {
  groupOrders,
  insideRect,
  normRect,
  routeRuns,
  sealLozenges,
  secondsUntil,
  waitShare,
  waitingDeparture,
} from './groupOrderLayout.ts';

describe('the routes of a group order preview (#1004)', () => {
  it('draws the longest route whole and joins the others where they meet it', () => {
    // Three members converge on 5: 6-7-12-4-5, 12-4-5 and 3-4-5 (the server's routes).
    const runs = routeRuns([
      [3, 4, 5],
      [12, 4, 5],
      [6, 7, 12, 4, 5],
    ]);
    expect(runs).toEqual([
      { nodes: [6, 7, 12, 4, 5], head: true },
      { nodes: [3, 4], head: false },
    ]);
  });

  it('gives each road into the target its own head', () => {
    expect(
      routeRuns([
        [1, 5],
        [2, 5],
      ]),
    ).toEqual([
      { nodes: [1, 5], head: true },
      { nodes: [2, 5], head: true },
    ]);
  });

  it('draws again where a route leaves the shared roads and comes back', () => {
    expect(
      routeRuns([
        [1, 2, 3, 4, 5],
        [0, 2, 9, 4, 5],
      ]),
    ).toEqual([
      { nodes: [1, 2, 3, 4, 5], head: true },
      { nodes: [0, 2, 9, 4], head: false },
    ]);
  });

  it('draws nothing for no routes', () => {
    expect(routeRuns([])).toEqual([]);
  });
});

const order = (over: Partial<OrderView> = {}): OrderView => ({
  dest: 9,
  path: [9],
  planned: false,
  bonus: 0,
  gathering: false,
  plan: 0,
  next_charge_tick: null,
  depart_tick: null,
  group_order: null,
  arrive_tick: null,
  ...over,
});

const inNode = (id: string, node: number, o: OrderView | null): GroupView => ({
  id,
  units: 2,
  charged: 2,
  mode: 'attack',
  location: { kind: 'node', node },
  order: o,
});

const onEdge = (id: string, o: OrderView): GroupView => ({
  ...inNode(id, 0, o),
  location: { kind: 'edge', edge: 1, from_node: 0, progress: 100 },
});

describe('the box of a Shift drag (DEC-48, item K1)', () => {
  it('takes its corners in any order, edges included', () => {
    const rect = { x0: 10, y0: 40, x1: 0, y1: 20 };
    expect(normRect(rect)).toEqual({ x: 0, y: 20, width: 10, height: 20 });
    expect(insideRect(rect, { x: 0, y: 20 })).toBe(true);
    expect(insideRect(rect, { x: 5, y: 30 })).toBe(true);
    expect(insideRect(rect, { x: 11, y: 30 })).toBe(false);
  });
});

describe('the group orders of a snapshot (DEC-48, item I1)', () => {
  it('gathers the members of each order by its id, the moving ones counted', () => {
    const marks = groupOrders([
      inNode('a', 1, order({ group_order: 'o1', arrive_tick: 159, depart_tick: 120 })),
      onEdge('b', order({ group_order: 'o1', arrive_tick: 159, depart_tick: 100 })),
      inNode('c', 2, order()),
      inNode('d', 3, null),
      inNode('e', 4, order({ dest: 5, group_order: 'o2', planned: true, gathering: true })),
    ]);
    expect(marks).toEqual([
      { id: 'o1', dest: 9, arrive: 159, members: ['a', 'b'], moving: 1 },
      { id: 'o2', dest: 5, arrive: null, members: ['e'], moving: 0 },
    ]);
  });

  it('fills a lozenge per member on the way, for a rally per member merged', () => {
    const mark = { id: 'o', dest: 9, arrive: 10, members: ['a', 'b'], moving: 1 };
    expect(sealLozenges(mark, 3, false)).toEqual([true, false, false]);
    expect(sealLozenges(mark, 3, true)).toEqual([true, false, false]);
    expect(sealLozenges({ ...mark, members: ['a'], moving: 0 }, 3, true)).toEqual([
      true,
      true,
      false,
    ]);
  });
});

describe('a waiting member (DEC-48, item C2)', () => {
  it('waits in its node until a departure still ahead', () => {
    expect(waitingDeparture(inNode('a', 1, order({ depart_tick: 120 })), 100)).toBe(120);
    expect(waitingDeparture(inNode('a', 1, order({ depart_tick: 100 })), 100)).toBeNull();
    expect(waitingDeparture(inNode('a', 1, order({ depart_tick: null })), 100)).toBeNull();
    expect(waitingDeparture(onEdge('a', order({ depart_tick: 120 })), 100)).toBeNull();
    expect(
      waitingDeparture(inNode('a', 1, order({ depart_tick: 120, gathering: true })), 100),
    ).toBeNull();
  });

  it('runs its sand from the tick it was first seen to its departure', () => {
    expect(waitShare(120, 100, 100)).toBe(1);
    expect(waitShare(120, 100, 110)).toBe(0.5);
    expect(waitShare(120, 100, 130)).toBe(0);
    expect(waitShare(120, 120, 110)).toBe(1);
  });

  it('counts whole seconds up, never below zero', () => {
    expect(secondsUntil(159, 100, 10)).toBe(6);
    expect(secondsUntil(150, 100, 10)).toBe(5);
    expect(secondsUntil(90, 100, 10)).toBe(0);
  });
});
