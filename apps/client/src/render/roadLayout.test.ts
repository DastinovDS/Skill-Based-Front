import { describe, expect, it } from 'vitest';
import { dashRuns, laneDashes, roadKind, roadSegments, roadStyle } from './roadLayout.ts';

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

describe('the dashes of the lane of a stretch of road', () => {
  const origin = { x: 10, y: 20 };

  it('cuts the lane into dashes and puts them on the line of the road', () => {
    const quads = laneDashes(origin, 0, 25, 10, 5, 2);
    // Two dashes (0-10 and 15-25 along the road).
    expect(quads).toHaveLength(2);
    const first = quads[0] ?? [];
    expect(first.map((p) => [p.x, p.y])).toEqual([
      [10, 19],
      [20, 19],
      [20, 21],
      [10, 21],
    ]);
  });

  it('follows the angle of the road, across it and along it', () => {
    // A road running down the page (+y): the lane lies on the sides of it (x), the dashes along y.
    const [quad] = laneDashes(origin, Math.PI / 2, 10, 4, 2, 2);
    expect(quad?.map((p) => [+p.x.toFixed(2), +p.y.toFixed(2)])).toEqual([
      [11, 20],
      [11, 24],
      [9, 24],
      [9, 20],
    ]);
  });

  it('has no dash for a stretch without length', () => {
    expect(laneDashes(origin, 0, 0, 10, 5, 2)).toEqual([]);
  });
});
