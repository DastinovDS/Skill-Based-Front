import { describe, expect, it } from 'vitest';
import { UNDO_CUE } from './style.ts';
import { circlePoints, cutPolyline, insetEnd, undoGlyph, undoLook } from './undoLayout.ts';

describe('undoLook', () => {
  it('starts whole, is rolled back by rollbackMs, and ends', () => {
    expect(undoLook(0, false)).toEqual({ arrow: 1, ring: UNDO_CUE.ringFrom, alpha: 1 });
    expect(undoLook(UNDO_CUE.rollbackMs, false)).toEqual({ arrow: 0, ring: 1, alpha: 1 });
    expect(undoLook(UNDO_CUE.ms, false)).toBeNull();
    expect(undoLook(-1, false)).toBeNull();
  });

  it('fades over its last part', () => {
    expect(undoLook(UNDO_CUE.ms * UNDO_CUE.fadeFrom, false)?.alpha).toBe(1);
    expect(undoLook(UNDO_CUE.ms * 0.8, false)?.alpha).toBeCloseTo(0.5);
  });

  it('runs nothing with less motion, it only fades', () => {
    expect(undoLook(100, true)).toEqual({ arrow: 1, ring: 1, alpha: 1 });
    const late = undoLook(UNDO_CUE.ms * 0.8, true);
    expect(late?.arrow).toBe(1);
    expect(late?.alpha).toBeCloseTo(0.5);
  });
});

describe('cutPolyline', () => {
  const line = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];

  it('keeps the first share of the length, across the corners', () => {
    expect(cutPolyline(line, 0.25)).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ]);
    expect(cutPolyline(line, 0.75)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
    ]);
    expect(cutPolyline(line, 1)).toEqual(line);
  });

  it('leaves nothing at 0', () => {
    expect(cutPolyline(line, 0)).toEqual([]);
  });
});

describe('insetEnd', () => {
  it('pulls the end back along the last piece, never past its start', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    expect(insetEnd(line, 4)).toEqual([
      { x: 0, y: 0 },
      { x: 6, y: 0 },
    ]);
    expect(insetEnd(line, 40)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ]);
  });
});

describe('the shapes of the cue', () => {
  it('a circle lies at its radius', () => {
    for (const p of circlePoints({ x: 3, y: 4 }, 10)) {
      expect(Math.hypot(p.x - 3, p.y - 4)).toBeCloseTo(10);
    }
  });

  it('the head of the round arrow leaves the end of the arc along its way', () => {
    const { arc, head } = undoGlyph({ x: 0, y: 0 }, 10);
    const end = arc.at(-1);
    const before = arc.at(-2);
    if (end === undefined || before === undefined) throw new Error('no arc');
    const way = { x: end.x - before.x, y: end.y - before.y };
    const tip = { x: head[0].x - end.x, y: head[0].y - end.y };
    expect(way.x * tip.x + way.y * tip.y).toBeGreaterThan(0);
  });
});
