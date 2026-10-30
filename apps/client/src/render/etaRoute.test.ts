import { describe, expect, it } from 'vitest';
import { comet, cometPhase, routeSpans, spanPoint, spanSlice, spansLength } from './etaRoute.ts';

// A route of two roads with a bend in the middle city: (0,0) -> (100,0) -> (100,100), rims 10.
const bend = routeSpans(
  [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ],
  [10, 10, 10],
);

describe('routeSpans: the roads of a route from rim to rim (H10, #627)', () => {
  it('trims every road at the rims of both of its cities, the bend included', () => {
    expect(bend).toHaveLength(2);
    expect(bend[0]?.a).toEqual({ x: 10, y: 0 });
    expect(bend[0]?.b).toEqual({ x: 90, y: 0 });
    expect(bend[1]?.a).toEqual({ x: 100, y: 10 });
    expect(bend[1]?.b).toEqual({ x: 100, y: 90 });
    // The arc runs over the roads only: the city in between takes no length.
    expect(bend[1]?.at).toBe(80);
    expect(spansLength(bend)).toBe(160);
  });

  it('leaves out a road shorter than its two rims', () => {
    const spans = routeSpans(
      [
        { x: 0, y: 0 },
        { x: 15, y: 0 },
      ],
      [10, 10],
    );
    expect(spans).toEqual([]);
    expect(spansLength(spans)).toBe(0);
  });

  it('cuts a stretch across the city into one piece per road', () => {
    const pieces = spanSlice(bend, 70, 90);
    expect(pieces).toHaveLength(2);
    expect(pieces[0]).toEqual([
      { x: 80, y: 0 },
      { x: 90, y: 0 },
    ]);
    expect(pieces[1]).toEqual([
      { x: 100, y: 10 },
      { x: 100, y: 20 },
    ]);
    expect(spanPoint(bend, 120)).toEqual({ x: 100, y: 50 });
    expect(spanPoint(bend, 1e9)).toEqual({ x: 100, y: 90 });
  });
});

describe('comet: the light pulse toward the target (mockup map-overlays.html, 2b, H10)', () => {
  it('runs once every 1.8 s; under less motion it has no phase', () => {
    expect(cometPhase(0, false)).toBe(0);
    expect(cometPhase(900, false)).toBeCloseTo(0.5);
    expect(cometPhase(1800 + 450, false)).toBeCloseTo(0.25);
    expect(cometPhase(900, true)).toBeNull();
  });

  it('a tail of six pieces of 12 behind the head, fainter toward its end', () => {
    // The head at 100 of 160 (20 into the second road): phase 100 / (160 + 72).
    const shape = comet(bend, 100 / 232);
    expect(shape.head?.x).toBeCloseTo(100);
    expect(shape.head?.y).toBeCloseTo(30);
    expect(shape.pieces).toHaveLength(6);
    // Faintest first: 0.85 * 1 / 6 ... 0.85 * 6 / 6.
    expect(shape.pieces.map((p) => p.alpha)).toEqual([1, 2, 3, 4, 5, 6].map((k) => (0.85 * k) / 6));
    // The piece next to the head is the last 12 units before it.
    expect(shape.pieces[5]?.segments).toEqual([
      [
        { x: 100, y: 18 },
        { x: 100, y: 30 },
      ],
    ]);
  });

  it('drains into the target: the head waits there while the tail runs in', () => {
    const shape = comet(bend, (160 + 36) / 232);
    expect(shape.head).toEqual({ x: 100, y: 90 });
    // Three pieces are past the target and gone; the rest end at the target.
    expect(shape.pieces).toHaveLength(3);
  });

  it('has a still frame: the head at 70% of the way', () => {
    const shape = comet(bend, null);
    // 0.7 * 160 = 112: 32 into the second road.
    expect(shape.head?.x).toBeCloseTo(100);
    expect(shape.head?.y).toBeCloseTo(42);
    expect(shape.pieces).toHaveLength(6);
  });

  it('draws nothing on an empty route', () => {
    expect(comet([], 0.5)).toEqual({ pieces: [], head: null });
  });
});
