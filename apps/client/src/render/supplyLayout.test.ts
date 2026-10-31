import { describe, expect, it } from 'vitest';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { MapFile, NodeView, PacketView, View } from '../protocol.gen.ts';
import { edgeIndex, lanePoint, supplyFlows, supplyScene } from './supplyLayout.ts';

// A chain 0 - 1 - 2 of roads 0 (0-1) and 1 (1-2), plus a road 2 (1-3).
const map = {
  nodes: [0, 1, 2, 3].map((id) => ({ id })),
  edges: [
    { id: 0, a: 0, b: 1 },
    { id: 1, a: 1, b: 2 },
    { id: 2, a: 1, b: 3 },
  ],
} as unknown as MapFile;
const index = edgeIndex(map);

const packet = (over: Partial<PacketView>): PacketView => ({
  id: 'p',
  edge: 0,
  from_node: 0,
  charges: 1,
  depart_tick: 10,
  arrive_tick: 40,
  path: [1],
  dest_tick: 40,
  transfer: false,
  ...over,
});

const view = (over: Partial<View>): View => ({
  me: { cp: 100, stance: 'balance', fronts: [null, null], rear_min: 1 },
  vp: [0, 0],
  nodes: [],
  edges: [],
  groups: [],
  packets: [],
  intents: [],
  fights: [],
  lines: [],
  ...over,
});

describe('supply flows (DEC-28, item 8)', () => {
  it('a packet is a flow on its current road and on every road of the server path after it', () => {
    const flows = supplyFlows(view({ packets: [packet({ charges: 2, path: [1, 2] })] }), index);
    expect(flows).toEqual([
      { edge: 0, from: 0, to: 1, charges: 2, transfer: false },
      { edge: 1, from: 1, to: 2, charges: 2, transfer: false },
    ]);
  });

  it('adds up the packets of one road and direction, apart from transfers', () => {
    const flows = supplyFlows(
      view({
        packets: [
          packet({ id: 'a', charges: 1 }),
          packet({ id: 'b', charges: 2 }),
          packet({ id: 'c', charges: 4, transfer: true }),
        ],
      }),
      index,
    );
    expect(flows).toEqual([
      { edge: 0, from: 0, to: 1, charges: 3, transfer: false },
      { edge: 0, from: 0, to: 1, charges: 4, transfer: true },
    ]);
  });

  it('keeps opposite directions of a road apart', () => {
    const flows = supplyFlows(
      view({
        packets: [packet({ id: 'a' }), packet({ id: 'b', from_node: 1, path: [0], charges: 5 })],
      }),
      index,
    );
    expect(flows.map((f) => [f.from, f.to, f.charges])).toEqual([
      [0, 1, 1],
      [1, 0, 5],
    ]);
  });

  it('flows to one city by different roads get an arrow each', () => {
    // 0 -> 1 -> 2 and 3 -> 1 -> 2: both reach city 2, the road 1-2 carries both, 0-1 and 3-1 one each.
    const flows = supplyFlows(
      view({
        packets: [
          packet({ id: 'a', path: [1, 2], charges: 1 }),
          packet({ id: 'b', edge: 2, from_node: 3, path: [1, 2], charges: 2 }),
        ],
      }),
      index,
    );
    expect(flows.map((f) => [f.edge, f.from, f.to, f.charges])).toEqual([
      [0, 0, 1, 1],
      [1, 1, 2, 3],
      [2, 3, 1, 2],
    ]);
  });

  it('skips a leg the map has no road for instead of guessing one', () => {
    const flows = supplyFlows(view({ packets: [packet({ path: [1, 9] })] }), index);
    expect(flows).toEqual([{ edge: 0, from: 0, to: 1, charges: 1, transfer: false }]);
  });
});

describe('what the layer draws (DEC-28, item 8)', () => {
  const base = devSnapshot(DEFAULT_MAP, DEV_RULES, 30).view;
  const mine = base.nodes.filter((n) => n.owner === 0 && n.warehouse_cap !== null);
  const [a, b] = mine;
  if (a === undefined || b === undefined) throw new Error('the dev snapshot lacks own cities');
  const enemyExact = base.nodes.find((n) => n.owner === 1 && n.detail === 'exact');
  const enemyPresence = base.nodes.find((n) => n.owner === 1 && n.detail === 'presence');
  if (enemyExact === undefined || enemyPresence === undefined) {
    throw new Error('the dev snapshot lacks seen enemy cities');
  }
  const idx = edgeIndex(DEFAULT_MAP);
  const scene = (over: Partial<View> = {}) =>
    supplyScene({ ...base, ...over }, 0, idx, DEFAULT_MAP.edges);

  it('shows the warehouses of own cities only, never the enemy ones (DEC-04, DEC-17)', () => {
    const { stocks } = scene();
    const ids = stocks.map((s) => s.node);
    expect(ids).toContain(a.id);
    expect(ids).not.toContain(enemyExact.id);
    expect(ids).not.toContain(enemyPresence.id);
    expect(enemyExact.warehouse).not.toBeNull(); // the view has it, the layer does not draw it
    for (const s of stocks) {
      expect(base.nodes[s.node]?.owner).toBe(0);
    }
  });

  it('shows no warehouse for a province', () => {
    const province = base.nodes.find((n) => n.owner === 0 && n.warehouse_cap === null);
    if (province === undefined) return;
    expect(scene().stocks.map((s) => s.node)).not.toContain(province.id);
  });

  it('the capacity of the dots is the warehouse capacity of the city', () => {
    const nodes: NodeView[] = base.nodes.map((n) =>
      n.id === a.id ? { ...n, warehouse: 1, warehouse_cap: 6 } : n,
    );
    expect(scene({ nodes }).stocks.find((s) => s.node === a.id)).toEqual({
      node: a.id,
      stock: 1,
      cap: 6,
    });
  });

  it('puts the front markers on their cities and skips a marker that is not placed', () => {
    const me = { ...base.me, fronts: [null, b.id] as [number | null, number | null] };
    expect(scene({ me }).markers).toEqual([{ marker: 1, node: b.id }]);
    expect(scene({ me: { ...base.me, fronts: [a.id, b.id] } }).markers).toEqual([
      { marker: 0, node: a.id },
      { marker: 1, node: b.id },
    ]);
  });

  it('shows an own cut-off city with its starvation timer', () => {
    const nodes = base.nodes.map((n) => (n.id === b.id ? { ...n, starve_in: 73 } : n));
    expect(scene({ nodes }).cut).toEqual([{ node: b.id, ticks: 73 }]);
    expect(scene().cut).toEqual([]);
  });

  it('shows the enemy only as presence where it is seen now, not in fog', () => {
    const { presence } = scene();
    expect(presence).toContainEqual({ kind: 'node', id: enemyExact.id });
    expect(presence).toContainEqual({ kind: 'node', id: enemyPresence.id });
    const fogged = base.nodes.map((n) =>
      n.id === enemyExact.id ? { ...n, detail: 'fog' as const } : n,
    );
    expect(scene({ nodes: fogged }).presence).not.toContainEqual({
      kind: 'node',
      id: enemyExact.id,
    });
    // Nothing about the enemy's numbers, stock, packets or markers reaches the scene.
    expect(Object.keys(scene()).sort()).toEqual([
      'bulkheads',
      'cut',
      'flows',
      'levels',
      'markers',
      'pipes',
      'presence',
      'stocks',
    ]);
  });
});

describe('pipes (#429)', () => {
  const base = devSnapshot(DEFAULT_MAP, DEV_RULES, 30).view;
  const idx = edgeIndex(DEFAULT_MAP);
  const scene = (over: Partial<View> = {}) =>
    supplyScene({ ...base, ...over }, 0, idx, DEFAULT_MAP.edges);
  const owner = (id: number) => base.nodes[id]?.owner;

  it('a pipe for every road whose two ends are own cities, with the level of the view', () => {
    const edges = base.edges.map((e) => ({ ...e, width: e.id % 3 === 0 ? 3 : 2 }));
    const { pipes } = scene({ edges });
    expect(pipes.length).toBeGreaterThan(0);
    for (const pipe of pipes) {
      expect(owner(pipe.a)).toBe(0);
      expect(owner(pipe.b)).toBe(0);
      expect(pipe.level).toBe(pipe.edge % 3 === 0 ? 3 : 2);
    }
    const own = DEFAULT_MAP.edges.filter((e) => owner(e.a) === 0 && owner(e.b) === 0);
    expect(pipes.map((p) => p.edge).sort()).toEqual(own.map((e) => e.id).sort());
  });

  it('a bulkhead for every road between an own city and a place that is not own, no pipe', () => {
    const { pipes, bulkheads } = scene();
    expect(bulkheads.length).toBeGreaterThan(0);
    for (const bulkhead of bulkheads) {
      expect([owner(bulkhead.a), owner(bulkhead.b)].filter((o) => o === 0)).toHaveLength(1);
      expect(pipes.map((p) => p.edge)).not.toContain(bulkhead.edge);
    }
  });

  it('clamps a level the view gives out of 1..3 and keeps every road level for the flows', () => {
    const edges = base.edges.map((e) => ({ ...e, width: 7 }));
    const { levels } = scene({ edges });
    expect(levels.size).toBe(base.edges.length);
    expect([...levels.values()].every((l) => l === 3)).toBe(true);
  });

  it('no pipe and no bulkhead without the ends of the roads', () => {
    const bare = supplyScene(base, 0, idx);
    expect(bare.pipes).toEqual([]);
    expect(bare.bulkheads).toEqual([]);
  });
});

describe('lanes', () => {
  it('opposite directions of a road are on opposite sides of it', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 };
    const there = lanePoint(a, b, 0.5, 8);
    const back = lanePoint(b, a, 0.5, 8);
    expect(there).toEqual({ x: 50, y: 8 });
    expect(back.x).toBeCloseTo(50);
    expect(back.y).toBeCloseTo(-8);
  });
});
