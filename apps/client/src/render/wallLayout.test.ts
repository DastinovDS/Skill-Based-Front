import { describe, expect, it } from 'vitest';
import type { Point } from './camera.ts';
import { stretchRun, stubRun, type Run } from './fortLayout.ts';
import type { CellEdge } from './regionLayout.ts';
import {
  WALL,
  buildSpan,
  dotArcs,
  fallPieces,
  gateOnRun,
  squareAt,
  wallLine,
  wallParts,
  wallPoint,
  wallScale,
  wallTeeth,
} from './wallLayout.ts';

// A straight border along x = 100 from y = -100 to y = 100, the node at the origin (the cell to the left).
const run: Run = {
  pts: [
    { x: 100, y: -100 },
    { x: 100, y: 100 },
  ],
  s: [0, 200],
  s0: 100,
  len: 200,
  normals: [{ x: 1, y: 0 }],
  ringAt: 0,
  ringLength: 0,
};

describe('wallScale: the masonry keeps its screen size zoomed out', () => {
  it('is 1 at 95% and closer, grows below in steps of an eighth, and stops at the cap', () => {
    expect(wallScale(1)).toBe(1);
    expect(wallScale(0.95)).toBe(1);
    expect(wallScale(0.5)).toBe(1.875);
    expect((wallScale(0.6) * 8) % 1).toBe(0);
    expect(wallScale(0.1)).toBe(WALL.maxScale);
    expect(wallScale(0)).toBe(1);
  });
});

describe('gateOnRun: where the wall meets the road', () => {
  it('stands on the crossing for a road square to the border, half the gate each side', () => {
    const gate = gateOnRun(run, 100, { x: 1, y: 0 }, WALL.offset, WALL.gate);
    expect(gate.at).toBeCloseTo(100);
    expect(gate.half).toBeCloseTo(WALL.gate);
  });

  it('moves along the wall and widens for a slanting road, so it stays on the road', () => {
    // The road comes in at 45 degrees, down and to the right.
    const road = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
    const gate = gateOnRun(run, 100, road, WALL.offset, WALL.gate);
    // The wall lies `offset` inside the border: the road meets it `offset` before the crossing.
    expect(gate.at).toBeCloseTo(100 - WALL.offset);
    expect(gate.half).toBeGreaterThan(WALL.gate);
    const at = wallPoint(run, gate.at, -WALL.offset);
    const cross = { x: 100, y: 0 };
    // On the road: the point is the crossing moved back along the road.
    const back = { x: cross.x - at.x, y: cross.y - at.y };
    expect(back.x * road.y - back.y * road.x).toBeCloseTo(0);
  });
});

describe('wallParts: the pieces between the gates and the towers beside them', () => {
  it('cuts the wall at every gate and stands a tower at both sides of each', () => {
    const gates = [
      { at: 50, half: 4, road: { x: 1, y: 0 } },
      { at: 150, half: 4, road: { x: 1, y: 0 } },
    ];
    const { parts, posts } = wallParts(0, 200, gates);
    expect(parts).toEqual([
      [0, 46],
      [54, 146],
      [154, 200],
    ]);
    expect(posts.map((p) => p.at)).toEqual([46, 54, 146, 154]);
  });

  it('keeps a gate past the end of the wall out of it', () => {
    const { parts, posts } = wallParts(0, 100, [{ at: 150, half: 4, road: { x: 1, y: 0 } }]);
    expect(parts).toEqual([[0, 100]]);
    expect(posts).toEqual([]);
  });
});

describe('wallTeeth: merlons and stakes towards the border', () => {
  it('stands the teeth on the band, reaching towards the border, a pitch apart', () => {
    const merlons = wallTeeth(run, 0, 200, WALL.offset, 'battlement', 1);
    expect(merlons.length).toBe(
      Math.floor((200 - WALL.battlement.pitch * 0.75) / WALL.battlement.pitch) + 1,
    );
    for (const tooth of merlons) {
      expect(tooth).toHaveLength(4);
      // Inside the cell (x < 100) and nearer the border than the band's middle.
      for (const p of tooth) {
        expect(p.x).toBeLessThan(100);
        expect(p.x).toBeGreaterThan(100 - WALL.offset);
      }
    }
    const stakes = wallTeeth(run, 0, 200, WALL.offset, 'palisade', 1);
    expect(stakes[0]).toHaveLength(3);
    expect(stakes.length).toBeGreaterThan(merlons.length);
  });

  it('grows with the masonry scale', () => {
    const small = wallTeeth(run, 0, 200, WALL.offset, 'battlement', 1);
    const big = wallTeeth(run, 0, 200, WALL.offset * 2, 'battlement', 2);
    expect(big.length).toBeLessThan(small.length);
  });
});

describe('the wall line and its points', () => {
  it('lies `depth` inside the border', () => {
    const line = wallLine(run, 0, 200, -WALL.offset);
    expect(line[0]?.x).toBeCloseTo(100 - WALL.offset);
    expect(line[line.length - 1]?.y).toBeCloseTo(100);
    const at = wallPoint(run, 100, -WALL.offset);
    expect(at).toMatchObject({ x: 100 - WALL.offset, y: 0, nx: 1, ny: 0 });
  });

  it('turns a square to a direction', () => {
    const corners = squareAt({ x: 0, y: 0 }, { x: 1, y: 0 }, 2);
    expect(corners.map((p) => [Math.abs(p.x), Math.abs(p.y)])).toEqual([
      [2, 2],
      [2, 2],
      [2, 2],
      [2, 2],
    ]);
    const turned = squareAt({ x: 0, y: 0 }, { x: Math.SQRT1_2, y: Math.SQRT1_2 }, 2);
    // A lozenge: its corners on the axes.
    expect(turned.some((p) => Math.abs(p.x) < 1e-9)).toBe(true);
  });
});

describe('buildSpan and dotArcs: a build grows from its gate both ways', () => {
  const gate = { at: 60, half: 4, road: { x: 1, y: 0 } };

  it('is only the gate at the start and the whole wall at the end', () => {
    expect(buildSpan(200, gate, 0)).toEqual({ a: 56, a0: 56, b0: 64, b: 64 });
    expect(buildSpan(200, gate, 1)).toEqual({ a: 0, a0: 56, b0: 64, b: 200 });
    const half = buildSpan(200, gate, 0.5);
    expect(half.a).toBeCloseTo(28);
    expect(half.b).toBeCloseTo(132);
  });

  it('puts the points of the part not built yet outside what stands', () => {
    const dots = dotArcs(100, [[20, 60]], 5);
    expect(dots.every((d) => d < 20 || d > 60)).toBe(true);
    expect(dots[0]).toBe(2);
  });
});

describe('fallPieces: a captured wall breaks up from its middle', () => {
  it('stands whole at the start and is gone at the end', () => {
    const start = fallPieces(100, 0, 1);
    expect(start.every((p) => p.q === 0)).toBe(true);
    expect(start.length).toBe(Math.ceil(100 / WALL.fall.step));
    expect(fallPieces(100, WALL.fall.ms, 1)).toEqual([]);
  });

  it('lets the middle go before the ends', () => {
    const mid = fallPieces(100, 300, 1);
    const centre = mid.reduce((a, b) => (Math.abs(a.from - 50) < Math.abs(b.from - 50) ? a : b));
    const end = mid[0];
    expect(centre.q).toBeGreaterThan(end?.q ?? 1);
  });
});

describe('stretchRun: a wall of several roads along the ring of its cell', () => {
  // The square cell round the origin, walked round: top, right, bottom, left (200 each).
  const TL: Point = { x: -100, y: -100 };
  const TR: Point = { x: 100, y: -100 };
  const BR: Point = { x: 100, y: 100 };
  const BL: Point = { x: -100, y: 100 };
  const ring: CellEdge[] = [
    { cell: 0, a: TL, b: TR, neighbour: 1 },
    { cell: 0, a: TR, b: BR, neighbour: 2 },
    { cell: 0, a: BR, b: BL, neighbour: 3 },
    { cell: 0, a: BL, b: TL, neighbour: 4 },
  ];
  const node: Point = { x: 0, y: 0 };

  it('runs round a corner of the ring, its normals out of the cell', () => {
    const r = stretchRun(ring, node, 100, 300);
    if (r === null) throw new Error('no run');
    expect(r.len).toBeCloseTo(200);
    expect(r.pts[0]).toEqual({ x: 0, y: -100 });
    expect(r.pts[r.pts.length - 1]).toEqual({ x: 100, y: 0 });
    expect(r.normals.map((n) => [Math.round(n.x) + 0, Math.round(n.y) + 0])).toEqual([
      [0, -1],
      [1, 0],
    ]);
    expect(r.ringAt).toBe(100);
  });

  it('wraps past the end of the ring', () => {
    const r = stretchRun(ring, node, 700, 900);
    expect(r?.len).toBeCloseTo(200);
    expect(r?.pts[0]).toEqual({ x: -100, y: 0 });
  });

  it('is nothing for an empty stretch or a ring with a gap in it', () => {
    expect(stretchRun(ring, node, 100, 100.5)).toBeNull();
    const gap: CellEdge[] = [ring[0] as CellEdge, { ...(ring[2] as CellEdge) }];
    expect(stretchRun(gap, node, 150, 250)).toBeNull();
  });

  it('a stub is drawn as it is (no ring)', () => {
    expect(stubRun(node, { x: 50, y: 0 }, 10).ringLength).toBe(0);
  });
});
