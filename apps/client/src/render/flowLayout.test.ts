import { describe, expect, it } from 'vitest';
import type { FlowIdle, GroupView, NodeView, PacketView, View } from '../protocol.gen.ts';
import { flowOn, starvingNodes } from './flowLayout.ts';

interface Spec {
  owner?: 0 | 1 | null;
  dist?: number | null;
  down?: number[];
  next?: number[];
  idle?: FlowIdle | null;
  stock?: number | null;
  cap?: number | null;
  pocket?: boolean;
}

const node = (id: number, spec: Spec): NodeView =>
  ({
    id,
    owner: spec.owner === undefined ? 0 : spec.owner,
    warehouse: spec.stock === undefined ? 0 : spec.stock,
    warehouse_cap: spec.cap === undefined ? 3 : spec.cap,
    front_dist: spec.dist ?? null,
    flow_down: spec.owner === 0 || spec.owner === undefined ? (spec.down ?? []) : null,
    flow_next: spec.owner === 0 || spec.owner === undefined ? (spec.next ?? []) : null,
    flow_idle: spec.idle ?? null,
    flow_pocket: spec.pocket ?? false,
  }) as unknown as NodeView;

/** The tree at the shift `shift`: the level is `front_dist == shift`. */
function view(shift: number, extra: Partial<View> = {}): View {
  return {
    me: {
      cp: 100,
      stance: 'balance',
      leaf_shift: shift,
      leaf_shift_max: 3,
      next_dispatch_tick: 20,
      cp_ticks: null,
      capital_ticks: null,
    },
    vp: [0, 0],
    vp_gain: [0, 0],
    nodes: [
      node(0, { dist: 3, down: [1], stock: 6, cap: 6 }),
      node(1, { dist: 2, down: [2, 5] }),
      node(2, { dist: 1, down: [3] }),
      node(3, { dist: 0 }),
      node(4, { owner: 1, stock: null, cap: null }),
      node(5, { dist: 1, down: [], cap: 1 }),
      node(6, { owner: null, stock: null, cap: null }),
      node(7, { dist: 0, pocket: true }),
    ],
    edges: [],
    groups: [],
    packets: [],
    intents: [],
    fights: [],
    ...extra,
  };
}

const packet = (edge: number, from: number, to: number): PacketView => ({
  id: `p${String(edge)}`,
  edge,
  from_node: from,
  charges: 1,
  depart_tick: 10,
  arrive_tick: 30,
  path: [to],
  dest_tick: 30,
});

describe('the flow fields in the view', () => {
  it('flowOn: the fields are there when leaf_shift is a number', () => {
    expect(flowOn(view(0))).toBe(true);
    expect(flowOn(view(1))).toBe(true);
    const old = view(0);
    expect(flowOn({ ...old, me: { ...old.me, leaf_shift: null } })).toBe(false);
  });
});

describe('the node marks: starving', () => {
  it('an empty level node with nothing on the way is starving, one with a packet coming is not', () => {
    const v = view(0);
    expect(starvingNodes(v, 0)).toEqual([3, 7]);
    const coming = view(0, { packets: [packet(2, 2, 3)] });
    expect(starvingNodes(coming, 0)).toEqual([7]);
  });

  it('a node that is not on the level is not starving for an empty warehouse alone', () => {
    const v = view(0);
    const nodes = v.nodes.map((n) => (n.id === 1 ? { ...n, warehouse: 0 } : n));
    expect(starvingNodes({ ...v, nodes }, 0)).not.toContain(1);
  });

  it('a tired own army in an empty node makes it starving anywhere', () => {
    const tired: GroupView = {
      id: 'g',
      units: 2,
      charged: 1,
      mode: 'attack',
      location: { kind: 'node', node: 1 },
      order: null,
    };
    const v = view(0, { groups: [tired] });
    expect(starvingNodes(v, 0)).toContain(1);
    // A group on a road is not standing in a node: it makes nothing starving.
    const moving = {
      ...tired,
      location: { kind: 'edge' as const, edge: 1, from_node: 1, progress: 100 },
    };
    expect(starvingNodes(view(0, { groups: [moving] }), 0)).not.toContain(1);
  });
});
