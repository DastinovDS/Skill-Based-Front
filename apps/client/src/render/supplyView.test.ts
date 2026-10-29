import type { Container, Graphics, Text } from 'pixi.js';
import { CanvasTextMetrics } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PacketView, SnapshotMsg } from '../protocol.gen.ts';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { interpolateFrame } from '../net/interpolate.ts';
import { createLayers } from './layers.ts';
import { setReducedMotion } from './motion.ts';
import { pipeBore } from './pipeLayout.ts';
import {
  BG,
  PAPER,
  SUPPLY_BULKHEAD,
  SUPPLY_GAUGE,
  SUPPLY_PACKET,
  SUPPLY_PIPE,
  YOU,
} from './style.ts';
import { SupplyView } from './supplyView.ts';

const map = DEFAULT_MAP;
const snapshot = devSnapshot(map, DEV_RULES, 100);

interface Shape {
  readonly type: string;
  readonly color: number;
}

/** The shapes filled (or stroked: `action`) into a Graphics, with the colour of the fill. */
function fills(g: Graphics, action: 'fill' | 'stroke' = 'fill'): Shape[] {
  const instructions = g.context.instructions as unknown as {
    action: string;
    data: {
      style: { color: number };
      path: { shapePath: { shapePrimitives: { shape: { type: string } }[] } };
    };
  }[];
  return instructions
    .filter((i) => i.action === action)
    .flatMap((i) =>
      i.data.path.shapePath.shapePrimitives.map((p) => ({
        type: p.shape.type,
        color: i.data.style.color,
      })),
    );
}

interface Stroke {
  readonly width: number;
  readonly color: number;
  readonly alpha: number;
}

/** The strokes of a Graphics: width, colour and opacity of each. */
function strokes(g: Graphics): Stroke[] {
  const instructions = g.context.instructions as unknown as {
    action: string;
    data: { style: Stroke };
  }[];
  return instructions.filter((i) => i.action === 'stroke').map((i) => i.data.style);
}

/** The children of the layer: pipes, flowing dashes, plates, packet dots, texts. */
function parts(layers: ReturnType<typeof createLayers>) {
  const [root] = layers.layer.supply.children as Container[];
  const [pipes, flowing, plates, dots, texts] = (root?.children ?? []) as [
    Graphics,
    Graphics,
    Graphics,
    Graphics,
    Container,
  ];
  return { pipes, flowing, plates, dots, texts };
}

const mockText = () =>
  vi
    .spyOn(CanvasTextMetrics, 'measureText')
    .mockImplementation(
      (text: string) => ({ width: text.length * 7, height: 14 }) as CanvasTextMetrics,
    );

const own = (id: number) => snapshot.view.nodes[id]?.owner === 0;
const ownRoads = map.edges.filter((e) => own(e.a) && own(e.b));

/** The snapshot with every road at `level` and the packets `packets`. */
function with_(level: number, packets: PacketView[] = []): SnapshotMsg {
  return {
    ...snapshot,
    view: {
      ...snapshot.view,
      edges: snapshot.view.edges.map((e) => ({ ...e, width: level })),
      packets,
    },
  };
}

describe('SupplyView: the pipes (#429)', () => {
  beforeEach(() => {
    mockText();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    setReducedMotion(null);
  });

  function draw(base: SnapshotMsg, tick = 100) {
    const layers = createLayers();
    const view = new SupplyView(map, layers, 0, () => 14);
    view.update(interpolateFrame(base, null, tick), { source: null, targets: [] });
    return { layers, view, ...parts(layers) };
  }

  it('draws a pipe for every own road: casing, wall and inside, the bore is the level', () => {
    expect(ownRoads.length).toBeGreaterThan(0);
    for (const level of [1, 2, 3]) {
      const { pipes, view } = draw(with_(level));
      const bore = pipeBore(level);
      const widths = strokes(pipes).map((s) => s.width);
      const count = (w: number) => widths.filter((x) => Math.abs(x - w) < 1e-9).length;
      expect(count(bore + 2 * SUPPLY_PIPE.casing)).toBe(ownRoads.length);
      expect(count(bore)).toBe(ownRoads.length);
      expect(count(bore - 2 * SUPPLY_PIPE.wall)).toBe(ownRoads.length);
      view.destroy();
    }
  });

  it('three levels have three different bores, and none is told by the hue', () => {
    const bores = [1, 2, 3].map(pipeBore);
    expect(new Set(bores).size).toBe(3);
    expect(bores).toEqual([...bores].sort((a, b) => a - b));
  });

  it('an idle pipe is dark inside, one with a packet on it is filled', () => {
    const road = ownRoads[0];
    if (road === undefined) throw new Error('no own road');
    const idle = draw(with_(2));
    expect(strokes(idle.pipes).some((s) => s.color === SUPPLY_PIPE.activeColor)).toBe(false);
    expect(strokes(idle.pipes).some((s) => s.color === YOU)).toBe(false);
    idle.view.destroy();
    const packet: PacketView = {
      id: 'p',
      edge: road.id,
      from_node: road.a,
      charges: 2,
      depart_tick: 100,
      arrive_tick: 200,
      path: [road.b],
      dest_tick: 200,
      transfer: false,
    };
    const busy = draw(with_(2, [packet]), 150);
    const lit = strokes(busy.pipes);
    expect(lit.filter((s) => s.color === SUPPLY_PIPE.activeColor)).toHaveLength(1);
    // The fill of the flow in the colour of the side, whole across the pipe (one direction).
    const fill = lit.find((s) => s.color === YOU);
    expect(fill?.alpha).toBe(SUPPLY_PIPE.fillAlpha);
    expect(fill?.width).toBeCloseTo(pipeBore(2) - 2 * SUPPLY_PIPE.wall - 0.6);
    // The number of the flow lies along the pipe, with its charges.
    const labels = busy.texts.children.filter((c) => c.visible).map((c) => (c as Text).text);
    expect(labels).toContain('2');
    busy.view.destroy();
  });

  it('opposite flows on one road fill one half of the pipe each', () => {
    const road = ownRoads[0];
    if (road === undefined) throw new Error('no own road');
    const packet = (id: string, from: number, to: number): PacketView => ({
      id,
      edge: road.id,
      from_node: from,
      charges: 1,
      depart_tick: 100,
      arrive_tick: 200,
      path: [to],
      dest_tick: 200,
      transfer: false,
    });
    const { pipes, view } = draw(
      with_(3, [packet('a', road.a, road.b), packet('b', road.b, road.a)]),
      150,
    );
    const halves = strokes(pipes).filter((s) => s.color === YOU);
    expect(halves).toHaveLength(2);
    for (const h of halves) {
      expect(h.width).toBeLessThan((pipeBore(3) - 2 * SUPPLY_PIPE.wall) / 2);
    }
    view.destroy();
  });

  it('the dashes run with the render tick and stand still with «less motion»', () => {
    const road = ownRoads[0];
    if (road === undefined) throw new Error('no own road');
    const packet: PacketView = {
      id: 'p',
      edge: road.id,
      from_node: road.a,
      charges: 1,
      depart_tick: 100,
      arrive_tick: 400,
      path: [road.b],
      dest_tick: 400,
      transfer: false,
    };
    const base = with_(2, [packet]);
    const dashesAt = (tick: number): string => {
      const layers = createLayers();
      const view = new SupplyView(map, layers, 0, () => 14);
      // The render tick runs on from the snapshot: the dashes follow it, the snapshot stays.
      view.update({ ...interpolateFrame(base, null, 150), tick }, { source: null, targets: [] });
      const { flowing } = parts(layers);
      const instructions = flowing.context.instructions as unknown as {
        data: { path: { shapePath: { shapePrimitives: { shape: { points?: number[] } }[] } } };
      }[];
      const shapes = JSON.stringify(
        instructions.flatMap((i) =>
          i.data.path.shapePath.shapePrimitives.map((p) => p.shape.points),
        ),
      );
      view.destroy();
      return shapes;
    };
    expect(dashesAt(150)).not.toBe(dashesAt(153));
    setReducedMotion(true);
    expect(dashesAt(150)).toBe(dashesAt(153));
  });

  it('puts a bulkhead on a road to a place that is not own, and no pipe', () => {
    const { pipes, view } = draw(with_(2));
    const bulkheads = strokes(pipes).filter((s) => s.width === SUPPLY_BULKHEAD.casing);
    expect(bulkheads.length).toBeGreaterThan(0);
    view.destroy();
  });
});

describe('SupplyView: the warehouse gauge', () => {
  beforeEach(() => {
    mockText();
  });
  afterEach(() => vi.restoreAllMocks());

  it('draws the stock of an own city as a filled share of a bar with «stock/capacity» beside it', () => {
    const layers = createLayers();
    const view = new SupplyView(map, layers, 0, () => 14);
    view.update(interpolateFrame(snapshot, null, 100), { source: null, targets: [] });
    const { plates, texts } = parts(layers);
    const places = snapshot.view.nodes.filter(
      (n) =>
        n.owner === 0 && n.warehouse !== null && n.warehouse_cap !== null && n.warehouse_cap > 0,
    );
    expect(places.length).toBeGreaterThan(0);
    const rects = fills(plates).filter((s) => s.type === 'rectangle');
    const held = rects.filter((s) => s.color === YOU);
    expect(held).toHaveLength(places.filter((n) => (n.warehouse ?? 0) > 0).length);
    const shown = texts.children.filter((c) => c.visible).map((c) => (c as Text).text);
    for (const n of places)
      expect(shown).toContain(`${String(n.warehouse)}/${String(n.warehouse_cap)}`);
    // The rest of the capacity is a pale bar, one for every city.
    expect(rects.filter((s) => s.color === PAPER)).toHaveLength(places.length);
    expect(SUPPLY_GAUGE.width).toBeGreaterThan(0);
    // No circle stands for a charge of a warehouse.
    expect(fills(plates).filter((s) => s.type === 'circle' && s.color === YOU)).toEqual([]);
    view.destroy();
  });

  it('shows the front markers as a ring and a badge with the number', () => {
    const city = snapshot.view.nodes.find((n) => n.owner === 0 && n.warehouse_cap !== null);
    if (city === undefined) throw new Error('no own city');
    const base: SnapshotMsg = {
      ...snapshot,
      view: { ...snapshot.view, me: { ...snapshot.view.me, fronts: [city.id, null] } },
    };
    const layers = createLayers();
    const view = new SupplyView(map, layers, 0, () => 14);
    view.update(interpolateFrame(base, null, 100), { source: null, targets: [] });
    const { plates, texts } = parts(layers);
    expect(strokes(plates).some((s) => s.color === YOU && s.width === 3)).toBe(true);
    expect(fills(plates).some((s) => s.type === 'circle' && s.color === BG)).toBe(true);
    expect(texts.children.some((c) => c.visible && (c as Text).text === '1')).toBe(true);
    view.destroy();
  });
});

describe('SupplyView: the packets (#429)', () => {
  beforeEach(() => {
    mockText();
  });
  afterEach(() => vi.restoreAllMocks());

  const edge = map.edges[0];
  if (edge === undefined) throw new Error('no roads');
  const packet = (id: string, transfer: boolean, charges = 1): PacketView => ({
    id,
    edge: edge.id,
    from_node: edge.a,
    charges,
    depart_tick: 100,
    arrive_tick: 200,
    path: [edge.b],
    dest_tick: 200,
    transfer,
  });

  /** The shapes the dots Graphics of the layer draws for these packets. */
  function drawnPackets(list: PacketView[]): { type: string; radius?: number; width?: number }[] {
    const layers = createLayers();
    const view = new SupplyView(map, layers, 0, () => 14);
    const own: SnapshotMsg = { ...snapshot, view: { ...snapshot.view, packets: list } };
    view.update(interpolateFrame(own, null, 150), { source: null, targets: [] });
    const { dots } = parts(layers);
    const instructions = (dots.context.instructions ?? []) as unknown as {
      data: {
        path: {
          shapePath: {
            shapePrimitives: { shape: { type: string; radius?: number; width?: number } }[];
          };
        };
      };
    }[];
    const shapes = instructions
      .flatMap((i) => i.data.path.shapePath.shapePrimitives)
      .map((p) => p.shape);
    view.destroy();
    return shapes;
  }

  it('draws an automatic packet as a circle that grows with its charges', () => {
    const small = drawnPackets([packet('a', false, 1)]).filter((s) => s.type === 'circle');
    const big = drawnPackets([packet('b', false, 4)]).filter((s) => s.type === 'circle');
    expect(small.map((s) => s.radius)).toEqual([
      SUPPLY_PACKET.radius + SUPPLY_PACKET.perCharge,
      SUPPLY_PACKET.radius + SUPPLY_PACKET.perCharge,
    ]);
    expect(big[0]?.radius).toBeGreaterThan(small[0]?.radius ?? 0);
    expect(drawnPackets([packet('a', false)]).some((s) => s.type === 'rectangle')).toBe(false);
  });

  it('draws a transfer as a square, never a circle (the shape tells it, not the hue)', () => {
    const shapes = drawnPackets([packet('t', true)]);
    expect(shapes.some((s) => s.type === 'circle')).toBe(false);
    expect(
      shapes.filter((s) => s.type === 'rectangle' || s.type === 'roundedRectangle'),
    ).not.toEqual([]);
  });
});
