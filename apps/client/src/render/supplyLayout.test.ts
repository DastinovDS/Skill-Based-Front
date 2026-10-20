import { describe, expect, it } from 'vitest';
import type { PacketView, View } from '../protocol.gen.ts';
import { supplyRoutes } from './supplyLayout.ts';

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

const view = (packets: PacketView[]): View => ({
  me: { cp: 100, stance: 'balance', fronts: [null, null], rear_min: 1 },
  vp: [0, 0],
  nodes: [],
  edges: [],
  groups: [],
  packets,
  intents: [],
  fights: [],
});

describe('supply layout (DEC-18)', () => {
  it('a route runs from the start of the current road along the server path', () => {
    const v = view([packet('a', false, [1]), packet('b', true, [1, 2])]);
    expect(supplyRoutes(v)).toEqual([
      { id: 'a', nodes: [0, 1], transfer: false, charges: 3 },
      { id: 'b', nodes: [0, 1, 2], transfer: true, charges: 3 },
    ]);
  });
});
