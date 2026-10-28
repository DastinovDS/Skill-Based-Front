import { describe, expect, it } from 'vitest';
import { circleBox, darken, shadeEnds, shadowBox } from './shading.ts';
import { SHADE, SHADOW, YOU } from './style.ts';

const channels = (c: number): [number, number, number] => [
  (c >> 16) & 0xff,
  (c >> 8) & 0xff,
  c & 0xff,
];

describe('shading (BL1-1 "Restrained", ui-style 26.3)', () => {
  it('darkens a colour toward black by a share', () => {
    expect(darken(0xffffff, 0)).toBe(0xffffff);
    expect(darken(0xffffff, 1)).toBe(0x000000);
    expect(channels(darken(0x808080, 0.5))).toEqual([64, 64, 64]);
  });

  it('gives the fill gradient of a colour: +16% to white at the top, -14% to black at the bottom', () => {
    const { top, bottom } = shadeEnds(YOU);
    const [r, g, b] = channels(YOU);
    expect(channels(top)).toEqual([
      Math.round(r + (255 - r) * SHADE.light),
      Math.round(g + (255 - g) * SHADE.light),
      Math.round(b + (255 - b) * SHADE.light),
    ]);
    expect(channels(bottom)).toEqual([
      Math.round(r * (1 - SHADE.dark)),
      Math.round(g * (1 - SHADE.dark)),
      Math.round(b * (1 - SHADE.dark)),
    ]);
    // The top is lighter than the colour and the bottom darker: a gradient from top to bottom.
    expect(top).toBeGreaterThan(YOU);
    expect(bottom).toBeLessThan(YOU);
  });

  it('keeps room around a shape for the shadow, which falls down by `SHADOW.dy`', () => {
    const box = shadowBox({ x: -10, y: -10, width: 20, height: 20 }, 4);
    expect(box).toEqual({ x: -14, y: -14, width: 28, height: 28 + SHADOW.dy });
    expect(circleBox(5)).toEqual({ x: -5, y: -5, width: 10, height: 10 });
  });

  it('stacks the shadow layers from the widest and faintest to the core, as 1.5 px down, about half opaque', () => {
    const grows = SHADOW.layers.map((layer) => layer.grow);
    expect(grows).toEqual([...grows].sort((a, b) => b - a));
    expect(SHADOW.dy).toBe(1.5);
    // The core of the shadow: the layers on top of each other.
    const core = 1 - SHADOW.layers.reduce((rest, layer) => rest * (1 - layer.alpha), 1);
    expect(core).toBeGreaterThan(0.45);
    expect(core).toBeLessThan(0.55);
  });
});
