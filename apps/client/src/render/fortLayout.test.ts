import { describe, expect, it } from 'vitest';
import type { Point } from './camera.ts';
import {
  FORT,
  borderRun,
  dashAlong,
  markScale,
  ringOrder,
  runLine,
  runPoint,
  runStrip,
  stackLevels,
  stubRun,
  tickCentres,
  tickFits,
  tickLayout,
  tickPolygon,
  turnDegrees,
} from './fortLayout.ts';
import type { CellEdge } from './regionLayout.ts';

// The cell of a node at the origin: a square 200 wide, walked clockwise (y down): top, right, bottom, left.
const TL: Point = { x: -100, y: -100 };
const TR: Point = { x: 100, y: -100 };
const BR: Point = { x: 100, y: 100 };
const BL: Point = { x: -100, y: 100 };
const edge = (a: Point, b: Point, neighbour: number | null): CellEdge => ({
  cell: 0,
  a,
  b,
  neighbour,
});
const NODE: Point = { x: 0, y: 0 };
const never = (): boolean => false;

/** The right edge (towards the node 1) and, when `top` is set, the top edge too; the others face nobody. */
function square(top: boolean): CellEdge[] {
  return [edge(TL, TR, top ? 1 : 2), edge(TR, BR, 1), edge(BR, BL, 2), edge(BL, TL, 2)];
}
const toNode1 = (e: CellEdge): boolean => e.neighbour === 1;

describe('markScale: marks grow when the map is zoomed out', () => {
  it('is 1 at 100% and above, and grows below, in steps of an eighth', () => {
    expect(markScale(1)).toBe(1);
    expect(markScale(3)).toBe(1);
    expect(markScale(0.5)).toBeGreaterThan(1);
    expect(markScale(0.25)).toBeGreaterThan(markScale(0.5));
    expect((markScale(0.37) * 8) % 1).toBe(0);
    // A gliding camera changes it a few times, not at every frame.
    expect(markScale(0.5)).toBe(markScale(0.505));
  });
  it('knows nothing of a camera that is not set', () => {
    expect(markScale(0)).toBe(1);
    expect(markScale(Number.NaN)).toBe(1);
  });
});

describe('tickLayout: the ticks of the look C7 "Long run"', () => {
  it('fits 24 fine ticks on the run of 170 at 100%', () => {
    const lay = tickLayout(1);
    expect(lay.n).toBe(24);
    expect(lay.cs).toHaveLength(24);
    // Centred on the crossing and evenly spaced by a tick and a gap.
    expect((lay.cs[0] ?? 0) + (lay.cs[23] ?? 0)).toBeCloseTo(0);
    expect((lay.cs[1] ?? 0) - (lay.cs[0] ?? 0)).toBeCloseTo(FORT.tickWidth + FORT.tickGap);
  });
  it('keeps the run length when the marks grow: fewer, never below three, ticks', () => {
    const far = tickLayout(2.2);
    expect(far.tw).toBeCloseTo(FORT.tickWidth * 2.2);
    expect(far.n).toBeLessThan(24);
    expect(tickLayout(60).n).toBe(FORT.minTicks);
  });
});

describe('ringOrder: the edges of a cell in order round it', () => {
  it('joins pieces given in another order by their end points', () => {
    const edges = [edge(BR, BL, 2), edge(TL, TR, 2), edge(BL, TL, 2), edge(TR, BR, 1)];
    const ring = ringOrder(edges);
    expect(ring).toHaveLength(4);
    ring.forEach((e, i) => {
      const next = ring[(i + 1) % 4] as CellEdge;
      expect(e.b).toEqual(next.a);
    });
  });
  it('keeps a ring that is in order as it is', () => {
    const ring = square(false);
    expect(ringOrder(ring)).toEqual(ring);
  });
});

describe('borderRun: the stretch of the shared border a line lies along', () => {
  const cross: Point = { x: 100, y: 0 };

  it('runs `half` each way along the shared edge, centred on the crossing', () => {
    const run = borderRun({ ring: square(false), shared: toNode1, cross, node: NODE, half: 60 });
    expect(run).not.toBeNull();
    if (run === null) return;
    expect(run.len).toBeCloseTo(120);
    expect(run.s0).toBeCloseTo(60);
    const middle = runPoint(run, run.s0);
    expect(middle.x).toBeCloseTo(100);
    expect(middle.y).toBeCloseTo(0);
  });

  it('ends square where the shared border ends (the neighbouring edge faces another cell)', () => {
    const run = borderRun({ ring: square(false), shared: toNode1, cross, node: NODE, half: 170 });
    if (run === null) throw new Error('no run');
    // The right edge is 200 long: the run is the edge, from the top corner to the bottom corner.
    expect(run.len).toBeCloseTo(200);
    expect(run.pts[0]?.y).toBeCloseTo(-100);
    expect(run.pts[run.pts.length - 1]?.y).toBeCloseTo(100);
  });

  it('never wraps a cell corner, even when the next edge faces the same cell', () => {
    const run = borderRun({ ring: square(true), shared: toNode1, cross, node: NODE, half: 170 });
    if (run === null) throw new Error('no run');
    // A turn of 90 degrees at the top right corner (more than FORT.trim): the top edge is not used.
    expect(Math.min(...run.pts.map((p) => p.y))).toBeCloseTo(-100);
    expect(Math.min(...run.pts.map((p) => p.x))).toBeCloseTo(100);
    expect(run.len).toBeCloseTo(200);
  });

  it('stops before a corner that a geography has rounded into many short steps', () => {
    // The right edge from the bottom up to y = -20, then a quarter circle of radius 24 into the top edge.
    const steps: Point[] = [BR, { x: 100, y: -20 }];
    for (let k = 1; k <= 10; k++) {
      const a = (k / 10) * (Math.PI / 2);
      steps.push({ x: 76 + 24 * Math.cos(a), y: -20 - 24 * Math.sin(a) });
    }
    steps.push({ x: -100, y: -44 });
    const ring: CellEdge[] = steps
      .slice(0, -1)
      .map((p, i) => edge(p, steps[i + 1] as Point, 1))
      .concat([edge({ x: -100, y: -44 }, BL, 2), edge(BL, BR, 2)]);
    const run = borderRun({ ring, shared: toNode1, cross, node: NODE, half: 170 });
    if (run === null) throw new Error('no run');
    // The straight part is there, the top edge (y = -44, x < 76) is not.
    expect(Math.max(...run.pts.map((p) => p.y))).toBeCloseTo(100);
    expect(Math.min(...run.pts.map((p) => p.x))).toBeGreaterThan(76 - 0.01);
    expect(Math.min(...run.pts.map((p) => p.y))).toBeGreaterThan(-44);
  });

  it('bends with a gentle curve: no trimming under the turn limit', () => {
    // An arc of radius 400: 170 units turn the border by about 24 degrees, under FORT.trim.
    const arc: Point[] = [];
    for (let k = -20; k <= 20; k++) {
      const a = (k / 20) * (170 / 400);
      arc.push({ x: 100 - 400 * (1 - Math.cos(a)), y: 400 * Math.sin(a) });
    }
    const ring = arc.slice(0, -1).map((p, i) => edge(p, arc[i + 1] as Point, 1));
    const run = borderRun({ ring, shared: toNode1, cross, node: { x: -300, y: 0 }, half: 80 });
    if (run === null) throw new Error('no run');
    expect(run.len).toBeCloseTo(160, 0);
    expect(run.pts.length).toBeGreaterThan(5);
  });

  it('has normals that point out of the cell', () => {
    const run = borderRun({ ring: square(false), shared: toNode1, cross, node: NODE, half: 50 });
    if (run === null) throw new Error('no run');
    for (const n of run.normals) {
      expect(n.x).toBeCloseTo(1);
      expect(n.y).toBeCloseTo(0);
    }
  });

  it('takes the side an area gives when it has an inward normal (a cell that is not convex)', () => {
    // The node lies on the wrong side of this edge for a centre test; the edge says where inside is.
    const ring = [{ ...edge(TR, BR, 1), inward: { x: -1, y: 0 } }];
    const run = borderRun({ ring, shared: toNode1, cross, node: { x: 400, y: 0 }, half: 40 });
    if (run === null) throw new Error('no run');
    expect(run.normals[0]?.x).toBeCloseTo(1);
  });

  it('has no run when no edge of the cell is shared', () => {
    expect(
      borderRun({ ring: square(false), shared: never, cross, node: NODE, half: 60 }),
    ).toBeNull();
    expect(borderRun({ ring: [], shared: toNode1, cross, node: NODE, half: 60 })).toBeNull();
  });

  it('picks the shared edge nearest the crossing when the cell has several', () => {
    const ring = [edge(TL, TR, 1), edge(TR, BR, 2), edge(BR, BL, 1), edge(BL, TL, 2)];
    const run = borderRun({ ring, shared: toNode1, cross: { x: 0, y: 100 }, node: NODE, half: 30 });
    if (run === null) throw new Error('no run');
    expect(run.pts.every((p) => Math.abs(p.y - 100) < 0.01)).toBe(true);
  });

  it('puts two crossings of one ring a ring length apart on the ring', () => {
    const a = borderRun({ ring: square(false), shared: toNode1, cross, node: NODE, half: 30 });
    const b = borderRun({
      ring: square(false),
      shared: toNode1,
      cross: { x: 100, y: 50 },
      node: NODE,
      half: 30,
    });
    if (a === null || b === null) throw new Error('no run');
    expect(a.ringLength).toBeCloseTo(800);
    expect(b.ringAt - a.ringAt).toBeCloseTo(50);
  });
});

describe('borderRun without a limit: the whole stretch of the shared border (#734)', () => {
  /** The length of a polyline, from the points themselves. */
  const lengthOf = (pts: readonly Point[]): number =>
    pts
      .slice(1)
      .reduce(
        (sum, p, i) => sum + Math.hypot(p.x - (pts[i] as Point).x, p.y - (pts[i] as Point).y),
        0,
      );

  it('covers the shared edge end to end when the road crosses it near one end', () => {
    // The right edge runs from y = -100 to y = 100; the road crosses at y = 70: 170 back, 30 on.
    const run = borderRun({
      ring: square(false),
      shared: toNode1,
      cross: { x: 100, y: 70 },
      node: NODE,
    });
    if (run === null) throw new Error('no run');
    expect(run.len).toBeCloseTo(200);
    expect(run.s0).toBeCloseTo(170);
    expect(run.pts[0]?.y).toBeCloseTo(-100);
    expect(run.pts[run.pts.length - 1]?.y).toBeCloseTo(100);
  });

  it('follows a smooth S-curve of the border to its end', () => {
    // x = 100 + 15 sin(2 pi (y + 150) / 250), y from -150 to 100: the direction swings by at most
    // 21 degrees each way (42 in all, under FORT.drift) and bends with a radius of 100 or more
    // (about 14 degrees over 2 * 12 units, under FORT.trim): nothing here is a corner.
    const curve: Point[] = [];
    for (let y = -150; y <= 100; y += 5) {
      curve.push({ x: 100 + 15 * Math.sin((2 * Math.PI * (y + 150)) / 250), y });
    }
    const ring = curve.slice(0, -1).map((p, i) => edge(p, curve[i + 1] as Point, 1));
    const at = curve.findIndex((p) => p.y === 70);
    const run = borderRun({
      ring,
      shared: toNode1,
      cross: curve[at] as Point,
      node: { x: -200, y: 0 },
    });
    if (run === null) throw new Error('no run');
    expect(run.len).toBeCloseTo(lengthOf(curve), 1);
    expect(run.s0).toBeCloseTo(lengthOf(curve.slice(0, at + 1)), 1);
  });

  it('still never wraps a cell corner', () => {
    const run = borderRun({
      ring: square(true),
      shared: toNode1,
      cross: { x: 100, y: 70 },
      node: NODE,
    });
    if (run === null) throw new Error('no run');
    // The top edge faces the same cell, but the corner at the top right turns by 90 degrees.
    expect(run.len).toBeCloseTo(200);
    expect(Math.min(...run.pts.map((p) => p.x))).toBeCloseTo(100);
  });
});

describe('tickCentres: the ticks on the whole run (#734)', () => {
  it('lays them from end to end of the run, in step with the ticks round the crossing', () => {
    // The run is the right edge, from 170 before the crossing to 30 after it. At 100% a tick is 3
    // wide with a gap of 4: the centres are 3.5 + 7k, and a tick fits when it lies on the run.
    const run = borderRun({
      ring: square(false),
      shared: toNode1,
      cross: { x: 100, y: 70 },
      node: NODE,
    });
    if (run === null) throw new Error('no run');
    const cs = tickCentres(run, tickLayout(1));
    expect(cs[0]).toBeCloseTo(-164.5);
    expect(cs[cs.length - 1]).toBeCloseTo(24.5);
    expect(cs).toHaveLength(28);
    expect(cs).toContain(3.5);
    expect(cs).toContain(-3.5);
  });

  it('lays the ticks of a stub as the tick layout says', () => {
    const lay = tickLayout(1);
    const run = stubRun(NODE, { x: 100, y: 0 }, lay.half + lay.reach);
    expect(tickCentres(run, lay)).toHaveLength(lay.n);
  });
});

describe('the line, its strips and its ticks follow the run', () => {
  const run = borderRun({
    ring: square(false),
    shared: toNode1,
    cross: { x: 100, y: 0 },
    node: NODE,
    half: 60,
  });
  if (run === null) throw new Error('no run');

  it('moves the line into the cell by a negative offset and out of it by a positive one', () => {
    const inside = runLine(run, -30, 30, -8.5);
    expect(inside[0]?.x).toBeCloseTo(91.5);
    expect(inside[inside.length - 1]?.x).toBeCloseTo(91.5);
    expect(inside[0]?.y).toBeCloseTo(-30);
    expect(inside[inside.length - 1]?.y).toBeCloseTo(30);
    expect(runLine(run, -30, 30, 4)[0]?.x).toBeCloseTo(104);
  });

  it('stays on the run when asked for more than it has', () => {
    const line = runLine(run, -500, 500, 0);
    expect(line[0]?.y).toBeCloseTo(-60);
    expect(line[line.length - 1]?.y).toBeCloseTo(60);
  });

  it('makes a strip between two offsets', () => {
    const strip = runStrip(run, -10, 10, -12, -3);
    // Both sides of the band, with a vertex of the run at the crossing in the middle.
    expect(strip.length).toBeGreaterThanOrEqual(4);
    const xs = strip.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(88);
    expect(Math.max(...xs)).toBeCloseTo(97);
  });

  it('stands a tick on the stroke and reaches towards the border', () => {
    const poly = tickPolygon(run, 0, 3, 8.5, 3, 5);
    expect(poly).toHaveLength(4);
    // From just behind the stroke (0.3 of its width) to 5 past it, which is 3.5 short of the border.
    expect(Math.min(...poly.map((p) => p.x))).toBeCloseTo(100 - 8.5 - 0.9);
    expect(Math.max(...poly.map((p) => p.x))).toBeCloseTo(100 - 8.5 + 5);
    expect(Math.max(...poly.map((p) => p.y)) - Math.min(...poly.map((p) => p.y))).toBeCloseTo(3);
  });

  it('drops a tick that would stand off the end of the run', () => {
    expect(tickFits(run, 0, 3)).toBe(true);
    expect(tickFits(run, 59, 3)).toBe(false);
    expect(tickFits(run, -59, 3)).toBe(false);
    expect(tickFits(run, 58, 3)).toBe(true);
  });
});

describe('stubRun: a straight run across the road when the cell has no shared edge', () => {
  it('is perpendicular to the road at the crossing and points away from the node', () => {
    const run = stubRun(NODE, { x: 100, y: 0 }, 40);
    expect(run.len).toBe(80);
    expect(run.s0).toBe(40);
    expect(run.normals[0]?.x).toBeCloseTo(1);
    expect(run.pts[0]?.x).toBeCloseTo(100);
    expect(Math.abs((run.pts[0]?.y ?? 0) - (run.pts[1]?.y ?? 0))).toBeCloseTo(80);
  });
});

describe('dashAlong: dashes along a polyline', () => {
  it('cuts a straight line into dashes and gaps', () => {
    const pieces = dashAlong(
      [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
      ],
      4,
      6,
    );
    expect(pieces).toHaveLength(2);
    expect(pieces[0]?.[0]?.x).toBeCloseTo(0);
    expect(pieces[0]?.[pieces[0].length - 1]?.x).toBeCloseTo(4);
    expect(pieces[1]?.[0]?.x).toBeCloseTo(10);
    expect(pieces[1]?.[pieces[1].length - 1]?.x).toBeCloseTo(14);
  });

  it('lets a dash bend round a vertex', () => {
    const pieces = dashAlong(
      [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 5 },
      ],
      8,
      2,
    );
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toHaveLength(3);
  });

  it('makes nothing of a point', () => {
    expect(dashAlong([{ x: 1, y: 1 }], 4, 4)).toEqual([]);
  });
});

describe('turnDegrees', () => {
  it('is 0 straight on, 90 at a right angle, 180 turned round', () => {
    expect(turnDegrees({ x: 1, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(0);
    expect(turnDegrees({ x: 1, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90);
    expect(turnDegrees({ x: 1, y: 0 }, { x: 0, y: -1 })).toBeCloseTo(90);
    expect(turnDegrees({ x: 1, y: 0 }, { x: -1, y: 0 })).toBeCloseTo(180);
  });
});

describe('stackLevels: two lines on one stretch of a cell lie one behind the other', () => {
  // Stretches of a ring 800 long, from `from` to `to`.
  const at = (key: string, from: number, to: number, ringLength = 800) => ({
    key,
    from,
    to,
    ringLength,
  });

  it('gives a line whose stretch overlaps a placed one the next level inwards', () => {
    const levels = stackLevels([at('a', 0, 200), at('b', 150, 300), at('c', 180, 260)]);
    expect(levels.get('a')).toBe(0);
    expect(levels.get('b')).toBe(1);
    expect(levels.get('c')).toBe(2);
  });

  it('keeps lines apart on one level, and a line that clears the first takes its level again', () => {
    const levels = stackLevels([at('a', 0, 200), at('b', 300, 500), at('c', 150, 280)]);
    expect(levels.get('a')).toBe(0);
    expect(levels.get('b')).toBe(0);
    expect(levels.get('c')).toBe(1);
  });

  it('stacks two lines of a long stretch whose crossings are far apart (#734)', () => {
    // The crossings are 300 apart, but each run covers the whole 400 of the shared border.
    const levels = stackLevels([at('a', 100, 500), at('b', 100, 500)]);
    expect(levels.get('b')).toBe(1);
  });

  it('keeps two lines that only meet at a corner of the cell on one level', () => {
    const levels = stackLevels([at('a', 0, 200), at('b', 200, 350)]);
    expect(levels.get('b')).toBe(0);
  });

  it('counts the way round the ring: the end and the start of it are neighbours', () => {
    const levels = stackLevels([at('a', -40, 60), at('b', 760, 830)]);
    expect(levels.get('b')).toBe(1);
  });

  it('stacks the stubs of a node, not a stub and a border run', () => {
    const levels = stackLevels([at('a', 0, 200), at('s', -90, 90, 0), at('t', -90, 90, 0)]);
    expect(levels.get('s')).toBe(0);
    expect(levels.get('t')).toBe(1);
  });
});
