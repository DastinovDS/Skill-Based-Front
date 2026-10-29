import { describe, expect, it } from 'vitest';
import {
  bulkheadLine,
  circleHatch,
  flowBand,
  flowDashes,
  flowPhase,
  headPoly,
  labelPose,
  pipeBore,
  pipeInside,
  pipeSpan,
} from './pipeLayout.ts';
import { SUPPLY_PIPE } from './style.ts';

describe('the bore of a pipe (#429)', () => {
  it('is the level: three widths, growing, clamped to 1..3', () => {
    expect([1, 2, 3].map(pipeBore)).toEqual([7, 10, 13]);
    expect(pipeBore(0)).toBe(7);
    expect(pipeBore(9)).toBe(13);
    expect(pipeBore(2.4)).toBe(10);
  });

  it('has the inside of the bore without its two walls', () => {
    expect(pipeInside(10)).toBe(10 - 2 * SUPPLY_PIPE.wall);
  });

  it('fills the pipe across with one direction and one half each with two', () => {
    const inside = pipeInside(13);
    expect(flowBand(13, false)).toEqual({ lane: 0, width: inside - 0.6 });
    const two = flowBand(13, true);
    expect(two.lane).toBeCloseTo(inside / 4);
    expect(two.width).toBeCloseTo(inside / 2 - 0.6);
    // The two bands (a lane each, to the right of their own direction) do not overlap.
    expect(two.lane * 2).toBeGreaterThanOrEqual(two.width);
  });
});

describe('where a pipe lies', () => {
  it('runs between the rims of its two cities', () => {
    const span = pipeSpan({ x: 0, y: 0 }, { x: 100, y: 0 }, 16, 20);
    expect(span?.start).toEqual({ x: 16, y: 0 });
    expect(span?.end).toEqual({ x: 80, y: 0 });
    expect(span?.length).toBe(64);
  });

  it('has none when the cities leave no room for it', () => {
    expect(pipeSpan({ x: 0, y: 0 }, { x: 30, y: 0 }, 16, 20)).toBeNull();
  });
});

describe('the dashes of a flow', () => {
  const from = { x: 0, y: 0 };
  const to = { x: 100, y: 0 };
  const xs = (phase: number) =>
    flowDashes(from, to, 4, 8, phase).map(([p, q]) => [p.x, q.x] as const);

  it('are dash long with gap between them along the direction of the flow', () => {
    expect(xs(0).slice(0, 3)).toEqual([
      [0, 4],
      [12, 16],
      [24, 28],
    ]);
  });

  it('move forward with the phase, and wrap by one period', () => {
    expect(xs(3).slice(0, 2)).toEqual([
      [3, 7],
      [15, 19],
    ]);
    expect(xs(12)).toEqual(xs(0));
    expect(xs(-4)).toEqual(xs(8));
  });

  it('never leave the pipe: a dash cut by an end is shortened', () => {
    for (const phase of [0, 1, 5, 9, 11]) {
      for (const [a, b] of xs(phase)) {
        expect(a).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThanOrEqual(100);
        expect(b).toBeGreaterThan(a);
      }
    }
  });

  it('go the other way for a flow the other way', () => {
    const back = flowDashes(to, from, 4, 8, 0)[0];
    expect(back?.[0].x).toBe(100);
    expect(back?.[1].x).toBe(96);
  });

  it('stand still without motion', () => {
    expect(flowPhase(500, 10, true)).toBe(0);
    expect(flowPhase(0, 10, false)).toBe(0);
    expect(flowPhase(10, 10, false)).toBe(SUPPLY_PIPE.speed);
    expect(flowPhase(10, 0, false)).toBe(0);
  });
});

describe('a number along a pipe', () => {
  it('lies above a pipe that runs to the right, turned with it', () => {
    const pose = labelPose({ x: 0, y: 0 }, { x: 100, y: 0 }, 50, 10);
    expect(pose.rotation).toBeCloseTo(0);
    expect(pose.x).toBeCloseTo(50);
    expect(pose.y).toBeCloseTo(-(5 + SUPPLY_PIPE.labelLift));
  });

  it('never reads upside down: a pipe to the left turns the text half a turn and keeps it above', () => {
    const pose = labelPose({ x: 100, y: 0 }, { x: 0, y: 0 }, 50, 10);
    expect(Math.cos(pose.rotation)).toBeCloseTo(1);
    expect(Math.sin(pose.rotation)).toBeCloseTo(0);
    expect(pose.x).toBeCloseTo(50);
    expect(pose.y).toBeCloseTo(-(5 + SUPPLY_PIPE.labelLift));
  });

  it('follows a slanted pipe: the rotation is its angle and the text is on its upper side', () => {
    const pose = labelPose({ x: 0, y: 0 }, { x: 0, y: 100 }, 50, 10);
    expect(pose.rotation).toBeCloseTo(Math.PI / 2);
    // "Above" a pipe running down is to its right on the screen, the way the text is turned.
    expect(pose.x).toBeGreaterThan(0);
    expect(pose.y).toBeCloseTo(50);
    const up = labelPose({ x: 0, y: 100 }, { x: 0, y: 0 }, 50, 10);
    expect(up.rotation).toBeCloseTo(-Math.PI / 2);
    expect(up.x).toBeLessThan(0);
  });
});

describe('the parts of a cut-off city and of the valve', () => {
  it('hatches a circle with parallel chords whose ends lie on it', () => {
    const centre = { x: 10, y: 20 };
    const chords = circleHatch(centre, 20, 5);
    expect(chords.length).toBeGreaterThan(4);
    for (const [p, q] of chords) {
      expect(Math.hypot(p.x - centre.x, p.y - centre.y)).toBeCloseTo(20, 5);
      expect(Math.hypot(q.x - centre.x, q.y - centre.y)).toBeCloseTo(20, 5);
      // From the lower left to the upper right, at 45 degrees.
      expect(q.x).toBeGreaterThanOrEqual(p.x);
      expect(q.y).toBeLessThanOrEqual(p.y);
      expect(q.x - p.x).toBeCloseTo(p.y - q.y);
    }
    expect(circleHatch(centre, 0, 5)).toEqual([]);
  });

  it('puts the tip of a valve cap where it is told and the base behind it', () => {
    const [tip, left, right] = headPoly({ x: 50, y: 0 }, 1, 0, 8, 10);
    expect(tip).toEqual({ x: 50, y: 0 });
    expect(left.x).toBe(42);
    expect(right.x).toBe(42);
    expect(Math.abs(left.y - right.y)).toBe(10);
  });

  it('draws a bulkhead across the road, not along it', () => {
    const [p, q] = bulkheadLine({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 0 }, 5);
    expect(p.x).toBeCloseTo(50);
    expect(q.x).toBeCloseTo(50);
    expect(Math.abs(p.y - q.y)).toBeCloseTo(10);
  });
});
