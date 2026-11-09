import { Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import {
  barbHead,
  burinMarks,
  drawCasedArrow,
  hatchAcross,
  hatchPitch,
  offsetPath,
  pathLength,
  pointAlong,
  slicePath,
  trimPath,
} from './casedArrow.ts';
import { CASED, CASING, INK, YOU } from './style.ts';

const L = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 50 },
];

describe('casedArrow geometry', () => {
  it('measures, walks and slices a polyline across its corners', () => {
    expect(pathLength(L)).toBe(150);
    expect(pointAlong(L, 120)).toEqual({ at: { x: 100, y: 20 }, dir: { x: 0, y: 1 } });
    expect(slicePath(L, 50, 120)).toEqual([
      { x: 50, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 20 },
    ]);
    expect(slicePath(L, 20, 10)).toEqual([]);
    expect(trimPath(L, 10, 10)).toEqual([
      { x: 10, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 40 },
    ]);
  });

  it('offsets a polyline to one side, mitred at a corner', () => {
    const off = offsetPath(L, 2);
    // Walking right along y = 0, the side (dir.y, -dir.x) is up (y - 2).
    expect(off[0]).toEqual({ x: 0, y: -2 });
    expect(off[1]?.x).toBeCloseTo(102);
    expect(off[1]?.y).toBeCloseTo(-2);
    expect(off[2]?.x).toBeCloseTo(102);
  });

  it('makes a barbed head with its tip at the end, pointing along the way', () => {
    const [tip, left, notch, right] = barbHead({ x: 10, y: 0 }, { x: 1, y: 0 }, 12, 0.5);
    expect(tip).toEqual({ x: 10, y: 0 });
    expect(left).toEqual({ x: -2, y: 6 });
    expect(notch?.x).toBeCloseTo(10 - 12 * 0.72);
    expect(right).toEqual({ x: -2, y: -6 });
  });

  it('runs one burin point per step towards the head, faded near the ends', () => {
    const marks = burinMarks(190, 0);
    expect(marks.map((m) => m.d)).toEqual([46, 92, 138, 184]);
    expect(marks.at(-1)?.fade).toBeCloseTo((190 - 184) / CASED.burin.fade);
    const later = burinMarks(200, 1);
    expect(later[0]?.d).toBeCloseTo((CASED.burin.speed * 1) % CASED.burin.step);
  });

  it('keeps the hatch of a hollow body at least a few css px apart when zoomed out', () => {
    expect(hatchPitch(2.6, 2)).toBe(2.6);
    expect(hatchPitch(2.6, 0.5) * 0.5).toBeGreaterThanOrEqual(CASED.hatch.minPx);
    const ticks = hatchAcross(L.slice(0, 2), 10, 2);
    expect(ticks).toHaveLength(10);
    expect(ticks[0]).toEqual([
      { x: 5, y: 2 },
      { x: 5, y: -2 },
    ]);
  });
});

describe('drawCasedArrow', () => {
  it('lays a paper casing, the dark casing, the own core and two ink hairlines, then the head', () => {
    const g = new Graphics();
    drawCasedArrow(g, L, { color: YOU, seconds: 0, hair: 0.5, zoom: 1 });
    const strokes = g.context.instructions.filter((i) => i.action === 'stroke');
    const colors = strokes.map((i) => (i.data.style as { color: number }).color);
    expect(colors.slice(0, 5)).toEqual([INK, CASING, YOU, INK, INK]);
    const fills = g.context.instructions.filter((i) => i.action === 'fill');
    expect(fills.some((i) => (i.data.style as { color: number }).color === YOU)).toBe(true);
    g.destroy();
  });

  it('a ghost is hollow: no core, the hatch across in the own colour', () => {
    const g = new Graphics();
    drawCasedArrow(g, L, { color: YOU, ghost: true, seconds: null, hair: 0.5, zoom: 1 });
    const strokes = g.context.instructions.filter((i) => i.action === 'stroke');
    const widths = strokes.map((i) => (i.data.style as { width: number }).width);
    expect(widths).not.toContain(CASED.half * 2 - CASED.coreInset);
    expect(
      strokes.some(
        (i) =>
          (i.data.style as { color: number; width: number }).color === YOU &&
          (i.data.style as { width: number }).width === CASED.hatch.width,
      ),
    ).toBe(true);
    g.destroy();
  });

  it('keeps every hairline at least one device pixel', () => {
    const g = new Graphics();
    drawCasedArrow(g, L, { color: YOU, seconds: null, hair: 2, zoom: 0.25 });
    const inks = g.context.instructions
      .filter((i) => i.action === 'stroke')
      .map((i) => i.data.style as { color: number; width: number })
      .filter((s) => s.color === INK && s.width < 3);
    expect(inks.every((s) => s.width >= 2)).toBe(true);
    g.destroy();
  });

  it('draws nothing for a stub', () => {
    const g = new Graphics();
    drawCasedArrow(
      g,
      [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
      ],
      { color: YOU, hair: 1, zoom: 1 },
    );
    expect(g.context.instructions).toHaveLength(0);
    g.destroy();
  });
});
