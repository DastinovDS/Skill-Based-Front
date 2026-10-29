import { describe, expect, it } from 'vitest';
import { GEO_FILE, GEO_MAP } from '../render/geoFixture.ts';
import { geoOf, usableGeo } from './geography.ts';

describe('usableGeo', () => {
  it('takes a file baked from this version of this map', () => {
    expect(usableGeo(GEO_MAP, GEO_FILE)).toEqual(GEO_FILE);
  });

  it('ignores a file of another version of the map (the Voronoi cells take over)', () => {
    expect(usableGeo(GEO_MAP, { ...GEO_FILE, version: 3 })).toBeNull();
    expect(usableGeo({ ...GEO_MAP, meta: { ...GEO_MAP.meta, version: 5 } }, GEO_FILE)).toBeNull();
  });

  it('ignores a file of another map', () => {
    expect(usableGeo(GEO_MAP, { ...GEO_FILE, map: 'other' })).toBeNull();
  });

  it('ignores malformed files', () => {
    expect(usableGeo(GEO_MAP, null)).toBeNull();
    expect(usableGeo(GEO_MAP, 'text')).toBeNull();
    expect(usableGeo(GEO_MAP, { ...GEO_FILE, chains: [] })).toBeNull();
    expect(
      usableGeo(GEO_MAP, { ...GEO_FILE, chains: [{ l: 0, r: 'sea', pts: [0, 0, 1, 1] }] }),
    ).toBeNull();
    expect(
      usableGeo(GEO_MAP, { ...GEO_FILE, chains: [{ l: 0, r: 1, pts: [0, 0, 1] }] }),
    ).toBeNull();
    expect(
      usableGeo(GEO_MAP, { ...GEO_FILE, chains: [{ l: 0, r: 1, pts: [0, 0, 'x', 1] }] }),
    ).toBeNull();
  });
});

describe('geoOf', () => {
  it('is null for a map with no vector file in the repository', async () => {
    expect(await geoOf(GEO_MAP)).toBeNull();
  });
});
