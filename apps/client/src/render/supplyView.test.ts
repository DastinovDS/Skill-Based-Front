import type { Container, Graphics } from 'pixi.js';
import { CanvasTextMetrics } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { interpolateFrame } from '../net/interpolate.ts';
import { warehouseSegments } from './cityLayout.ts';
import { createLayers } from './layers.ts';
import { SEGMENT_EMPTY_BAR, YOU } from './style.ts';
import { SupplyView } from './supplyView.ts';

const map = DEFAULT_MAP;
const snapshot = devSnapshot(map, DEV_RULES, 100);

interface Shape {
  readonly type: string;
  readonly color: number;
}

/** The shapes filled into a Graphics, with the colour of the fill. */
function fills(g: Graphics): Shape[] {
  const instructions = g.context.instructions as unknown as {
    action: string;
    data: {
      style: { color: number };
      path: { shapePath: { shapePrimitives: { shape: { type: string } }[] } };
    };
  }[];
  return instructions
    .filter((i) => i.action === 'fill')
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
    // One square per place of every warehouse: a charge held in the colour of the side, room in grey.
    const expected = own.flatMap((n) =>
      warehouseSegments(n.warehouse ?? 0, n.warehouse_cap ?? 0).segments.map((s) =>
        s.filled ? YOU : SEGMENT_EMPTY_BAR,
      ),
    );
    const squares = rects.filter((s) => s.color === YOU || s.color === SEGMENT_EMPTY_BAR);
    expect(squares.map((s) => s.color).sort()).toEqual([...expected].sort());
    // No circle stands for a charge of a warehouse any more.
    expect(shapes.filter((s) => s.type === 'circle' && s.color === YOU)).toEqual([]);
    view.destroy();
  });
});
