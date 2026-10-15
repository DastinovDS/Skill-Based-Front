import { describe, expect, it } from 'vitest';
import type { NodeView, PacketView, View } from '../protocol.gen.ts';
import { priorityMarks, signCorners, signPoint, supplyRoutes } from './supplyLayout.ts';

const node = (id: number, priority: NodeView['priority']): NodeView => ({
  id,
  owner: priority === null ? null : 0,
  capacity: 6,
  detail: priority === null ? 'fog' : 'exact',
  warehouse: priority === null ? null : 2,
  seen: null,
  build: null,
  attrition_in: null,
  grace_left: null,
  priority,
  starve_in: null,
  recruit_queue: null,
  recruit_progress: null,
  recruit_waiting: null,
});

const packet = (id: string, transfer: boolean, path: [number, ...number[]]): PacketView => ({
  id,
  edge: 0,
  from_node: 0,
  charges: 3,
  depart_tick: 10,
  arrive_tick: 40,
  path,
  dest_tick: 70,
  transfer,
});

const view = (nodes: NodeView[], packets: PacketView[]): View => ({
  me: { cp: 100, stance: 'balance' },
  vp: [0, 0],
  nodes,
  edges: [],
  groups: [],
  packets,
  intents: [],
  fights: [],
});

describe('supply layout (DEC-18)', () => {
  it('marks only the cities the view gives a priority (own cities)', () => {
    const v = view([node(0, 'high'), node(1, null), node(2, 'low')], []);
    expect(priorityMarks(v)).toEqual([
      { node: 0, priority: 'high' },
      { node: 2, priority: 'low' },
    ]);
  });

  it('a route runs from the start of the current road along the server path', () => {
    const v = view([], [packet('a', false, [1]), packet('b', true, [1, 2])]);
    expect(supplyRoutes(v)).toEqual([
      { id: 'a', nodes: [0, 1], transfer: false, charges: 3 },
      { id: 'b', nodes: [0, 1, 2], transfer: true, charges: 3 },
    ]);
  });

  it('tells the priority by shape: up, round, down', () => {
    const at = { x: 0, y: 0 };
    const up = signCorners('high', at, 10);
    const down = signCorners('low', at, 10);
    expect(up).toHaveLength(3);
    expect(Math.min(...up.map((p) => p.y))).toBe(-5); // the tip is on top
    expect(down.find((p) => p.x === 0)?.y).toBe(5); // the tip is at the bottom
    expect(signCorners('normal', at, 10)).toEqual([]);
    const spot = signPoint({ x: 100, y: 100 }, 17, 10);
    expect(spot.x).toBeLessThan(100 - 17 / 2);
    expect(spot.y).toBeLessThan(100 - 17 / 2);
  });
});
