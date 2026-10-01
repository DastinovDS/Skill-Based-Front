import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_RAW } from './fixture.ts';
import { loadReplay, replayUrl } from './loadReplay.ts';

const answer = (status: number, body: unknown = {}): typeof fetch =>
  vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

describe('loadReplay', () => {
  it('fetches and parses the frames file of the match', async () => {
    const fetchFn = answer(200, SAMPLE_RAW);
    const file = await loadReplay('42', null, fetchFn);
    expect(file.map_id).toBe('siege');
    expect(fetchFn).toHaveBeenCalledWith('/api/replays/42', { headers: {} });
  });

  it('sends the guest token of a private match', async () => {
    const fetchFn = answer(200, SAMPLE_RAW);
    await loadReplay('42', 'tok', fetchFn);
    expect(fetchFn).toHaveBeenCalledWith('/api/replays/42', {
      headers: { Authorization: 'Bearer tok' },
    });
  });

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [404, 'missing'],
    [500, 'network'],
  ])('maps HTTP %i to %s', async (status, code) => {
    await expect(loadReplay('1', null, answer(status))).rejects.toMatchObject({ code });
  });

  it('maps a lost connection to network, an unknown format to format', async () => {
    const down: typeof fetch = () => Promise.reject(new TypeError('offline'));
    await expect(loadReplay('1', null, down)).rejects.toMatchObject({ code: 'network' });
    const next = { ...(SAMPLE_RAW as object), format: 9 };
    await expect(loadReplay('1', null, answer(200, next))).rejects.toMatchObject({
      code: 'format',
    });
  });

  it('builds the viewer address', () => {
    expect(replayUrl('a/b')).toBe('/?replay=a%2Fb');
  });
});
