import { Container, Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { BakeSpec } from './bake.ts';
import {
  cityBodySpec,
  cityRingSpec,
  feedRowSpec,
  octagramSpec,
  provinceBodySpec,
  vpBadgeSpec,
} from './bakedShapes.ts';
import { warehouseMarksSpec } from './pieceShapes.ts';
import {
  CASING,
  CITY_ENGRAVED,
  DARK_PLATE,
  ENEMY,
  INK,
  PROVINCE,
  PROVINCE_ENGRAVED,
  RING_ENGRAVED,
  VP_LOZENGE,
  YOU,
} from './style.ts';

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
  spec.draw(into, { gradient: (color) => color, ramp: (top) => top, hair: (width) => width });
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

describe('provinceBodySpec: the Engraved province (DEC-23, #847)', () => {
  it('is a small dot on a dark disc, inside the capacity ring', () => {
    for (const kind of ['you', 'enemy', 'neutral'] as const) {
      const filled = circles(provinceBodySpec(kind), 'fill');
      expect(filled[0]).toBe(PROVINCE_ENGRAVED.plate);
      const stroked = circles(provinceBodySpec(kind), 'stroke');
      expect(Math.max(...stroked, ...filled)).toBeLessThan(PROVINCE.radius + 7);
    }
  });

  it("fills an owner's dot with the owner's colour, nobody's is only a thin ring and a dot", () => {
    expect(circles(provinceBodySpec('you'), 'fill')).toEqual([
      PROVINCE_ENGRAVED.plate,
      PROVINCE_ENGRAVED.dot,
    ]);
    expect(circles(provinceBodySpec('neutral'), 'fill')).toEqual([
      PROVINCE_ENGRAVED.plate,
      PROVINCE_ENGRAVED.neutral.dot,
    ]);
  });

  it('carries the side by an extra ring for the opponent, not only by the hue (grey scale)', () => {
    const rings = (kind: 'you' | 'enemy') => circles(provinceBodySpec(kind), 'stroke');
    expect(rings('you')).toEqual([PROVINCE_ENGRAVED.rim.radius]);
    expect(rings('enemy')).toEqual([PROVINCE_ENGRAVED.rim.radius, PROVINCE_ENGRAVED.enemy.radius]);
  });

  it('is only the dark disc when units stand there (their helmet is the picture)', () => {
    expect(circles(provinceBodySpec('you', true), 'fill')).toEqual([PROVINCE_ENGRAVED.plate]);
    expect(circles(provinceBodySpec('you', true), 'stroke')).toEqual([]);
  });

  it('has a key of its own per side and plate, shared by every province of it', () => {
    const keys = ['you', 'enemy', 'neutral'].map((k) => provinceBodySpec(k as 'you').key);
    expect(new Set(keys).size).toBe(3);
    expect(provinceBodySpec('you').key).not.toBe(provinceBodySpec('you', true).key);
  });
});

describe('cityBodySpec: the Engraved city (#847)', () => {
  it("fills an empty city with the owner's colour, an occupied one with the dark plate", () => {
    const fills = (spec: BakeSpec): number[] =>
      (
        drawn(spec).filter((i) => i.action === 'fill') as unknown as {
          data: { style?: { color: number } };
        }[]
      ).map((i) => i.data.style?.color ?? -1);
    expect(fills(cityBodySpec('you', 14, false))).toContain(YOU);
    expect(fills(cityBodySpec('enemy', 14, false))).toContain(ENEMY);
    expect(fills(cityBodySpec('you', 14, false, true))).toContain(DARK_PLATE);
    expect(fills(cityBodySpec('you', 14, false, true))).not.toContain(YOU);
  });

  it("gives the opponent's city two ink rings inside it: the side reads without the hue", () => {
    const own = circles(cityBodySpec('you', 14, false), 'stroke');
    const enemy = circles(cityBodySpec('enemy', 14, false), 'stroke');
    expect(enemy.length - own.length).toBe(2);
    for (const inset of CITY_ENGRAVED.enemy.insets) expect(enemy).toContain(14 - inset);
  });

  it('hatches a neutral city instead of filling it', () => {
    const fills = drawn(cityBodySpec('neutral', 14, false)).filter((i) => i.action === 'fill');
    // Only the dark cut under it is filled; the hatch is strokes.
    expect(fills).toHaveLength(1);
  });

  it('keys the plate of units standing there apart from the empty city', () => {
    expect(cityBodySpec('you', 14, true).key).not.toBe(cityBodySpec('you', 14, true, true).key);
  });
});

// #928, item 9 (owner 2026-11-10): the empty places of the capacity ring blended with the dark city
// plate and the ground; the VP number was too small.
describe('cityRingSpec: an empty place reads on the dark plate (#928)', () => {
  interface Stroke {
    readonly color: number;
    readonly alpha: number;
    readonly width: number;
  }
  const strokes = (spec: BakeSpec): Stroke[] =>
    (drawn(spec) as unknown as { action: string; data: { style: Stroke } }[])
      .filter((i) => i.action === 'stroke')
      .map((i) => i.data.style);
  const R = RING_ENGRAVED.room;
  const hairlines = (spec: BakeSpec): number =>
    strokes(spec).filter((s) => s.color === INK && s.width === R.width).length;

  it('is a hollow cell: a faint ink wash between two hairlines, closed at its ends', () => {
    const ring = strokes(cityRingSpec(17, 4, 1));
    expect(ring).toContainEqual(
      expect.objectContaining({ color: INK, alpha: R.wash, width: 2 * R.offset }),
    );
    // Two hairlines along the place and one stroke of the ticks that close it.
    expect(hairlines(cityRingSpec(17, 4, 1))).toBe(3);
    // A full ring has no room: no ticks.
    expect(hairlines(cityRingSpec(17, 4, 4))).toBe(2);
  });

  it('keeps the wash faint, so a place with a unit (solid ink) still reads apart', () => {
    expect(R.wash).toBeGreaterThan(0);
    expect(R.wash).toBeLessThanOrEqual(0.4);
    expect(2 * R.offset).toBeLessThan(RING_ENGRAVED.filled + 0.01);
  });
});

describe('vpBadgeSpec: the gilt VP lozenge (#847, #928)', () => {
  it('is large enough to read its number at the normal zoom', () => {
    expect(VP_LOZENGE.font).toBeGreaterThanOrEqual(14);
    expect(VP_LOZENGE.side).toBeGreaterThanOrEqual(18);
    expect(vpBadgeSpec().box.width).toBeGreaterThan(VP_LOZENGE.side * Math.SQRT2);
  });
});

describe('warehouseMarksSpec: the warehouse as lozenges (57u)', () => {
  /** The lozenges drawn, as the polygons filled with the side's colour (in stock) or the plate (room). */
  function fills(spec: BakeSpec, color: number): number {
    return (
      drawn(spec).filter((i) => i.action === 'fill') as unknown as {
        data: { style?: { color: number } };
      }[]
    ).filter((i) => i.data.style?.color === color).length;
  }

  it('fills a lozenge per charge and leaves the room hollow, no bar and no number', () => {
    const spec = warehouseMarksSpec(6, 4, YOU);
    expect(fills(spec, YOU)).toBe(4);
    expect(fills(spec, DARK_PLATE)).toBe(2);
    expect(fills(spec, CASING)).toBe(6);
  });

  it('has a key per look, so a texture is shared only by warehouses that look the same', () => {
    const key = (cap: number, stock: number) => warehouseMarksSpec(cap, stock, YOU).key;
    expect(key(4, 1)).not.toBe(key(5, 1));
    expect(key(4, 1)).not.toBe(key(4, 2));
    expect(key(4, 1)).toBe(key(4, 1));
    expect(warehouseMarksSpec(4, 1, YOU).key).not.toBe(warehouseMarksSpec(4, 1, ENEMY).key);
  });
});

describe('the baked shapes of the bonus shot and the kill feed (#812)', () => {
  it('has a key per look, one for each part, side and colour of an octagram', () => {
    const keys = [
      octagramSpec('outer', false, YOU).key,
      octagramSpec('inner', false, YOU).key,
      octagramSpec('outer', true, ENEMY).key,
      octagramSpec('inner', true, ENEMY).key,
    ];
    expect(new Set(keys).size).toBe(4);
    expect(octagramSpec('inner', false, YOU).key).toBe(keys[1]);
  });

  it('boxes the larger square of an octagram around its origin, turned or not', () => {
    const outer = octagramSpec('outer', false, YOU).box;
    const inner = octagramSpec('inner', false, YOU).box;
    expect(outer.width).toBeGreaterThan(inner.width);
    expect(outer.x).toBeCloseTo(-outer.width / 2);
  });

  it('bakes two looks of a feed row, the winner outlined thicker', () => {
    expect(feedRowSpec(true).key).not.toBe(feedRowSpec(false).key);
    expect(feedRowSpec(true).box.width).toBeGreaterThan(100);
  });
});
