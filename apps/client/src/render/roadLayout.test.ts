import { describe, expect, it } from 'vitest';
import {
  buildProgress,
  dashRuns,
  laneDashes,
  laneOffsets,
  roadKind,
  roadSegments,
  roadStyle,
  tapeStripes,
} from './roadLayout.ts';

describe('the lanes of a road: the level is the number of lanes', () => {
  it('centres one, two or three lanes on the axis, 3.7 apart', () => {
    expect(laneOffsets(1)).toEqual([0]);
    expect(laneOffsets(2).map((y) => +y.toFixed(2))).toEqual([-1.85, 1.85]);
    expect(laneOffsets(3).map((y) => +y.toFixed(2))).toEqual([-3.7, 0, 3.7]);
  });

  it('never has fewer than one lane, and rounds a level that is not whole', () => {
    expect(laneOffsets(0)).toEqual([0]);
    expect(laneOffsets(2.4)).toHaveLength(2);
  });
});

describe('the kind and the style of a road', () => {
  it('is internal only when both ends belong to one player', () => {
    expect(roadKind(0, 0)).toEqual({ kind: 'internal', owner: 0 });
    expect(roadKind(1, 1)).toEqual({ kind: 'internal', owner: 1 });
    expect(roadKind(0, 1)).toEqual({ kind: 'buffer' });
    expect(roadKind(0, null)).toEqual({ kind: 'buffer' });
    expect(roadKind(null, null)).toEqual({ kind: 'buffer' });
  });

  it('picks the style: solid on a band for an internal road, dashed for a buffer, dotted in fog', () => {
    const own = roadKind(0, 0);
    const buffer = roadKind(0, 1);
    expect(roadStyle(own, false)).toBe('own0');
    expect(roadStyle(roadKind(1, 1), false)).toBe('own1');
    expect(roadStyle(buffer, false)).toBe('buffer');
    // Fog wins over the kind: nothing is known of the owners of a road in fog.
    expect(roadStyle(own, true)).toBe('fog');
    expect(roadStyle(buffer, true)).toBe('fog');
  });
});

describe('the stretches of a road (the halves, DEC-21)', () => {
  const own = roadKind(0, 0);

  it('is one stretch while both halves are alike', () => {
    expect(roadSegments(own, [false, false], 0.5)).toEqual([{ from: 0, to: 1, style: 'own0' }]);
    expect(roadSegments(own, [true, true], 0.5)).toEqual([{ from: 0, to: 1, style: 'fog' }]);
  });

  it('splits at the border point when one half is in fog', () => {
    expect(roadSegments(own, [false, true], 0.5)).toEqual([
      { from: 0, to: 0.5, style: 'own0' },
      { from: 0.5, to: 1, style: 'fog' },
    ]);
    expect(roadSegments(roadKind(0, 1), [true, false], 0.4)).toEqual([
      { from: 0, to: 0.4, style: 'fog' },
      { from: 0.4, to: 1, style: 'buffer' },
    ]);
  });
});

describe('dashes', () => {
  it('cuts a length into dashes, the last one shortened', () => {
    expect(dashRuns(25, 10, 5)).toEqual([
      [0, 10],
      [15, 25],
    ]);
    expect(dashRuns(22, 10, 5)).toEqual([
      [0, 10],
      [15, 22],
    ]);
  });

  it('draws nothing for no length or no dash', () => {
    expect(dashRuns(0, 10, 5)).toEqual([]);
    expect(dashRuns(10, 0, 5)).toEqual([]);
  });
});

describe('the part of a build that is done', () => {
  it('grows from 0 to 1 over the ticks a level takes', () => {
    expect(buildProgress(150, 0, 150)).toBe(0);
    expect(buildProgress(150, 75, 150)).toBe(0.5);
    expect(buildProgress(150, 150, 150)).toBe(1);
  });

  it('stays within 0..1, and is 0 where the duration is not known', () => {
    expect(buildProgress(150, 200, 150)).toBe(1);
    expect(buildProgress(400, 0, 150)).toBe(0);
    expect(buildProgress(150, 75, 0)).toBe(0);
  });
});

describe('the stripes of the tape', () => {
  it('cuts the stripes to the road: nothing before its start or past its end, none empty', () => {
    const stripes = tapeStripes(60, 12, 11, 5.5);
    expect(stripes.length).toBeGreaterThan(4);
    for (const polygon of stripes) {
      expect(polygon.length).toBeGreaterThanOrEqual(3);
      for (const p of polygon) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(60);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(6);
      }
    }
  });

  it('leans at 45 degrees: a stripe moves along by its height across the road', () => {
    const [first] = tapeStripes(200, 12, 40, 5);
    // The stripe that starts at x = 0 at the top edge reaches x = 12 at the bottom edge.
    const xs = (first ?? []).map((p) => +p.x.toFixed(2));
    expect(Math.max(...xs)).toBeGreaterThan(Math.min(...xs));
  });

  it('draws nothing for a road without length or width', () => {
    expect(tapeStripes(0, 12, 11, 5)).toEqual([]);
    expect(tapeStripes(50, 0, 11, 5)).toEqual([]);
  });
});

describe('the dashes of the lanes of a stretch of road', () => {
  const origin = { x: 10, y: 20 };

  it('cuts every lane into dashes and puts them on the line of the road', () => {
    const quads = laneDashes(origin, 0, 25, 2, 10, 5, 2);
    // Two lanes of two dashes each (0-10 and 15-25 along the road).
    expect(quads).toHaveLength(4);
    const first = quads[0] ?? [];
    expect(first.map((p) => [p.x, +p.y.toFixed(2)])).toEqual([
      [10, 20 - 1.85 - 1],
      [20, 20 - 1.85 - 1],
      [20, 20 - 1.85 + 1],
      [10, 20 - 1.85 + 1],
    ]);
  });

  it('follows the angle of the road, across it and along it', () => {
    // A road running down the page (+y): the lanes lie on the sides of it (x), the dashes along y.
    const [quad] = laneDashes(origin, Math.PI / 2, 10, 1, 4, 2, 2);
    expect(quad?.map((p) => [+p.x.toFixed(2), +p.y.toFixed(2)])).toEqual([
      [11, 20],
      [11, 24],
      [9, 24],
      [9, 20],
    ]);
  });

  it('has no dash for a stretch without length', () => {
    expect(laneDashes(origin, 0, 0, 3, 10, 5, 2)).toEqual([]);
  });
});
