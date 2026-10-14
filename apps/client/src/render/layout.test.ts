import { describe, expect, it } from 'vitest';
import type { EventMsg, MapFile } from '../protocol.gen.ts';
import {
  arrowGeometry,
  buildGeometry,
  countLabel,
  dashSegments,
  edgePoint,
  fightInfo,
  chargeLevel,
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

  it('fills from the tip by sqrt(charged / units) of the height', () => {
    expect(chargeLevel(4, 1)).toBeCloseTo(0.5);
    expect(chargeLevel(4, 4)).toBe(1);
    expect(chargeLevel(4, 0)).toBe(0);
    expect(chargeLevel(0, 0)).toBe(0);
    expect(chargeLevel(2, 9)).toBe(1);
    // The filled area (level squared) is the charged share.
    expect(chargeLevel(10, 3) ** 2).toBeCloseTo(0.3);
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

describe('road builds of cities', () => {
  it('puts bars across the road between the rims, and the mark near the building city', () => {
    const geometry = buildGeometry(A, B, 20, 20, 6, 20, 15);
    expect(geometry?.ties.map(([a, b]) => [a.x, a.y, b.x, b.y])).toEqual([
      [30, 6, 30, -6],
      [50, 6, 50, -6],
      [70, 6, 70, -6],
    ]);
    expect(geometry?.mark).toEqual({ x: 35, y: 0 });
    // Built from the other end: the mark sits at that end.
    expect(buildGeometry(B, A, 20, 20, 6, 20, 15)?.mark).toEqual({ x: 65, y: 0 });
  });

  it('never puts the mark past the middle, and draws nothing between overlapping cities', () => {
    expect(buildGeometry(A, B, 20, 20, 6, 20, 80)?.mark).toEqual({ x: 50, y: 0 });
    expect(buildGeometry(A, { x: 30, y: 0 }, 20, 20, 6, 20, 15)).toBeNull();
  });

  it('shows the time left as m:ss, rounded up', () => {
    expect(timeLeftLabel(150, 10)).toBe('0:15');
    expect(timeLeftLabel(1, 10)).toBe('0:01');
    expect(timeLeftLabel(0, 10)).toBe('0:00');
    expect(timeLeftLabel(-5, 10)).toBe('0:00');
    expect(timeLeftLabel(905, 10)).toBe('1:31');
  });
});

describe('fight marks', () => {
  const map = {
    nodes: [
      { id: 0, x: 10, y: 20 },
      { id: 1, x: 110, y: 20 },
    ],
    edges: [{ id: 0, a: 0, b: 1 }],
  } as unknown as MapFile;

  function fightEvent(data: EventMsg['data']): EventMsg {
    return { type: 'event', tick: 50, kind: 'fight_ended', data };
  }

  it('puts a fight in a city at the city and reads both sides losses', () => {
    const info = fightInfo(fightEvent({ node: 1, edge: null, losses_0: 2, losses_1: 3 }), map);
    expect(info?.at).toEqual({ x: 110, y: 20 });
    expect(info?.losses).toEqual([2, 3]);
  });

  it('puts a fight on a road at its meeting point', () => {
    // DEC-24, C3: point = pos_0 + pos_1 = 1134, the mark at 1134 / 2000 of the road from `a`.
    const data = { node: null, edge: 0, point: 1134, losses_0: 0, losses_1: 1 };
    const at = fightInfo(fightEvent(data), map)?.at;
    expect(at?.x).toBeCloseTo(66.7);
    expect(at?.y).toBe(20);
  });

  it('flashes a round and shows the numbers of a finished fight only', () => {
    const round = { ...fightEvent({ node: 1, edge: null, losses_0: 0, losses_1: 1 }) };
    expect(fightInfo({ ...round, kind: 'fight_round' }, map)?.final).toBe(false);
    expect(fightInfo(round, map)?.final).toBe(true);
    expect(fightInfo({ ...round, kind: 'fight_started' }, map)).toBeNull();
  });

  it('ignores other events, unknown places and events without losses', () => {
    expect(fightInfo({ type: 'event', tick: 1, kind: 'node_captured', data: {} }, map)).toBeNull();
    expect(
      fightInfo(fightEvent({ node: 9, edge: null, losses_0: 1, losses_1: 1 }), map),
    ).toBeNull();
    expect(fightInfo(fightEvent({ node: 0, edge: null }), map)).toBeNull();
  });
});
