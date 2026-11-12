import { describe, expect, it } from 'vitest';
import {
  BRACKETS,
  CARTOUCHE_H,
  CARTOUCHE_MID,
  CARTOUCHE_W,
  PIXEL_PAD,
  PLATE,
  SERIF_CASING,
  SERIF_HOLE,
  SERIF_INK,
  SERIF_SWELL,
  SERIF_X,
  figureNudge,
  innerRule,
  outerRule,
  pixelLozenge,
  type Rect,
} from './cartouche.ts';

const key = (r: Rect): string => `${String(r.x)},${String(r.y)},${String(r.w)},${String(r.h)}`;
const mirrorX = (r: Rect): Rect => ({ ...r, x: CARTOUCHE_W - r.x - r.w });
const mirrorY = (r: Rect): Rect => ({ ...r, y: CARTOUCHE_H - r.y - r.h });
const sameSet = (a: readonly Rect[], b: readonly Rect[]): boolean =>
  JSON.stringify(a.map(key).sort()) === JSON.stringify(b.map(key).sort());

/** The pixels a set of rects covers, each counted once per rect. */
function pixels(rects: readonly Rect[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rects) {
    for (let x = r.x; x < r.x + r.w; x++) {
      for (let y = r.y; y < r.y + r.h; y++) {
        const k = `${String(x)},${String(y)}`;
        out.set(k, (out.get(k) ?? 0) + 1);
      }
    }
  }
  return out;
}

describe('the match clock cartouche (#1005, T3): even, with no skew', () => {
  const sets: [string, readonly Rect[]][] = [
    ['outer', outerRule(false)],
    ['outer dashed', outerRule(true)],
    ['inner', innerRule(false)],
    ['inner dashed', innerRule(true)],
    ['brackets', BRACKETS],
    ['plate', [PLATE]],
  ];

  it('sits on whole pixels: even sides, every rule, dash and bracket a whole-pixel rect', () => {
    expect(CARTOUCHE_W % 2).toBe(0);
    expect(CARTOUCHE_H % 2).toBe(0);
    for (const [, rects] of sets) {
      for (const r of rects) {
        for (const v of [r.x, r.y, r.w, r.h]) expect(Number.isInteger(v)).toBe(true);
      }
    }
  });

  it('is mirror-symmetric about both middle lines in every state', () => {
    for (const [name, rects] of sets) {
      expect(sameSet(rects.map(mirrorX), rects), name).toBe(true);
      expect(sameSet(rects.map(mirrorY), rects), name).toBe(true);
    }
  });

  it('paints no pixel of a rule twice (no darker corners under the translucent ink)', () => {
    for (const [name, rects] of sets) {
      for (const count of pixels(rects).values()) expect(count, name).toBe(1);
    }
  });

  it('dashes every side of a paused frame from a whole dash to a whole dash', () => {
    const solid = pixels(outerRule(false));
    const dashed = pixels(outerRule(true));
    // The four corners are inked in both.
    for (const corner of ['8,1', '101,1', '8,42', '101,42']) {
      expect(solid.has(corner)).toBe(true);
      expect(dashed.has(corner)).toBe(true);
    }
    expect(dashed.size).toBeLessThan(solid.size);
    expect(pixels(innerRule(true)).size).toBeLessThan(pixels(innerRule(false)).size);
  });

  it('puts the serifs on the outer rule, mirrored, on the middle line', () => {
    expect(SERIF_X[0] + SERIF_X[1]).toBe(CARTOUCHE_W);
    expect(CARTOUCHE_MID).toBe(CARTOUCHE_H / 2);
    expect(outerRule(false).some((r) => r.x === SERIF_X[0] - 0.5 && r.h > 1)).toBe(true);
  });

  it('draws pixel lozenges that are symmetric both ways and grow with the half-diagonal', () => {
    let previous = 0;
    for (const r of [SERIF_HOLE, SERIF_INK, SERIF_SWELL, SERIF_CASING]) {
      const rows = pixelLozenge(SERIF_X[0], CARTOUCHE_MID, r + PIXEL_PAD);
      const flipX = rows.map((p) => ({ ...p, x: 2 * SERIF_X[0] - p.x - p.w }));
      const flipY = rows.map((p) => ({ ...p, y: 2 * CARTOUCHE_MID - p.y - p.h }));
      expect(sameSet(flipX, rows)).toBe(true);
      expect(sameSet(flipY, rows)).toBe(true);
      const size = pixels(rows).size;
      expect(size).toBeGreaterThan(previous);
      previous = size;
    }
    // The ink: rows of 1, 3, 5, 7 pixels each side of the middle line.
    const ink = pixelLozenge(SERIF_X[0], CARTOUCHE_MID, SERIF_INK + PIXEL_PAD);
    expect(ink.map((p) => p.w).sort((a, b) => a - b)).toEqual([1, 1, 3, 3, 5, 5, 7, 7]);
  });

  it('keeps every polygon corner on a device pixel at a ratio of 2', () => {
    for (const r of [SERIF_HOLE, SERIF_INK, SERIF_SWELL, SERIF_CASING]) {
      for (const v of [SERIF_X[0] + r, SERIF_X[0] - r, CARTOUCHE_MID + r]) {
        expect(Number.isInteger(v * 2)).toBe(true);
      }
    }
  });
});

describe('figureNudge: the figures centred by their ink', () => {
  it('moves figures that lead with a 1 left, by its wide left bearing', () => {
    expect(figureNudge('11:04', 400)).toBeCloseTo(-0.0325, 4);
    expect(figureNudge('1:00', 700)).toBeCloseTo(-0.0335, 4);
  });

  it('hardly moves figures that lead with a narrow bearing', () => {
    expect(Math.abs(figureNudge('0:59', 700))).toBeLessThan(0.002);
    expect(Math.abs(figureNudge('7:43', 400))).toBeLessThan(0.005);
  });

  it('depends on the leading digit only, so the running seconds never move the figures', () => {
    for (let s = 0; s < 60; s++) {
      const text = `9:${String(s).padStart(2, '0')}`;
      expect(figureNudge(text, 400)).toBe(figureNudge('9:00', 400));
    }
  });
});
