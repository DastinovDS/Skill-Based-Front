import { Container, Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { BakeSpec } from './bake.ts';
import { provinceBodySpec, warehouseBarSpec } from './bakedShapes.ts';
import { BAR_SEGMENT, PROVINCE, YOU } from './style.ts';

// The look of the shapes of C1 (#348, ui-style 9.4), read from what they draw. Nothing here needs
// WebGL: `draw` only puts vector shapes into a scratch container.

interface Primitive {
  readonly type: string;
  readonly radius?: number;
}
interface Instruction {
  readonly action: string;
  readonly data: { path?: { shapePath: { shapePrimitives: { shape: Primitive }[] } } };
}

/**
 * What the spec drew itself: the instructions of its last Graphics (the shadow layers come first
 * and are no part of the look of the shape).
 */
function drawn(spec: BakeSpec): Instruction[] {
  const into = new Container();
  spec.draw(into, { gradient: (color) => color });
  const shape = into.children
    .filter((child): child is Graphics => child instanceof Graphics)
    .at(-1);
  return (shape?.context.instructions ?? []) as unknown as Instruction[];
}

/** The radii of the circles stroked or filled with `action`. */
function circles(spec: BakeSpec, action: 'stroke' | 'fill'): number[] {
  return drawn(spec)
    .filter((i) => i.action === action)
    .flatMap((i) => i.data.path?.shapePath.shapePrimitives ?? [])
    .filter((p) => p.shape.type === 'circle')
    .map((p) => p.shape.radius ?? 0);
}

describe('provinceBodySpec: a hollow ring (C1, DEC-23)', () => {
  it('is told from a city by shape: no gradient disc of the city radius, only rings and a plate', () => {
    for (const kind of ['you', 'enemy', 'neutral'] as const) {
      const radii = circles(provinceBodySpec(kind), 'stroke');
      // The biggest circle is the halo, outside the ring; nothing is bigger than the province.
      expect(Math.max(...radii)).toBeLessThan(PROVINCE.radius + 6);
      // The fill is the dark plate inside the ring: one circle of the province's radius.
      expect(circles(provinceBodySpec(kind), 'fill')).toEqual([PROVINCE.radius]);
    }
  });

  it('carries the side by the number of rings, not only by the hue (grey scale)', () => {
    const rings = (kind: 'you' | 'enemy' | 'neutral') =>
      circles(provinceBodySpec(kind), 'stroke').length;
    // neutral: the halo and one thin ring; own: plus a light ring outside; the opponent's: plus one inside.
    expect(rings('neutral')).toBe(2);
    expect(rings('you')).toBe(3);
    expect(rings('enemy')).toBe(4);
  });

  it('has a key of its own per side, shared by every province of it', () => {
    const keys = ['you', 'enemy', 'neutral'].map((k) => provinceBodySpec(k as 'you').key);
    expect(new Set(keys).size).toBe(3);
    expect(provinceBodySpec('you').key).toBe(provinceBodySpec('you').key);
  });
});

describe('warehouseBarSpec: the places of a warehouse (C1)', () => {
  /** Rectangles filled (charges) and stroked (frames) in the bar. */
  function rects(action: 'stroke' | 'fill'): number {
    return drawn(warehouseBarSpec(4, 1, YOU, 2))
      .filter((i) => i.action === action)
      .flatMap((i) => i.data.path?.shapePath.shapePrimitives ?? [])
      .filter((p) => p.shape.type === 'rectangle').length;
  }

  it('fills a place per charge, frames the room and dashes the levels not built yet', () => {
    // 4 places of capacity, 1 charge, 2 places of levels to build: 1 filled rectangle (and the
    // rounded base), 3 framed rectangles; the 2 dashed places are lines, not rectangles.
    expect(rects('fill')).toBe(1);
    expect(rects('stroke')).toBe(3);
  });

  it('has a key per state, so a texture is shared only by bars that look the same', () => {
    const key = (cap: number, stock: number, locked: number) =>
      warehouseBarSpec(cap, stock, YOU, locked).key;
    expect(key(4, 1, 2)).not.toBe(key(4, 1, 0));
    expect(key(4, 1, 2)).not.toBe(key(4, 2, 2));
    expect(key(4, 1, 2)).toBe(key(4, 1, 2));
  });

  it('keeps every place in the 5 x 4 cell of a charge', () => {
    const bar = warehouseBarSpec(3, 0, YOU, 1);
    // The sprite is as wide as the places plus the base and the room for the shadow.
    expect(bar.box.width).toBeGreaterThan(4 * BAR_SEGMENT.pitch);
  });
});
