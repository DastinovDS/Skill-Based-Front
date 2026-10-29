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
  enemyArrowWidth,
  enemyHead,
  reticleLook,
  reticlePhase,
} from './intentLayout.ts';
import {
  GHOST_REJECT_MS,
  GHOST_SHAKE_MS,
  INTENT_ENEMY,
  INTENT_RETICLE,
  INTENT_TARGET_RING,
  RIBBON,
} from './style.ts';

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
  it('keeps a pronounced path bend on either side', () => {
    expect(orderBend(0.25, 0.12, -0.45)).toBe(0.25);
    expect(orderBend(-0.2, 0.12, -0.45)).toBe(-0.2);
  });

  it('gives a straight or nearly straight way the arc to the left, always the same side', () => {
    expect(orderBend(0, 0.12, -0.45)).toBe(-0.45);
    expect(orderBend(0.05, 0.12, -0.45)).toBe(-0.45);
    expect(orderBend(-0.11, 0.12, -0.45)).toBe(-0.45);
  });

  it('opposite orders along one road bend away from each other and do not overlap', () => {
    const A = { x: 0, y: 0 };
    const B = { x: 200, y: 0 };
    const bend = orderBend(0, RIBBON.minBend, RIBBON.arcBend);
    const there = ribbonAxis([A, B], 0, 0, bend);
    const back = ribbonAxis([B, A], 0, 0, bend);
    const sideOf = (axis: readonly { y: number }[]): number =>
      Math.sign(axis.reduce((sum, p) => sum + p.y, 0));
    expect(sideOf(there)).not.toBe(0);
    expect(sideOf(there)).toBe(-sideOf(back));
    // Travelling east (y down on the screen) the arc swings north: to the left of the way.
    expect(sideOf(there)).toBe(-1);
    // The middle of each arc is well off the road: farther than the half-width of the ribbon.
    const mid = (axis: readonly { y: number }[]): number =>
      Math.abs(axis[(axis.length - 1) / 2]?.y ?? 0);
    expect(mid(there)).toBeGreaterThan(RIBBON.body);
    expect(mid(there)).toBeCloseTo(mid(back));
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

describe('reticlePhase: the pulse of the crosshair (IN3, #353)', () => {
  const { periodS } = INTENT_RETICLE.pulse;

  it('swells from 0 to 1 and back once every 0.8 s', () => {
    expect(reticlePhase(0, false)).toBeCloseTo(0);
    expect(reticlePhase(periodS / 2, false)).toBeCloseTo(1);
    expect(reticlePhase(periodS, false)).toBeCloseTo(0);
    expect(reticlePhase(periodS * 7 + periodS / 4, false)).toBeCloseTo(0.5);
  });

  it('holds still halfway with "less motion"', () => {
    expect(reticlePhase(0, true)).toBe(0.5);
    expect(reticlePhase(1.7, true)).toBe(0.5);
  });

  it('survives a time before the start', () => {
    expect(reticlePhase(-periodS / 2, false)).toBeCloseTo(1);
  });
});

describe('reticleLook: the crosshair on the target of an opponent intent', () => {
  it('has the outer ring a gap outside the city circle and the inner ring inside it', () => {
    const look = reticleLook(17, 0);
    expect(look.ring).toBe(17 + INTENT_TARGET_RING.gap);
    expect(look.inner).toBe(look.ring - INTENT_RETICLE.innerGap);
  });

  it('has four ticks at the quarters, each across the outer ring', () => {
    const look = reticleLook(17, 0);
    expect(look.ticks).toHaveLength(4);
    for (const tick of look.ticks) {
      expect(Math.hypot(tick.from.x, tick.from.y)).toBeCloseTo(look.ring - INTENT_RETICLE.tick.in);
      expect(Math.hypot(tick.to.x, tick.to.y)).toBeCloseTo(look.ring + INTENT_RETICLE.tick.out);
    }
    const angles = look.ticks.map((t) => Math.round((Math.atan2(t.to.y, t.to.x) * 180) / Math.PI));
    expect(angles).toEqual([0, 90, 180, -90]);
  });

  it('swells the halo with the phase: bigger, brighter, wider', () => {
    const low = reticleLook(17, 0).halo;
    const high = reticleLook(17, 1).halo;
    expect(high.radius).toBeGreaterThan(low.radius);
    expect(high.alpha).toBeGreaterThan(low.alpha);
    expect(high.width).toBeGreaterThan(low.width);
    expect(low.alpha).toBeCloseTo(INTENT_RETICLE.pulse.alphaLow);
  });

  it('does not move the rings or the ticks with the phase', () => {
    expect(reticleLook(17, 0).ring).toBe(reticleLook(17, 1).ring);
    expect(reticleLook(17, 0).ticks).toEqual(reticleLook(17, 1).ticks);
  });
});

describe('the thin arrow of an opponent intent', () => {
  it('is thin: at most 3 units, a third of the own ribbon body', () => {
    expect(enemyArrowWidth(0)).toBe(INTENT_ENEMY.width);
    expect(enemyArrowWidth(1)).toBeCloseTo(INTENT_ENEMY.width + INTENT_ENEMY.lockedExtra);
    expect(enemyArrowWidth(1)).toBeLessThanOrEqual(3);
    expect(enemyArrowWidth(1)).toBeLessThan(RIBBON.body / 3);
  });

  it('thickens as the order locks, and no further than locked', () => {
    expect(enemyArrowWidth(0.5)).toBeGreaterThan(enemyArrowWidth(0));
    expect(enemyArrowWidth(4)).toBe(enemyArrowWidth(1));
    expect(enemyArrowWidth(-1)).toBe(enemyArrowWidth(0));
  });

  it('has the head at the tip, pointing along the direction', () => {
    const [tip, left, right] = enemyHead({ x: 100, y: 50 }, { x: 1, y: 0 });
    expect(tip).toEqual({ x: 100, y: 50 });
    expect(left.x).toBeCloseTo(100 - INTENT_ENEMY.head.length);
    expect(right.x).toBeCloseTo(left.x);
    expect(Math.abs(left.y - right.y)).toBeCloseTo(2 * INTENT_ENEMY.head.half);
  });
});
