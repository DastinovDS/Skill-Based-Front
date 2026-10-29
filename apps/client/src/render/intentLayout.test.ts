import { describe, expect, it } from 'vitest';
import {
  chevrons,
  dashAlong,
  delayLeft,
  delayProgress,
  departPulse,
  ghostLook,
  orderBend,
  pathBend,
  polylineLength,
  polylinePrefix,
  ribbonAxis,
  ribbonBody,
  ribbonFilled,
  ribbonOutline,
  axisPoint,
  bonusSpot,
  frontLine,
  ribbonHalfWidth,
  ribbonSlice,
  ringDashes,
  ringOpacity,
  sheenPhase,
  sheenSpan,
  signRim,
  tailStart,
} from './intentLayout.ts';
import { vpBadgeAt } from './cityLayout.ts';
import { barracksAt } from './defenseLayout.ts';
import { GHOST_REJECT_MS, GHOST_SHAKE_MS, RIBBON } from './style.ts';

const A = { x: 0, y: 0 };
const B = { x: 200, y: 0 };

describe('ribbonAxis', () => {
  it('starts and ends at the gaps from the cities and bends to the left of the way', () => {
    const axis = ribbonAxis([A, B], 20, 30, 0.15);
    expect(axis[0]).toEqual({ x: 20, y: 0 });
    const last = axis.at(-1);
    expect(last?.x).toBeCloseTo(170);
    expect(last?.y).toBeCloseTo(0);
    // Left of the way east is y > 0 on a y-down screen (n = (-uy, ux)).
    const peak = Math.max(...axis.map((p) => p.y));
    expect(peak).toBeCloseTo((150 * 0.15) / 2, 0);
  });

  it('follows every node of a path and has no repeated joint point', () => {
    const c = { x: 200, y: 200 };
    const axis = ribbonAxis([A, B, c], 10, 10, 0.1);
    expect(axis.length).toBeGreaterThan(16);
    for (let i = 1; i < axis.length; i++) {
      expect(axis[i]).not.toEqual(axis[i - 1]);
    }
    expect(polylineLength(axis)).toBeGreaterThan(380 - 20);
  });

  it('is empty when the gaps swallow the way or there are no legs', () => {
    expect(ribbonAxis([A, { x: 30, y: 0 }], 20, 20, 0.15)).toEqual([]);
    expect(ribbonAxis([A], 10, 10, 0.15)).toEqual([]);
  });
});

describe('ribbonOutline', () => {
  const axis = ribbonAxis([A, B], 16, 20, 0);

  it('has a 16 wide body, a 60% tail and a 38 x 30 head', () => {
    const ribbon = ribbonOutline(axis, RIBBON.body);
    expect(ribbon).not.toBeNull();
    if (ribbon === null) return;
    const width = (i: number): number => {
      const l = ribbon.outline[i];
      const r = ribbon.outline[ribbon.outline.length - 1 - i];
      return Math.hypot((l?.x ?? 0) - (r?.x ?? 0), (l?.y ?? 0) - (r?.y ?? 0));
    };
    expect(width(0)).toBeCloseTo(16 * RIBBON.tailRatio);
    const bodyEnd = ribbon.body.length - 1;
    expect(width(bodyEnd)).toBeCloseTo(16);
    // The head: two corners right after the body, then the tip.
    const head = ribbon.outline[bodyEnd + 1];
    const other = ribbon.outline[bodyEnd + 3];
    expect(
      Math.hypot((head?.x ?? 0) - (other?.x ?? 0), (head?.y ?? 0) - (other?.y ?? 0)),
    ).toBeCloseTo(38);
    const base = ribbon.body.at(-1);
    expect(Math.hypot(ribbon.tip.x - (base?.x ?? 0), ribbon.tip.y - (base?.y ?? 0))).toBeCloseTo(
      30,
      0,
    );
  });

  it('shrinks the head of a short ribbon instead of dropping it', () => {
    const short = ribbonAxis([A, { x: 70, y: 0 }], 16, 20, 0);
    const ribbon = ribbonOutline(short, RIBBON.body);
    expect(ribbon).not.toBeNull();
    expect(ribbonOutline([], 16)).toBeNull();
  });
});

describe('ribbonBody', () => {
  it('keeps the narrow tail at least 8 px wide on screen', () => {
    for (const scale of [0.5, 0.8, 1, 2, 4]) {
      expect(ribbonBody(scale) * RIBBON.tailRatio * scale).toBeGreaterThanOrEqual(8 - 1e-9);
    }
    expect(ribbonBody(2)).toBe(RIBBON.body);
  });
});

describe('polylinePrefix and dashAlong', () => {
  const line = [A, B];
  it('cuts a polyline at a fraction of its length', () => {
    expect(polylineLength(polylinePrefix(line, 0.25))).toBeCloseTo(50);
    expect(polylinePrefix(line, 0)).toEqual([]);
    expect(polylineLength(polylinePrefix(line, 2))).toBeCloseTo(200);
  });

  it('cuts dashes 9 long with 5 gaps, and the offset runs the pattern', () => {
    const dashes = dashAlong(line, 9, 5, 0);
    expect(dashes[0]).toEqual([A, { x: 9, y: 0 }]);
    expect(dashes[1]?.[0]).toEqual({ x: 14, y: 0 });
    const run = dashAlong(line, 9, 5, 4);
    expect(run[0]).toEqual([A, { x: 5, y: 0 }]);
    expect(dashAlong(line, 9, 5, 4 + 14)[0]).toEqual(run[0]);
  });

  it('lets a dash bend around a corner', () => {
    const dashes = dashAlong([A, { x: 5, y: 0 }, { x: 5, y: 20 }], 9, 5, 0);
    expect(dashes[0]).toEqual([A, { x: 5, y: 0 }, { x: 5, y: 4 }]);
  });

  it('closes a ring', () => {
    const square = [A, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const total = dashAlong(square, 100, 1, 0, true)
      .map(polylineLength)
      .reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(40);
  });
});

describe('chevrons', () => {
  it('puts a chevron 22 from the start, then every 26, not within 10 of the end', () => {
    const marks = chevrons([A, B], 26, 22, 10);
    expect(marks.map((m) => m.at.x)).toEqual([22, 48, 74, 100, 126, 152, 178]);
    expect(marks[0]?.dir).toEqual({ x: 1, y: 0 });
  });
});

describe('chevrons along the whole path', () => {
  const bent = [A, { x: 100, y: 0 }, { x: 100, y: 100 }];

  it('go on over a corner as one flow, not restarted on the second leg', () => {
    const marks = chevrons(bent, 26, 22, 10);
    // 22, 48, 74 on the first leg, 100 is the corner, then 26, 52, 78 into the second.
    expect(marks.map((m) => [m.at.x, m.at.y])).toEqual([
      [22, 0],
      [48, 0],
      [74, 0],
      [100, 0],
      [100, 26],
      [100, 52],
      [100, 78],
    ]);
    expect(marks.at(-1)?.dir).toEqual({ x: 0, y: 1 });
  });

  it('run with the offset: the pattern slides along the whole path and wraps by one spacing', () => {
    const slid = chevrons(bent, 26, 22, 10, 10);
    expect(slid[0]?.at.x).toBe(32);
    expect(slid.some((m) => m.at.x === 100 && m.at.y > 0)).toBe(true);
    expect(chevrons(bent, 26, 22, 10, 26).map((m) => m.at)).toEqual(
      chevrons(bent, 26, 22, 10, 0).map((m) => m.at),
    );
    expect(chevrons(bent, 26, 22, 10, -4)[0]?.at.x).toBe(44);
  });
});

describe('a straight ribbon into the centre of the target', () => {
  it('ends exactly at the target when there is no end gap and no bend', () => {
    const axis = ribbonAxis([A, B], 16, 0, 0);
    expect(axis[0]).toEqual({ x: 16, y: 0 });
    expect(axis.at(-1)).toEqual(B);
    expect(new Set(axis.map((p) => p.y))).toEqual(new Set([0]));
    expect(ribbonOutline(axis, RIBBON.body)?.tip).toEqual(B);
  });
});

describe('ribbonFilled', () => {
  const axis = ribbonAxis([A, B], 16, 0, 0);
  const outline = ribbonOutline(axis, RIBBON.body)?.outline ?? [];
  const maxX = (poly: readonly { x: number }[]): number => Math.max(...poly.map((p) => p.x));

  it('is empty at the start, the whole arrow at the end, and grows from the start to the tip between', () => {
    expect(ribbonFilled(outline, axis, 0)).toEqual([]);
    expect(ribbonFilled(outline, axis, 1)).toEqual(outline);
    const half = ribbonFilled(outline, axis, 0.5);
    // Half of the axis from x = 16 to 200.
    expect(maxX(half)).toBeCloseTo(16 + (200 - 16) / 2);
    expect(Math.min(...half.map((p) => p.x))).toBeCloseTo(Math.min(...outline.map((p) => p.x)));
    const most = ribbonFilled(outline, axis, 0.9);
    expect(maxX(most)).toBeGreaterThan(maxX(half));
  });
});

describe('pathBend', () => {
  it('is 0 without waypoints, signed toward the farthest one, and clamped', () => {
    expect(pathBend(A, B, [], 0.3)).toBe(0);
    expect(pathBend(A, B, [{ x: 100, y: 0 }], 0.3)).toBeCloseTo(0);
    // Left of the way A -> B (same side as ribbonAxis bends for a positive share).
    const left = pathBend(A, B, [{ x: 100, y: 20 }], 0.3);
    const right = pathBend(A, B, [{ x: 100, y: -20 }], 0.3);
    expect(left).toBeCloseTo(0.2);
    expect(right).toBeCloseTo(-0.2);
    expect(pathBend(A, B, [{ x: 100, y: 500 }], 0.3)).toBe(0.3);
    expect(
      pathBend(
        A,
        B,
        [
          { x: 50, y: -5 },
          { x: 150, y: -30 },
        ],
        0.3,
      ),
    ).toBeCloseTo(-0.3);
    // The bend matches the axis: the same sign bends ribbonAxis the same way.
    const axis = ribbonAxis([A, B], 0, 0, left);
    expect(Math.max(...axis.map((p) => p.y))).toBeGreaterThan(15);
  });
});

describe('ribbonFilled on a curve', () => {
  it('cuts across the curved axis: more of the outline with more delay, never past the tip', () => {
    const axis = ribbonAxis([A, B], 16, 0, 0.2);
    const outline = ribbonOutline(axis, RIBBON.body)?.outline ?? [];
    const area = (poly: readonly { x: number; y: number }[]): number =>
      Math.abs(
        poly.reduce((sum, p, i) => {
          const q = poly[(i + 1) % poly.length];
          return sum + (q === undefined ? 0 : p.x * q.y - q.x * p.y);
        }, 0) / 2,
      );
    const a3 = area(ribbonFilled(outline, axis, 0.3));
    const a6 = area(ribbonFilled(outline, axis, 0.6));
    expect(a3).toBeGreaterThan(0);
    expect(a6).toBeGreaterThan(a3);
    expect(a6).toBeLessThan(area(outline));
  });
});

describe('departPulse', () => {
  it('swells once, smoothly: nothing before the delay ends, nothing after the pulse, one peak', () => {
    expect(departPulse(-1, 8, false)).toEqual({ swell: 0, lock: 0 });
    const swells = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((since) => departPulse(since, 8, false).swell);
    expect(swells[0]).toBe(0);
    expect(swells[8]).toBe(0);
    const peak = Math.max(...swells);
    expect(peak).toBeCloseTo(1);
    expect(swells.indexOf(peak)).toBe(4);
    // Rises to the middle and falls after it: one swell, not a blink.
    for (let i = 1; i <= 4; i++) expect(swells[i]).toBeGreaterThan(swells[i - 1] ?? 1);
    for (let i = 5; i <= 8; i++) expect(swells[i]).toBeLessThan(swells[i - 1] ?? 0);
    // No sudden jump between two steps of half a tick.
    for (let since = 0; since < 8; since += 0.5) {
      const step = Math.abs(
        departPulse(since + 0.5, 8, false).swell - departPulse(since, 8, false).swell,
      );
      expect(step).toBeLessThan(0.5);
    }
  });

  it('locks while it swells and stays locked afterwards', () => {
    const locks = [0, 2, 4, 6, 8, 20, 400].map((since) => departPulse(since, 8, false).lock);
    expect(locks[0]).toBe(0);
    expect(locks[4]).toBe(1);
    expect(locks[5]).toBe(1);
    expect(locks[6]).toBe(1);
    for (let i = 1; i < locks.length; i++) {
      expect(locks[i]).toBeGreaterThanOrEqual(locks[i - 1] ?? 0);
    }
  });

  it('with less motion has no swell and locks at once', () => {
    expect(departPulse(0, 8, true)).toEqual({ swell: 0, lock: 1 });
    expect(departPulse(3, 8, true)).toEqual({ swell: 0, lock: 1 });
    expect(departPulse(-1, 8, true)).toEqual({ swell: 0, lock: 0 });
  });
});

describe('orderBend', () => {
  it('keeps a pronounced path bend that already bulges up', () => {
    // Going right the arc bulges up with a negative bend, going left with a positive one.
    expect(orderBend(100, -0.25, 0.12, -0.45)).toBe(-0.25);
    expect(orderBend(-100, 0.2, 0.12, -0.45)).toBe(0.2);
  });

  it('turns a path bend that bulges down into the fixed arc up', () => {
    expect(orderBend(100, 0.25, 0.12, -0.45)).toBe(-0.45);
    expect(orderBend(-100, -0.25, 0.12, -0.45)).toBe(0.45);
  });

  it('gives a straight or nearly straight way the arc up, whichever way it goes', () => {
    expect(orderBend(100, 0, 0.12, -0.45)).toBe(-0.45);
    expect(orderBend(100, -0.05, 0.12, -0.45)).toBe(-0.45);
    expect(orderBend(-100, 0, 0.12, -0.45)).toBe(0.45);
    expect(orderBend(-100, 0.11, 0.12, -0.45)).toBe(0.45);
  });

  it('keeps the sign of the arc for a vertical way', () => {
    expect(orderBend(0, 0, 0.12, -0.45)).toBe(-0.45);
  });

  it('puts the middle of the arc above the chord in both directions, and both arcs on one side', () => {
    const bend = (dx: number) => orderBend(dx, 0, RIBBON.minBend, RIBBON.arcBend);
    const there = ribbonAxis([A, B], 0, 0, bend(B.x - A.x));
    const back = ribbonAxis([B, A], 0, 0, bend(A.x - B.x));
    const mid = (axis: readonly { y: number }[]): number => Math.min(...axis.map((p) => p.y));
    // y down on the screen: above the chord is negative.
    expect(mid(there)).toBeLessThan(-RIBBON.body);
    expect(mid(back)).toBeLessThan(-RIBBON.body);
    expect(mid(there)).toBeCloseTo(mid(back));
  });
});

describe('tailStart', () => {
  it('begins 22 outside the circle when nothing is in the way', () => {
    // Going right, the barracks mark on the left is far from the tail.
    expect(tailStart({ x: 0, y: 0 }, { x: 200, y: 0 }, 17)).toBe(17 + RIBBON.startGap);
  });

  it('is pushed on until the tail is 26 clear of the barracks mark on the left', () => {
    const radius = 17;
    const slot = barracksAt(radius);
    // Going left, along the B1 column: the tail would start on the mark.
    const gap = tailStart({ x: 0, y: 0 }, { x: -200, y: 0 }, radius);
    expect(gap).toBeGreaterThan(radius + RIBBON.startGap);
    expect(Math.hypot(-gap - slot.x, -slot.y)).toBeGreaterThanOrEqual(RIBBON.slotClear);
    // One step less would have been too close, unless it is the first step.
    expect(Math.hypot(-(gap - 3) - slot.x, -slot.y)).toBeLessThan(RIBBON.slotClear);
    // It never runs away.
    expect(gap).toBeLessThanOrEqual(radius + RIBBON.startMax);
  });

  it('is pushed on until the tail is 20 clear of the VP badge at the upper right', () => {
    const radius = 17;
    const badge = vpBadgeAt(radius);
    // Along the diagonal of the badge: the plain start would be on it.
    const dir = { x: Math.SQRT1_2, y: -Math.SQRT1_2 };
    const gap = tailStart({ x: 0, y: 0 }, { x: dir.x * 300, y: dir.y * 300 }, radius);
    expect(gap).toBeGreaterThan(radius + RIBBON.startGap);
    expect(Math.hypot(dir.x * gap - badge.x, dir.y * gap - badge.y)).toBeGreaterThanOrEqual(
      RIBBON.badgeClear,
    );
    expect(gap).toBeLessThanOrEqual(radius + RIBBON.startMax);
  });

  it('survives two cities in one place', () => {
    expect(tailStart(A, A, 14)).toBe(14 + RIBBON.startGap);
  });
});

describe('signRim', () => {
  it('is the outer edge of the capacity ring', () => {
    expect(signRim(17)).toBeCloseTo(17 + 7 + 3.5);
    expect(signRim(20)).toBeGreaterThan(signRim(14));
  });
});

describe('axisPoint', () => {
  const line = ribbonAxis([A, B], 0, 0, 0);

  it('finds a point at a distance along the axis, with its direction', () => {
    const p = axisPoint(line, 50);
    expect(p?.at.x).toBeCloseTo(50);
    expect(p?.dir).toEqual({ x: 1, y: 0 });
  });

  it('clamps to the ends', () => {
    expect(axisPoint(line, -5)?.at.x).toBeCloseTo(0);
    expect(axisPoint(line, 999)?.at.x).toBeCloseTo(200);
    expect(axisPoint([], 3)).toBeNull();
  });
});

describe('ribbonHalfWidth', () => {
  it('follows ribbonOutline: tail 60%, full body at the base of the head, the head down to the tip', () => {
    const total = 200;
    expect(ribbonHalfWidth(total, 0, 16)).toBeCloseTo(8 * RIBBON.tailRatio);
    expect(ribbonHalfWidth(total, total - 30 - 0.001, 16)).toBeCloseTo(8, 1);
    expect(ribbonHalfWidth(total, total - 30 + 0.001, 16)).toBeCloseTo(19, 1);
    expect(ribbonHalfWidth(total, total, 16)).toBeCloseTo(0);
    // A short ribbon has a smaller head.
    expect(ribbonHalfWidth(40, 28, 16)).toBeLessThan(19);
  });
});

describe('frontLine', () => {
  const axis = ribbonAxis([A, B], 0, 0, 0);

  it('crosses the ribbon at the front of the fill, a little short of both edges', () => {
    const line = frontLine(axis, 0.5, RIBBON.body);
    expect(line).not.toBeNull();
    if (line === null) return;
    const [p, q] = line;
    expect(p.x).toBeCloseTo(100);
    expect(q.x).toBeCloseTo(100);
    // Half the body at the middle of a 200 long ribbon with a 30 head: 60% + 40% * 100 / 170.
    const half = 8 * (RIBBON.tailRatio + (1 - RIBBON.tailRatio) * (100 / 170)) - RIBBON.front.inset;
    expect(Math.abs(p.y - q.y)).toBeCloseTo(2 * half);
  });

  it('is none at either end', () => {
    expect(frontLine(axis, 0, RIBBON.body)).toBeNull();
    expect(frontLine(axis, 1, RIBBON.body)).toBeNull();
  });
});

describe('sheenSpan and sheenPhase', () => {
  it('runs one band of 18 from before the tail to past the tip', () => {
    // Before the tail the band is clipped to nothing.
    expect(sheenSpan(200, 0)).toBeNull();
    const early = sheenSpan(200, 30 / 230);
    expect(early?.from).toBe(0);
    expect((early?.to ?? 0) * 200).toBeCloseTo(18);
    const mid = sheenSpan(200, 0.5);
    expect(((mid?.to ?? 0) - (mid?.from ?? 0)) * 200).toBeCloseTo(18);
    // Past the tip the band is cut at it.
    const late = sheenSpan(200, 215 / 230);
    expect(late?.to).toBe(1);
    expect(((late?.to ?? 0) - (late?.from ?? 0)) * 200).toBeLessThan(18);
    expect(sheenSpan(200, 1)).toBeNull();
    expect(sheenSpan(0, 0.5)).toBeNull();
  });

  it('repeats every 1.8 s', () => {
    const p = RIBBON.sheen.periodS;
    expect(sheenPhase(0)).toBe(0);
    expect(sheenPhase(p / 2)).toBeCloseTo(0.5);
    expect(sheenPhase(p * 3 + p / 4)).toBeCloseTo(0.25);
    expect(sheenPhase(-p / 4)).toBeCloseTo(0.75);
  });
});

describe('ribbonSlice', () => {
  const axis = ribbonAxis([A, B], 16, 0, 0);
  const outline = ribbonOutline(axis, RIBBON.body)?.outline ?? [];

  it('cuts the band of the ribbon between two shares of its axis', () => {
    const band = ribbonSlice(outline, axis, 0.25, 0.5);
    expect(band.length).toBeGreaterThanOrEqual(3);
    expect(Math.min(...band.map((p) => p.x))).toBeCloseTo(16 + (200 - 16) * 0.25);
    expect(Math.max(...band.map((p) => p.x))).toBeCloseTo(16 + (200 - 16) * 0.5);
    // Inside the ribbon: never wider than its body.
    expect(Math.max(...band.map((p) => Math.abs(p.y)))).toBeLessThanOrEqual(8 + 1e-6);
  });

  it('is empty for an empty band', () => {
    expect(ribbonSlice(outline, axis, 0.5, 0.5)).toEqual([]);
    expect(ribbonSlice(outline, axis, 0.6, 0.5)).toEqual([]);
  });
});

describe('bonusSpot', () => {
  const axis = ribbonAxis([A, B], 16, 25, -0.45);

  it('sits 62 before the end of the arc, on its outer side, clear of the body', () => {
    const spot = bonusSpot(axis, -0.45, RIBBON.body, 10);
    const on = axisPoint(axis, Math.max(20, polylineLength(axis) - 62));
    if (spot === null || on === null) throw new Error('no spot');
    // Going right with a negative bend: the outer side is up (negative y).
    expect(spot.y).toBeLessThan(on.at.y);
    expect(Math.hypot(spot.x - on.at.x, spot.y - on.at.y)).toBeCloseTo(8 + RIBBON.bonusMargin + 10);
  });

  it('flips with the bend: an arrow going left bulges up with a positive bend, the pill goes up too', () => {
    const back = ribbonAxis([B, A], 16, 25, 0.45);
    const spot = bonusSpot(back, 0.45, RIBBON.body, 10);
    const on = axisPoint(back, Math.max(20, polylineLength(back) - 62));
    if (spot === null || on === null) throw new Error('no spot');
    expect(spot.y).toBeLessThan(on.at.y);
  });

  it('is none without an axis', () => {
    expect(bonusSpot([], -0.45, RIBBON.body, 10)).toBeNull();
  });
});

describe('the dashed ring round the target of an opponent order', () => {
  const dashes = ringDashes({ x: 100, y: 50 }, 40);
  const points = dashes.flat();

  it('is dashed 5 / 4 and stays on the circle', () => {
    expect(dashes.length).toBeGreaterThan(10);
    for (const p of points) expect(Math.hypot(p.x - 100, p.y - 50)).toBeCloseTo(40, 0);
    expect(polylineLength(dashes[0] ?? [])).toBeCloseTo(RIBBON.ring.dash, 0);
  });

  it('is open at the bottom, for the caption of the city', () => {
    // Nothing within the opening straight under the centre.
    const below = points.filter(
      (p) => p.y > 50 && Math.abs(p.x - 100) < 40 * Math.sin(RIBBON.ring.open) - 1,
    );
    expect(below).toEqual([]);
    // And it does go right round the other way: points above, left and right.
    expect(points.some((p) => p.y < 50 - 39)).toBe(true);
    expect(points.some((p) => p.x < 100 - 39)).toBe(true);
    expect(points.some((p) => p.x > 100 + 39)).toBe(true);
  });
});

describe('ringOpacity: the pulse of the ring over an own city', () => {
  const { pulseS, pulseLow } = RIBBON.ring;

  it('swells from the low value to 1 and back once every 0.9 s', () => {
    expect(ringOpacity(0, false)).toBeCloseTo(pulseLow);
    expect(ringOpacity(pulseS / 2, false)).toBeCloseTo(1);
    expect(ringOpacity(pulseS, false)).toBeCloseTo(pulseLow);
    expect(ringOpacity(-pulseS / 2, false)).toBeCloseTo(1);
  });

  it('holds still, fully opaque, with "less motion"', () => {
    expect(ringOpacity(0, true)).toBe(1);
    expect(ringOpacity(0.31, true)).toBe(1);
  });
});

describe('delay', () => {
  it('runs from 0 at creation to 1 after planned_delay_ticks (30 in mvp-0)', () => {
    expect(delayProgress(100, 100, 30)).toBe(0);
    expect(delayProgress(100, 115, 30)).toBe(0.5);
    expect(delayProgress(100, 140, 30)).toBe(1);
    expect(delayProgress(100, 90, 30)).toBe(0);
    expect(delayProgress(100, 100, 0)).toBe(1);
  });

  it('counts the ticks left down to zero', () => {
    expect(delayLeft(100, 100, 30)).toBe(30);
    expect(delayLeft(100, 112.6, 30)).toBe(18);
    expect(delayLeft(100, 200, 30)).toBe(0);
  });
});

describe('ghostLook', () => {
  it('is dashed while pending and solid once accepted', () => {
    expect(ghostLook('pending', 0, 0.85, false)).toEqual({ dx: 0, alpha: 0.85, solid: false });
    expect(ghostLook('accepted', 0, 0.85, false).solid).toBe(true);
  });

  it('shakes 200 ms, then fades to nothing', () => {
    const early = ghostLook('rejected', 25, 0.85, false);
    expect(early.dx).not.toBe(0);
    expect(early.alpha).toBe(0.85);
    expect(ghostLook('rejected', GHOST_SHAKE_MS, 0.85, false).dx).toBe(0);
    const mid = ghostLook('rejected', (GHOST_SHAKE_MS + GHOST_REJECT_MS) / 2, 0.85, false);
    expect(mid.alpha).toBeCloseTo(0.425);
    expect(ghostLook('rejected', GHOST_REJECT_MS, 0.85, false).alpha).toBe(0);
  });

  it('does not shake with less motion', () => {
    expect(ghostLook('rejected', 25, 0.85, true).dx).toBe(0);
  });
});
