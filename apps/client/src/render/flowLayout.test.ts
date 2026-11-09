import { describe, expect, it } from 'vitest';
import type { FlowIdle, GroupView, MapFile, NodeView, PacketView, View } from '../protocol.gen.ts';
import {
  aheadNodes,
  downhillRoads,
  flowOn,
  levelNodes,
  packetRoads,
  pocketNodes,
  roadKey,
  shiftLabel,
  starvingNodes,
} from './flowLayout.ts';
import { edgeIndex } from './supplyLayout.ts';

// A road tree: the capital 0 - 1 - 2 - 3 in a line (3 touches the enemy 4), a branch 1 - 5 (a
// province, touching the neutral 6) and a pocket 7 (own, no factory, touching the enemy 4).
const map = {
  nodes: [0, 1, 2, 3, 4, 5, 6, 7].map((id) => ({ id, kind: id === 5 ? 'province' : 'city_small' })),
  edges: [
    { id: 0, a: 0, b: 1 },
    { id: 1, a: 1, b: 2 },
    { id: 2, a: 2, b: 3 },
    { id: 3, a: 3, b: 4 },
    { id: 4, a: 1, b: 5 },
    { id: 5, a: 5, b: 6 },
    { id: 6, a: 7, b: 4 },
  ],
} as unknown as MapFile;
const index = edgeIndex(map);

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

describe('which nodes are the level, ahead of it, or a pocket (T1, DEC-43 item E)', () => {
  it('the level is front_dist == leaf_shift, ahead is below it', () => {
    expect(levelNodes(view(0), 0)).toEqual([3, 7]);
    expect(levelNodes(view(1), 0)).toEqual([2, 5]);
    expect(levelNodes(view(2), 0)).toEqual([1]);
    expect(aheadNodes(view(0), 0)).toEqual([]);
    expect(aheadNodes(view(1), 0)).toEqual([3, 7]);
    expect(aheadNodes(view(2), 0).sort()).toEqual([2, 3, 5, 7]);
  });

  it('never the enemy or a neutral node, whatever its fields', () => {
    const v = view(0);
    const nodes = v.nodes.map((n) => (n.id === 4 ? { ...n, front_dist: 0 } : n));
    expect(levelNodes({ ...v, nodes }, 0)).toEqual([3, 7]);
    expect(levelNodes({ ...v, nodes }, 1)).toEqual([4]);
  });

  it('there is no level without a flow (leaf_shift null) or in the old view', () => {
    const v = view(0);
    const lines = { ...v, me: { ...v.me, leaf_shift: null } };
    expect(flowOn(lines)).toBe(false);
    expect(levelNodes(lines, 0)).toEqual([]);
    expect(aheadNodes(lines, 0)).toEqual([]);
    expect(flowOn(view(0))).toBe(true);
    // A view without the field at all (a fixture of an older protocol) is not a flow either.
    const old = { ...v, me: { ...v.me } } as { me: Record<string, unknown> };
    delete old.me['leaf_shift'];
    expect(flowOn(old as unknown as View)).toBe(false);
  });

  it('the pocket is flow_pocket', () => {
    expect(pocketNodes(view(0), 0)).toEqual([7]);
  });
});

describe('the roads of the flow (chevrons) and the packets on them', () => {
  it('flow_down gives the downhill roads, by node then neighbour', () => {
    expect(downhillRoads(view(0), 0, index)).toEqual([
      { edge: 0, from: 0, to: 1 },
      { edge: 1, from: 1, to: 2 },
      { edge: 4, from: 1, to: 5 },
      { edge: 2, from: 2, to: 3 },
    ]);
  });

  it('a road with an own packet on it is told apart by its direction', () => {
    const roads = packetRoads(view(0, { packets: [packet(1, 1, 2)] }));
    expect(roads.has(roadKey(1, 1))).toBe(true);
    expect(roads.has(roadKey(1, 2))).toBe(false);
    expect(roads.has(roadKey(0, 0))).toBe(false);
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

describe('the words of the shift control', () => {
  it('"front" at 0, a real minus and the number otherwise', () => {
    expect(shiftLabel(0, 'front')).toBe('front');
    expect(shiftLabel(1, 'front')).toBe('−1');
    expect(shiftLabel(3, 'front')).toBe('−3');
  });
});
