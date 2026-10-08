import { describe, expect, it } from 'vitest';
import {
  chevrons,
  dashAlong,
  delayLeft,
  delayProgress,
  ghostLook,
  polylineLength,
  polylinePrefix,
  ribbonAxis,
  ribbonBody,
  ribbonOutline,
} from './intentLayout.ts';
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
