import type { Container, Graphics } from 'pixi.js';
import { CanvasTextMetrics } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PacketView, SnapshotMsg } from '../protocol.gen.ts';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { interpolateFrame } from '../net/interpolate.ts';
import { warehouseSegments } from './cityLayout.ts';
import { createLayers } from './layers.ts';
import { PLACE_FRAME, SUPPLY_PACKET, YOU } from './style.ts';
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

describe('SupplyView: the warehouse (#325)', () => {
  beforeEach(() => {
    vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation(
      (text: string) => ({ width: text.length * 7, height: 14 }) as CanvasTextMetrics,
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('draws the stock of an own city as squares, like the normal map, not as circles', () => {
    const layers = createLayers();
    const view = new SupplyView(map, layers, 0, () => 14);
    view.update(interpolateFrame(snapshot, null, 100), { source: null, targets: [] });
    const [root] = layers.layer.supply.children as Container[];
    const plates = root?.children[1] as Graphics;
    const shapes = fills(plates);
    const rects = shapes.filter((s) => s.type === 'rectangle');
    const own = snapshot.view.nodes.filter(
      (n) => n.owner === 0 && n.warehouse !== null && n.warehouse_cap !== null,
    );
    expect(own.length).toBeGreaterThan(0);
    // One square per place of every warehouse: a charge held is filled in the colour of the side,
    // room is a grey frame (C1, #348).
    const places = own.flatMap((n) =>
      warehouseSegments(n.warehouse ?? 0, n.warehouse_cap ?? 0).segments.map((s) => s.state),
    );
    const held = rects.filter((s) => s.color === YOU);
    expect(held).toHaveLength(places.filter((state) => state === 'filled').length);
    const frames = fills(plates, 'stroke').filter(
      (s) => s.type === 'rectangle' && s.color === PLACE_FRAME.color,
    );
    expect(frames).toHaveLength(places.filter((state) => state === 'frame').length);
    // No circle stands for a charge of a warehouse any more.
    expect(shapes.filter((s) => s.type === 'circle' && s.color === YOU)).toEqual([]);
    view.destroy();
  });
});

describe('SupplyView: the packets (a charge is a square, #345)', () => {
  beforeEach(() => {
    vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation(
      (text: string) => ({ width: text.length * 7, height: 14 }) as CanvasTextMetrics,
    );
  });
  afterEach(() => vi.restoreAllMocks());

  const edge = map.edges[0];
  if (edge === undefined) throw new Error('no roads');
  const packet = (id: string, transfer: boolean): PacketView => ({
    id,
    edge: edge.id,
    from_node: edge.a,
    charges: 1,
    depart_tick: 100,
    arrive_tick: 200,
    path: [edge.b],
    dest_tick: 200,
    transfer,
  });

  /** The squares and circles the dots Graphics of the layer draws for these packets. */
  function drawnPackets(transfers: boolean[]): { rects: number[]; circles: number } {
    const layers = createLayers();
    const view = new SupplyView(map, layers, 0, () => 14);
    const packets = transfers.map((t, i) => packet(`p${String(i)}`, t));
    const own: SnapshotMsg = { ...snapshot, view: { ...snapshot.view, packets } };
    view.update(interpolateFrame(own, null, 150), { source: null, targets: [] });
    const [root] = layers.layer.supply.children as Container[];
    const dots = root?.children[2] as Graphics | undefined;
    const instructions = (dots?.context.instructions ?? []) as unknown as {
      data: {
        path: { shapePath: { shapePrimitives: { shape: { type: string; width?: number } }[] } };
      };
    }[];
    const shapes = instructions
      .flatMap((i) => i.data.path.shapePath.shapePrimitives)
      .map((p) => p.shape);
    view.destroy();
    return {
      rects: shapes.filter((s) => s.type === 'rectangle').map((s) => s.width ?? 0),
      circles: shapes.filter((s) => s.type === 'circle').length,
    };
  }

  it('draws an automatic packet as a square and no circle', () => {
    expect(drawnPackets([false])).toEqual({
      rects: [SUPPLY_PACKET.side, SUPPLY_PACKET.side],
      circles: 0,
    });
  });

  it('draws a transfer as a bigger square with a second outline round it', () => {
    const { rects, circles } = drawnPackets([true]);
    expect(circles).toBe(0);
    expect(rects).toEqual([
      SUPPLY_PACKET.transferSide,
      SUPPLY_PACKET.transferSide,
      SUPPLY_PACKET.transferRing,
    ]);
  });
});
