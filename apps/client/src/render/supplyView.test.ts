import type { Container, Graphics, Text } from 'pixi.js';
import { CanvasTextMetrics } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { interpolateFrame } from '../net/interpolate.ts';
import { createLayers } from './layers.ts';
import { YOU } from './style.ts';
import { SupplyView } from './supplyView.ts';
import { testSprites } from './testSprites.ts';

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

/** The parts of the view: the plates and the texts of the layer. */
function parts(layers: ReturnType<typeof createLayers>) {
  const [root] = layers.layer.supply.children as Container[];
  const plates = root?.children[0] as Graphics;
  const texts = root?.children.find((c) => c.label === 'supply-texts') as Container;
  return { plates, texts };
}

describe('SupplyView: the cities', () => {
  beforeEach(() => {
    vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation(
      (text: string) => ({ width: text.length * 7, height: 14 }) as CanvasTextMetrics,
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('draws no gauge: the warehouse is the lozenges of the city (#858)', () => {
    const layers = createLayers();
    const view = new SupplyView(map, layers, 0, () => 14, testSprites());
    view.update(interpolateFrame(snapshot, null, 100), true);
    const { plates, texts } = parts(layers);
    expect(fills(plates).filter((s) => s.type === 'rectangle' && s.color === YOU)).toEqual([]);
    const shown = texts.children.filter((c) => c.visible).map((c) => (c as Text).text);
    expect(shown.some((t) => /^\d+\/\d+$/.test(t))).toBe(false);
    view.destroy();
  });
});
