import { describe, expect, it } from 'vitest';
import {
  BORDER_FIT,
  cityLight,
  fitAt,
  floodLook,
  glowRegions,
  neighboursOf,
  radialReach,
  revealAt,
  roadParts,
} from './captureLayout.ts';
import type { CellEdge } from './regionLayout.ts';
import { CAPTURE } from './style.ts';

/** A square of half side 50 round the origin. */
const square = [
  { x: -50, y: -50 },
  { x: 50, y: -50 },
  { x: 50, y: 50 },
  { x: -50, y: 50 },
];
const centre = { x: 0, y: 0 };

describe('the field of an area (#819, Fitted)', () => {
  const reach = radialReach(square, centre);

  it('is 0 at the city and 1 on the border, the outline scaled from the city', () => {
    expect(fitAt(reach, centre, centre)).toBe(0);
    // Along the axes the border is 50 away; the smoothing round the city keeps it close.
    expect(fitAt(reach, centre, { x: 50, y: 0 })).toBeCloseTo(1, 1);
    expect(fitAt(reach, centre, { x: 0, y: -25 })).toBeCloseTo(0.5, 1);
    // A corner lands on the border together with the sides (not later, as a circle would).
    expect(fitAt(reach, centre, { x: 50, y: 50 })).toBeLessThan(1.05);
    expect(fitAt(reach, centre, { x: 50, y: 50 })).toBeGreaterThan(0.9);
  });

  it('takes the farthest crossing of a ray in an area that is not star-shaped round its city', () => {
    // A U: the arms reach up to y = -50, the inlet between them goes down to y = 10.
    const u = [
      { x: -60, y: -50 },
      { x: -20, y: -50 },
      { x: -20, y: 10 },
      { x: 20, y: 10 },
      { x: 20, y: -50 },
      { x: 60, y: -50 },
      { x: 60, y: 40 },
      { x: -60, y: 40 },
    ];
    const at = { x: 0, y: 25 };
    const table = radialReach(u, at);
    // Every point of the area is reached: the field never passes 1 inside it by much.
    for (const p of [
      { x: -40, y: -45 },
      { x: 40, y: -45 },
      { x: 0, y: 35 },
      { x: -55, y: 35 },
    ]) {
      expect(fitAt(table, at, p)).toBeLessThan(1.15);
    }
  });
});

describe('the timeline of a flood', () => {
  it('starts at the city and reaches the whole border in 1.0 s, ease-out, then settles', () => {
    expect(floodLook(0, false, false).pos).toBeLessThan(0);
    const early = floodLook(250, false, false).pos;
    const mid = floodLook(500, false, false).pos;
    const late = floodLook(750, false, false).pos;
    // Ease-out: the first quarter covers more ground than the last.
    expect(early).toBeGreaterThan(late - mid);
    // At 1.0 s the front with its soft edge has passed the border everywhere.
    const end = floodLook(CAPTURE.ms, false, false);
    expect(revealAt(end, 1)).toBe(1);
    expect(end.done).toBe(false);
    expect(floodLook(CAPTURE.clean.to, false, false).done).toBe(true);
  });

  it('shows the new look behind the front and the old one ahead of it', () => {
    const look = floodLook(400, false, false);
    expect(revealAt(look, 0)).toBe(1);
    expect(revealAt(look, look.pos + 0.01)).toBe(0);
    const half = revealAt(look, look.pos - look.feather / 2);
    expect(half).toBeGreaterThan(0.3);
    expect(half).toBeLessThan(0.7);
  });

  it('lets the border lines join as the front reaches them, a neighbour’s a moment later', () => {
    const at = (ms: number) => floodLook(ms, false, false);
    expect(revealAt(at(500), BORDER_FIT.inside)).toBe(0);
    expect(revealAt(at(800), BORDER_FIT.inside)).toBeGreaterThan(
      revealAt(at(800), BORDER_FIT.outside),
    );
    expect(revealAt(at(1100), BORDER_FIT.outside)).toBeGreaterThan(0.95);
    expect(revealAt(at(CAPTURE.clean.to), BORDER_FIT.outside)).toBe(1);
  });

  it('runs the roads out from the city and has them all new at the end', () => {
    expect(floodLook(0, false, false).road).toBe(0);
    expect(floodLook(300, false, false).road).toBeGreaterThan(0.3);
    expect(floodLook(CAPTURE.ms, false, false).road).toBe(1);
  });

  it('fades the rim in and out, at half strength when the enemy captures', () => {
    expect(floodLook(0, false, false).rim).toBe(0);
    expect(floodLook(400, false, false).rim).toBe(1);
    expect(floodLook(400, true, false).rim).toBe(CAPTURE.calm);
    expect(floodLook(CAPTURE.ms, false, false).rim).toBe(0);
  });

  it('is a short cross-fade without travel or light with "less motion"', () => {
    const look = floodLook(100, false, true);
    expect(look.pos).toBeLessThan(0);
    expect(look.rim).toBe(0);
    expect(look.road).toBe(1);
    expect(look.clean).toBeCloseTo(0.5);
    expect(floodLook(CAPTURE.reducedMs, false, true).done).toBe(true);
    expect(cityLight(50, false, true)).toBeNull();
  });
});

describe('the light at the city', () => {
  it('flashes once at the start and sends a ring of the owner out', () => {
    const start = cityLight(0, false, false);
    expect(start?.flash).toBe(CAPTURE.flash.alpha);
    expect(cityLight(CAPTURE.flash.ms, false, false)?.flash).toBe(0);
    const later = cityLight(300, false, false);
    expect(later?.ringRadius).toBeGreaterThan(start?.ringRadius ?? 0);
    expect(cityLight(CAPTURE.ring.ms, false, false)).toBeNull();
  });

  it('has no flash and the ring at half when the enemy captures', () => {
    expect(cityLight(0, true, false)?.flash).toBe(0);
    expect(cityLight(0, true, false)?.ring).toBe(CAPTURE.ring.alpha * CAPTURE.calm);
  });
});

describe('the areas of the glow of floods', () => {
  const edges: CellEdge[] = [
    { cell: 0, neighbour: 1, a: { x: 0, y: 0 }, b: { x: 0, y: 1 } },
    { cell: 1, neighbour: 2, a: { x: 1, y: 0 }, b: { x: 1, y: 1 } },
    { cell: 2, neighbour: 3, a: { x: 2, y: 0 }, b: { x: 2, y: 1 } },
    { cell: 1, neighbour: null, a: { x: 1, y: 0 }, b: { x: 1, y: 1 } },
  ];

  it('lists the neighbours of every area once', () => {
    expect(neighboursOf(edges, 4)).toEqual([[1], [0, 2], [1, 3], [2]]);
  });

  it('gives each flood its area and the neighbours no other flood has: nothing twice', () => {
    const near = neighboursOf(edges, 4);
    expect(glowRegions([1], near)).toEqual([[1, 0, 2]]);
    // Two floods next to each other: each keeps its own area, a shared neighbour goes to the first.
    expect(glowRegions([0, 2], near)).toEqual([
      [0, 1],
      [2, 3],
    ]);
    expect(glowRegions([1, 2], near)).toEqual([
      [1, 0],
      [2, 3],
    ]);
  });
});

describe('a road while a capture runs out along it', () => {
  const before = [{ from: 0, to: 1, style: 'buffer' }] as const;
  const after = [{ from: 0, to: 1, style: 'own0' }] as const;

  it('has the new look from the captured end and the old one beyond the cut', () => {
    expect(roadParts(before, after, 0.3, true)).toEqual([
      { from: 0, to: 0.3, style: 'own0' },
      { from: 0.3, to: 1, style: 'buffer' },
    ]);
    const fromB = roadParts(before, after, 0.3, false);
    expect(fromB[0]).toEqual({ from: 0.7, to: 1, style: 'own0' });
    expect(fromB[1]?.style).toBe('buffer');
    expect(fromB[1]?.to).toBeCloseTo(0.7);
  });

  it('keeps the halves of a road in fog and drops the empty parts', () => {
    const fogged = [
      { from: 0, to: 0.5, style: 'buffer' },
      { from: 0.5, to: 1, style: 'fog' },
    ] as const;
    expect(roadParts(fogged, after, 0.6, true)).toEqual([
      { from: 0, to: 0.6, style: 'own0' },
      { from: 0.6, to: 1, style: 'fog' },
    ]);
    expect(roadParts(fogged, after, 1, true)).toEqual([{ from: 0, to: 1, style: 'own0' }]);
    expect(roadParts(fogged, after, 0, true)).toEqual(fogged);
  });
});
