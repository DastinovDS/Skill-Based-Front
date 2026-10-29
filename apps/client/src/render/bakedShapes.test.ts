import { Container, Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { BakeSpec } from './bake.ts';
import { provinceBodySpec, triangleTicksSpec, warehouseBarSpec } from './bakedShapes.ts';
import { BAR_SEGMENT, ENEMY, PLATE_FILL, PROVINCE, YOU } from './style.ts';

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

/** The colour of the first filled circle of the spec, or `null`. */
function fillOf(spec: BakeSpec): { color: number; alpha: number } | null {
  const fill = drawn(spec).find((i) => i.action === 'fill') as unknown as
    { data: { style?: { color: number; alpha: number } } } | undefined;
  return fill?.data.style ?? null;
}

const luma = (c: number): number =>
  0.299 * ((c >> 16) & 0xff) + 0.587 * ((c >> 8) & 0xff) + 0.114 * (c & 0xff);

describe('provinceBodySpec: a pale dot (PB, DEC-23, #431)', () => {
  it('is a small solid dot, smaller than the capacity ring and than a city', () => {
    for (const kind of ['you', 'enemy', 'neutral'] as const) {
      expect(circles(provinceBodySpec(kind), 'fill')).toEqual([PROVINCE.dot]);
      expect(PROVINCE.dot).toBeLessThan(PROVINCE.radius);
      // The biggest circle is the opponent's outer ring or the casing: nothing reaches the ring (16).
      const stroked = circles(provinceBodySpec(kind), 'stroke');
      expect(Math.max(...stroked, 0)).toBeLessThan(PROVINCE.radius + 6);
    }
  });

  it('has no dark centre: the dot is paler than the owner colour and far lighter than the old plate', () => {
    for (const [kind, owner] of [
      ['you', YOU],
      ['enemy', ENEMY],
    ] as const) {
      const fill = fillOf(provinceBodySpec(kind));
      expect(fill).not.toBeNull();
      expect(luma(fill?.color ?? 0)).toBeGreaterThan(luma(owner));
      expect(luma(fill?.color ?? 0)).toBeGreaterThan(luma(PLATE_FILL) + 80);
      expect(fill?.alpha).toBe(1);
    }
  });

  it("shows nobody's province paler and see-through, with a dashed outline of arcs", () => {
    const neutral = provinceBodySpec('neutral');
    const fill = fillOf(neutral);
    expect(fill?.alpha).toBeLessThan(1);
    // The outline is a ring of dashes (arcs of the dot's radius), not a closed circle: only the
    // casing is a stroked circle, and it is bigger than the dot.
    expect(circles(neutral, 'stroke').every((radius) => radius > PROVINCE.dot)).toBe(true);
    expect(drawn(neutral).filter((i) => i.action === 'stroke')).toHaveLength(2);
  });

  it('carries the side by an extra ring for the opponent, not only by the hue (grey scale)', () => {
    const rings = (kind: 'you' | 'enemy') => circles(provinceBodySpec(kind), 'stroke');
    // own: the casing and the outline; the opponent's: plus a light ring outside the dot.
    expect(rings('you')).toHaveLength(2);
    expect(rings('enemy')).toHaveLength(3);
    expect(Math.max(...rings('enemy'))).toBeCloseTo(PROVINCE.dot + PROVINCE.enemy.inset);
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

describe('triangleTicksSpec: the dividers inside a unit triangle (#508)', () => {
  it('has nothing to draw for one unit or a big group', () => {
    expect(triangleTicksSpec(24, 1)).toBeNull();
    expect(triangleTicksSpec(36, 9)).toBeNull();
  });

  it('has a key per side and unit count, so one texture serves every such token', () => {
    expect(triangleTicksSpec(30, 4)?.key).toBe('tri-ticks:30:4');
    expect(triangleTicksSpec(30, 5)?.key).not.toBe(triangleTicksSpec(30, 4)?.key);
    expect(triangleTicksSpec(30, 4)?.key).toBe(triangleTicksSpec(30, 4)?.key);
  });

  it('draws one stroked line per divider, a stroke and no fill', () => {
    const spec = triangleTicksSpec(30, 4);
    if (spec === null) throw new Error('four units have dividers');
    const actions = drawn(spec).map((i) => i.action);
    expect(actions).toContain('stroke');
    expect(actions).not.toContain('fill');
  });
});
