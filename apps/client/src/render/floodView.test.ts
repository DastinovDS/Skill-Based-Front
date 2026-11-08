import { Container, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { radialReach } from './captureLayout.ts';
import { FloodView, outlineGeometry, premultiplied } from './floodView.ts';
import { floodLook } from './captureLayout.ts';

const square = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];
const centre = { x: 50, y: 50 };

describe('FloodView (#819)', () => {
  it('premultiplies a tint, and nobody is transparent', () => {
    expect([...premultiplied(0xff0000, 0.2)].map((v) => +v.toFixed(3))).toEqual([0.2, 0, 0, 0.2]);
    expect([...premultiplied(null, 0.2)]).toEqual([0, 0, 0, 0]);
  });

  it('triangulates the outlines into one geometry', () => {
    const geometry = outlineGeometry([square, square.map((p) => ({ x: p.x + 200, y: p.y }))]);
    expect(geometry.getAttribute('aPosition').buffer.data).toHaveLength(16);
    expect(geometry.indexBuffer.data).toHaveLength(12);
    geometry.destroy();
  });

  it('draws the fill, the glow and the rim of a flood and frees them', () => {
    const layers = { fill: new Container(), glow: new Container(), rim: new Container() };
    const view = new FloodView(layers, { width: 400, height: 300 });
    const spec = {
      centre,
      cell: square,
      glowCells: [square],
      reach: radialReach(square, centre),
      from: premultiplied(0xff0000, 0.2),
      to: premultiplied(0x0000ff, 0.2),
      color: 0x0000ff,
    };
    view.add(3, spec);
    // Without the textures of the glow there is no glow mesh: the glow switches at once.
    expect([layers.fill.children.length, layers.glow.children.length]).toEqual([1, 0]);
    view.setGlow({ before: Texture.WHITE, after: Texture.WHITE });
    expect(layers.glow.children).toHaveLength(1);
    expect(layers.rim.children).toHaveLength(1);
    view.update(3, floodLook(400, false, false));
    expect(view.nodes).toEqual([3]);
    // A flood of the same node replaces the old one.
    view.add(3, spec);
    expect(layers.fill.children).toHaveLength(1);
    view.remove(3);
    expect([layers.fill, layers.glow, layers.rim].map((layer) => layer.children.length)).toEqual([
      0, 0, 0,
    ]);
    view.destroy();
  });
});
