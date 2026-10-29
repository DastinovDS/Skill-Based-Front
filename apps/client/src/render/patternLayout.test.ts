import { describe, expect, it } from 'vitest';
import { DOT_MARGIN, DOT_STEP, FIR_MARGIN, HATCH_STEP, patternMarks } from './patternLayout.ts';

const square = (x: number, y: number, size: number) => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];

describe('patternMarks (#429)', () => {
  it('gives each terrain its own kind of mark, and only that kind', () => {
    const cell = square(0, 0, 120);
    const plains = patternMarks(cell, 'plains');
    const forest = patternMarks(cell, 'forest');
    const mountains = patternMarks(cell, 'mountains');
    expect([plains.dots.length > 0, plains.firs.length, plains.hatches.length]).toEqual([
      true,
      0,
      0,
    ]);
    expect([forest.dots.length, forest.firs.length > 0, forest.hatches.length]).toEqual([
      0,
      true,
      0,
    ]);
    expect([mountains.dots.length, mountains.firs.length, mountains.hatches.length > 0]).toEqual([
      0,
      0,
      true,
    ]);
  });

  it('keeps every dot and fir inside its cell, away from the sides', () => {
    const cell = square(10, 20, 100);
    for (const p of patternMarks(cell, 'plains').dots) {
      expect(p.x).toBeGreaterThanOrEqual(10 + DOT_MARGIN);
      expect(p.x).toBeLessThanOrEqual(110 - DOT_MARGIN);
      expect(p.y).toBeGreaterThanOrEqual(20 + DOT_MARGIN);
      expect(p.y).toBeLessThanOrEqual(120 - DOT_MARGIN);
    }
    for (const p of patternMarks(cell, 'forest').firs) {
      expect(p.x).toBeGreaterThanOrEqual(10 + FIR_MARGIN);
      expect(p.y).toBeLessThanOrEqual(120 - FIR_MARGIN);
    }
  });

  it('puts the marks on a grid of the world, the same for a cell on either side of a border', () => {
    const left = patternMarks(square(0, 0, 60), 'plains').dots;
    const right = patternMarks(square(60, 0, 60), 'plains').dots;
    const whole = patternMarks(square(0, 0, 120), 'plains').dots;
    // Every dot of a half is a dot of the whole (a staggered grid, whatever the cell).
    for (const p of [...left, ...right]) {
      expect(whole.some((q) => q.x === p.x && q.y === p.y)).toBe(true);
    }
    for (const p of whole) expect((p.y / DOT_STEP) % 1).toBe(0);
  });

  it('does the same for a ring of either winding', () => {
    const cell = square(0, 0, 80);
    const reversed = [...cell].reverse();
    expect(patternMarks(reversed, 'plains').dots.length).toBe(
      patternMarks(cell, 'plains').dots.length,
    );
  });

  it('cuts the hatching to the cell: every end lies on its boundary', () => {
    const cell = square(0, 0, 100);
    const { hatches } = patternMarks(cell, 'mountains');
    expect(hatches.length).toBeGreaterThan(10);
    for (const [p, q] of hatches) {
      for (const e of [p, q]) {
        expect(e.x).toBeGreaterThanOrEqual(-1e-9);
        expect(e.x).toBeLessThanOrEqual(100 + 1e-9);
        expect(e.y).toBeGreaterThanOrEqual(-1e-9);
        expect(e.y).toBeLessThanOrEqual(100 + 1e-9);
      }
      expect(p.x + p.y).toBeCloseTo(Math.round((p.x + p.y) / HATCH_STEP) * HATCH_STEP, 6);
      expect(q.x + q.y).toBeCloseTo(p.x + p.y, 6);
    }
  });

  it('gives a cell that is not a polygon no marks', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(patternMarks(line, 'plains')).toEqual({ dots: [], firs: [], hatches: [] });
  });
});
