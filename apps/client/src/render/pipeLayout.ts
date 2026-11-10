/**
 * The hatching of a pocket on the «Supply» layer (DEC-43). Pure functions, no PixiJS: `SupplyView`
 * draws their results and Vitest checks them directly.
 */
import type { Point } from './camera.ts';

/**
 * Parallel chords of a circle at 45 degrees, `period` apart: the hatching of a pocket (DEC-43).
 * Each chord is `[start, end]`, both on the circle, from the lower left to the upper right.
 */
export function circleHatch(centre: Point, radius: number, period: number): [Point, Point][] {
  const chords: [Point, Point][] = [];
  if (radius <= 0 || period <= 0) return chords;
  const step = period * Math.SQRT2;
  const count = Math.floor(radius / step);
  for (let i = -count; i <= count; i++) {
    // The chord lies at distance `d` from the centre along the normal (1, 1) / sqrt 2.
    const d = i * step;
    const half = Math.sqrt(Math.max(0, radius * radius - d * d));
    const nx = Math.SQRT1_2;
    const ny = Math.SQRT1_2;
    const mx = centre.x + nx * d;
    const my = centre.y + ny * d;
    // The direction of the chord is (1, -1) / sqrt 2.
    chords.push([
      { x: mx - nx * half, y: my + ny * half },
      { x: mx + nx * half, y: my - ny * half },
    ]);
  }
  return chords;
}
