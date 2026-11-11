import { describe, expect, it } from 'vitest';
import {
  clipBelow,
  dashLoop,
  helmet,
  inside,
  samplePath,
  scanLines,
  type Point,
} from './helmet.ts';

describe('samplePath', () => {
  it('follows lines and curves to their ends', () => {
    const line = samplePath('M0 0 L10 0');
    expect(line.points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    const curve = samplePath('M0 0 C0 10 10 10 10 0 Z', 4);
    expect(curve.closed).toBe(true);
    expect(curve.points.at(-1)).toEqual({ x: 10, y: 0 });
    expect(curve.points).toHaveLength(5);
  });
});

describe('helmet', () => {
  it('is centred on its drawing and scales with the width', () => {
    for (const kind of ['own', 'enemy'] as const) {
      const h = helmet(kind, 40);
      const { x, y, width, height } = h.bounds;
      expect(x + width / 2).toBeCloseTo(0, 6);
      expect(y + height / 2).toBeCloseTo(0, 6);
      expect(width).toBeGreaterThan(30);
      expect(width).toBeLessThan(40);
      // The strap hangs below the dome: the drawing reaches lower than the dome.
      expect(y + height).toBeGreaterThan(h.domeBottom);
      expect(inside(h.middle, h.dome)).toBe(true);
      expect(helmet(kind, 80).bounds.width).toBeCloseTo(2 * width, 6);
    }
  });

  it('tells the two sides apart by the outline, not only the colour', () => {
    expect(helmet('own', 40).band).not.toBeNull();
    expect(helmet('enemy', 40).band).toBeNull();
    expect(helmet('own', 40).dome).not.toEqual(helmet('enemy', 40).dome);
  });
});

describe('clipBelow', () => {
  it('keeps the part under the line', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const part = clipBelow(square, 4);
    expect(Math.min(...part.map((p) => p.y))).toBe(4);
    expect(Math.max(...part.map((p) => p.y))).toBe(10);
    expect(clipBelow(square, 11)).toEqual([]);
  });
});

describe('dashLoop and scanLines', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  it('dashes run on across the corners', () => {
    const dashes = dashLoop(square, 3, 2);
    // 40 units of outline, a period of 5: 8 dashes.
    expect(dashes).toHaveLength(8);
    const length = (piece: Point[]): number =>
      piece.slice(1).reduce((sum, p, i) => {
        const q = piece[i] ?? p;
        return sum + Math.hypot(p.x - q.x, p.y - q.y);
      }, 0);
    for (const dash of dashes) expect(length(dash)).toBeCloseTo(3, 6);
  });

  it('hatches the inside only', () => {
    const lines = scanLines(square, 3);
    expect(lines).toHaveLength(3);
    for (const [a, b] of lines) {
      expect(a.x).toBeCloseTo(0, 6);
      expect(b.x).toBeCloseTo(10, 6);
    }
  });
});
