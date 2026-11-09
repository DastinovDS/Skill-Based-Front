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
import { SUPPLY_BULKHEAD, SUPPLY_PACKET, YOU } from './style.ts';
import { SupplyView } from './supplyView.ts';
import { testSprites } from './testSprites.ts';

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

/** The parts of the view: the pipes (on the road layer), the flowing dashes, plates, packet dots, texts. */
function parts(layers: ReturnType<typeof createLayers>) {
  const [root] = layers.layer.supply.children as Container[];
  const [flowing, plates, marks, dots] = (root?.children ?? []) as [
    Graphics,
    Graphics,
    Container,
    Graphics,
  ];
  // The flow's hover layers (dimmer, chain, ring) lie between the dots and the texts.
  const texts = root?.children.find((c) => c.label === 'supply-texts') as Container;
  const pipeRoot = layers.layer.roads.children.find((c) => c.label === 'supply-pipes');
  return { pipes: pipeRoot?.children[0] as Graphics, flowing, plates, marks, dots, texts };
}

const mockText = () =>
  vi
    .spyOn(CanvasTextMetrics, 'measureText')
    .mockImplementation(
      (text: string) => ({ width: text.length * 7, height: 14 }) as CanvasTextMetrics,
    );

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
    const view = new SupplyView(map, layers, 0, () => 14, testSprites());
    view.update(interpolateFrame(base, null, tick), { source: null, targets: [], draft: [] });
    return { layers, view, ...parts(layers) };
  }

  it('three levels have three different bores, and none is told by the hue', () => {
    const bores = [1, 2, 3].map(pipeBore);
    expect(new Set(bores).size).toBe(3);
    expect(bores).toEqual([...bores].sort((a, b) => a - b));
  });

  it('puts a bulkhead on a road to a place that is not own, and no pipe', () => {
    const { pipes, view } = draw(with_(2));
    const bulkheads = strokes(pipes).filter((s) => s.width === SUPPLY_BULKHEAD.casing);
    expect(bulkheads.length).toBeGreaterThan(0);
    view.destroy();
  });
});

describe('SupplyView: the cities and the front markers', () => {
  beforeEach(() => {
    mockText();
  });
  afterEach(() => vi.restoreAllMocks());

  it('draws no gauge: the warehouse is the lozenges of the city (#858)', () => {
    const layers = createLayers();
    const view = new SupplyView(map, layers, 0, () => 14, testSprites());
    view.update(interpolateFrame(snapshot, null, 100), { source: null, targets: [], draft: [] });
    const { plates, texts } = parts(layers);
    expect(fills(plates).filter((s) => s.type === 'rectangle' && s.color === YOU)).toEqual([]);
    const shown = texts.children.filter((c) => c.visible).map((c) => (c as Text).text);
    expect(shown.some((t) => /^\d+\/\d+$/.test(t))).toBe(false);
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
  const packet = (id: string, _transfer: boolean, charges = 1): PacketView => ({
    id,
    edge: edge.id,
    from_node: edge.a,
    charges,
    depart_tick: 100,
    arrive_tick: 200,
    path: [edge.b],
    dest_tick: 200,
  });

  /** The shapes the dots Graphics of the layer draws for these packets. */
  function drawnPackets(list: PacketView[]): { type: string; radius?: number; width?: number }[] {
    const layers = createLayers();
    const view = new SupplyView(map, layers, 0, () => 14, testSprites());
    const own: SnapshotMsg = { ...snapshot, view: { ...snapshot.view, packets: list } };
    view.update(interpolateFrame(own, null, 150), { source: null, targets: [], draft: [] });
    const { dots } = parts(layers);
    const instructions = dots.context.instructions as unknown as {
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
});
