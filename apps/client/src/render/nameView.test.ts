import { CanvasTextMetrics, Container, Text } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { createLayers } from './layers.ts';
import { CAPTION } from './nameLayout.ts';
import { NameView } from './nameView.ts';

const map = DEFAULT_MAP;

describe('NameView', () => {
  beforeEach(() => {
    vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation(
      (text: string) => ({ width: text.length * 7, height: 14 }) as CanvasTextMetrics,
    );
  });
  afterEach(() => vi.restoreAllMocks());

  function build() {
    const layers = createLayers();
    const view = new NameView(map, layers, () => 14, 1);
    const holder = layers.layer.nodes.children.find((c) => c.label === 'node-names') as Container;
    const boxes = holder.children as Container[];
    return { layers, view, holder, boxes };
  }

  const kindOf = (id: number) => (map.nodes[id]?.kind === 'province' ? 'province' : 'city');

  it('has one pooled caption per node, with the name from the map file', () => {
    const { view, boxes } = build();
    expect(boxes).toHaveLength(map.nodes.length);
    boxes.forEach((box, id) => {
      expect((box.children[0] as Text).text).toBe(map.nodes[id]?.name);
    });
    view.destroy();
  });

  it('shows each kind from its zoom threshold and keeps the size on screen', () => {
    const { view, boxes } = build();
    view.setCameraScale(CAPTION.city.minScale);
    boxes.forEach((box, id) => {
      expect(box.visible, String(id)).toBe(kindOf(id) === 'city');
      if (box.visible) expect(box.scale.x * CAPTION.city.minScale).toBeCloseTo(1);
    });
    view.setCameraScale(CAPTION.province.minScale);
    for (const box of boxes) expect(box.visible).toBe(true);
    view.setCameraScale(CAPTION.city.minScale / 2);
    for (const box of boxes) expect(box.visible).toBe(false);
    view.destroy();
  });

  it('follows the text resolution and releases everything on destroy', () => {
    const { view, boxes, layers } = build();
    const first = boxes[0];
    view.setLabelResolution(2);
    expect((first?.children[0] as Text).resolution).toBe(2);
    view.destroy();
    expect(layers.layer.nodes.children.find((c) => c.label === 'node-names')).toBeUndefined();
    expect(first?.destroyed).toBe(true);
  });
});
