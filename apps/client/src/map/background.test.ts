import { describe, expect, it } from 'vitest';
import type { MapSummary } from '../api/http.ts';
import { backgroundUrlOf } from './background.ts';

const summary = (id: string, background_url: string | null): MapSummary =>
  ({ id, version: 1, width: 100, height: 100, background_url }) satisfies MapSummary;

describe('backgroundUrlOf', () => {
  it('returns the URL the server states for the map', async () => {
    const api = {
      maps: () =>
        Promise.resolve([
          summary('crossroads', '/api/maps/crossroads/background.webp'),
          summary('ridge', null),
        ]),
    };
    expect(await backgroundUrlOf(api, 'crossroads')).toBe('/api/maps/crossroads/background.webp');
  });

  it('is null for a map without a background or outside the pool', async () => {
    const api = { maps: () => Promise.resolve([summary('ridge', null)]) };
    expect(await backgroundUrlOf(api, 'ridge')).toBeNull();
    expect(await backgroundUrlOf(api, 'gone')).toBeNull();
  });

  it('is null when the list cannot be loaded', async () => {
    const api = { maps: () => Promise.reject(new Error('network')) };
    expect(await backgroundUrlOf(api, 'ridge')).toBeNull();
  });
});
