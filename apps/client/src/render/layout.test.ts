import { describe, expect, it } from 'vitest';
import {
  arrowGeometry,
  buildGeometry,
  countLabel,
  dashSegments,
  edgePoint,
  chargeLevel,
  chargeTicks,
  packetFade,
  triangleCorners,
  triangleHeight,
  triangleSide,
  roadPosition,
  sideways,
  timeLeftLabel,
} from './layout.ts';

const A = { x: 0, y: 0 };
const B = { x: 100, y: 0 };

describe('unit triangles (9.5)', () => {
  it('steps the side by the number of units, 30 when unknown', () => {
    expect([1, 3, 4, 7, 8, 15, 16, 99].map(triangleSide)).toEqual([24, 24, 30, 30, 36, 36, 42, 42]);
    expect(triangleSide(null)).toBe(30);
  });

  it('fills from the tip by charged / units of the height, so the height reads the share', () => {
    expect(chargeLevel(4, 1)).toBe(0.25);
    expect(chargeLevel(4, 2)).toBe(0.5);
    expect(chargeLevel(4, 4)).toBe(1);
    expect(chargeLevel(4, 0)).toBe(0);
    expect(chargeLevel(0, 0)).toBe(0);
    expect(chargeLevel(2, 9)).toBe(1);
    expect(chargeLevel(10, 3)).toBeCloseTo(0.3);
  });

  it('puts a divider between every two units of a small group, none above the cap', () => {
    expect(chargeTicks(4, 8)).toEqual([0.25, 0.5, 0.75]);
    expect(chargeTicks(2, 8)).toEqual([0.5]);
    expect(chargeTicks(1, 8)).toEqual([]);
    expect(chargeTicks(0, 8)).toEqual([]);
    expect(chargeTicks(8, 8)).toHaveLength(7);
    expect(chargeTicks(9, 8)).toEqual([]);
  });

  it('points down: the tip is the lowest corner, the box is centred on the origin', () => {
    const [left, right, tip] = triangleCorners(24);
    expect(left.y).toBeCloseTo(-triangleHeight(24) / 2);
    expect(right.x).toBe(12);
    expect(tip).toEqual({ x: 0, y: triangleHeight(24) / 2 });
    expect(triangleCorners(24, true)[2]).toEqual({ x: 0, y: 0 });
  });

  it('fades a packet into a city icon: 30% and see-through at the centre, whole outside', () => {
    expect(packetFade(40, 17)).toEqual({ scale: 1, alpha: 1 });
    const edge = packetFade(25, 17);
    expect(edge).toEqual({ scale: 1, alpha: 1 });
    const middle = packetFade(12.5, 17);
    expect(middle.scale).toBeGreaterThan(0.3);
    expect(middle.scale).toBeLessThan(1);
    expect(middle.alpha).toBeCloseTo(0.5);
    expect(packetFade(0, 17)).toEqual({ scale: 0.3, alpha: 0 });
  });
});

describe('countLabel', () => {
  it('writes one number: all the units, not the charged share', () => {
    expect(countLabel(12)).toBe('12');
  });
});

describe('position on a road', () => {
  it('moves from the start end by thousandths of the edge', () => {
    expect(edgePoint(A, B, true, 250)).toEqual({ x: 25, y: 0 });
    expect(edgePoint(A, B, false, 250)).toEqual({ x: 75, y: 0 });
  });

  it('clamps progress to the edge', () => {
    expect(edgePoint(A, B, true, -50)).toEqual(A);
    expect(edgePoint(A, B, true, 5000)).toEqual(B);
  });

  it('sends opposite directions along opposite lanes', () => {
    const forward = roadPosition(A, B, true, 500, 10);
    const back = roadPosition(A, B, false, 500, 10);
    // Right of "to the right" is down on screen (y grows down); right of "to the left" is up.
    expect(forward).toEqual({ x: 50, y: 10 });
    expect(back).toEqual({ x: 50, y: -10 });
  });

  it('does not move a point on a zero-length road', () => {
    expect(sideways(A, A, A, 5)).toEqual(A);
  });
});

describe('arrows of intents', () => {
  it('starts and ends short of the cities and ends the shaft where the head starts', () => {
    const arrow = arrowGeometry(A, B, 20, 20, 10, 8);
    expect(arrow?.start).toEqual({ x: 20, y: 0 });
    expect(arrow?.end).toEqual({ x: 70, y: 0 });
    expect(arrow?.head[0]).toEqual({ x: 80, y: 0 });
    // The two back corners are a head width apart, on both sides of the shaft.
    expect(arrow?.head[1]).toEqual({ x: 70, y: 4 });
    expect(arrow?.head[2]).toEqual({ x: 70, y: -4 });
  });

  it('draws nothing between cities too close for an arrow', () => {
    expect(arrowGeometry(A, { x: 40, y: 0 }, 20, 20, 10, 8)).toBeNull();
  });

  it('cuts a line into dashes, the last one shortened', () => {
    const dashes = dashSegments(A, { x: 25, y: 0 }, 10, 5);
    expect(dashes.map(([a, b]) => [a.x, b.x])).toEqual([
      [0, 10],
      [15, 25],
    ]);
    expect(dashSegments(A, A, 10, 5)).toEqual([]);
  });
});

describe('the tape of a road being built (R1, #345)', () => {
  it('lays a band of the width over the whole road, centred on it, and the done part from the start', () => {
    const geometry = buildGeometry(A, B, 12, 10, 5, 0.25);
    expect(geometry?.band).toEqual([
      { x: 0, y: -6 },
      { x: 100, y: -6 },
      { x: 100, y: 6 },
      { x: 0, y: 6 },
    ]);
    expect(geometry?.done?.map((p) => p.x)).toEqual([0, 25, 25, 0]);
    expect(geometry?.mid).toEqual({ x: 50, y: 0 });
  });

  it('draws nothing done for a build that has just begun, and all of it when it is over', () => {
    expect(buildGeometry(A, B, 12, 10, 5, 0)?.done).toBeNull();
    expect(buildGeometry(A, B, 12, 10, 5, 1)?.done?.map((p) => p.x)).toEqual([0, 100, 100, 0]);
    // A progress outside 0..1 is cut, not drawn past the road.
    expect(buildGeometry(A, B, 12, 10, 5, 7)?.done?.map((p) => p.x)).toEqual([0, 100, 100, 0]);
  });

  it('puts the stripes in the world frame of the road, whatever its direction', () => {
    const up = buildGeometry(A, { x: 0, y: 100 }, 12, 10, 5, 0);
    expect(up?.mid).toEqual({ x: 0, y: 50 });
    const xs = up?.stripes.flat().map((p) => p.x) ?? [];
    // Across a road along +y the width runs along x (the band is 12 wide, centred on x = 0).
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-6);
    expect(Math.max(...xs)).toBeLessThanOrEqual(6);
  });

  it('has no tape for a road without length', () => {
    expect(buildGeometry(A, A, 12, 10, 5, 0.5)).toBeNull();
  });

  it('shows the time left as m:ss, rounded up', () => {
    expect(timeLeftLabel(150, 10)).toBe('0:15');
    expect(timeLeftLabel(1, 10)).toBe('0:01');
    expect(timeLeftLabel(0, 10)).toBe('0:00');
    expect(timeLeftLabel(-5, 10)).toBe('0:00');
    expect(timeLeftLabel(905, 10)).toBe('1:31');
  });
});
