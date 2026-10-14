import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_RAW } from './fixture.ts';
import {
  loadReplay,
  loadReplayWhenReady,
  POLL_MAX_MS,
  POLL_TIMEOUT_MS,
  replayUrl,
} from './loadReplay.ts';

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
    [410, 'unavailable'],
    [202, 'preparing'],
    [422, 'missing'],
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

describe('loadReplayWhenReady', () => {
  const preparing = () => new Response('{"status":"preparing"}', { status: 202 });
  const ready = () => new Response(JSON.stringify(SAMPLE_RAW), { status: 200 });
  const sequence = (...answers: (() => Response)[]): typeof fetch => {
    const queue = [...answers];
    return vi.fn(() => Promise.resolve((queue.shift() ?? ready)()));
  };

  it('asks again with a growing pause while the server prepares, then opens the replay', async () => {
    const fetchFn = sequence(preparing, preparing, preparing, preparing, preparing, ready);
    const sleep = vi.fn(() => Promise.resolve());
    const onPreparing = vi.fn();
    const file = await loadReplayWhenReady('42', null, { fetchFn, sleep, onPreparing });
    expect(file.map_id).toBe('siege');
    expect(fetchFn).toHaveBeenCalledTimes(6);
    expect(sleep.mock.calls).toEqual([[2000], [3000], [4500], [POLL_MAX_MS], [POLL_MAX_MS]]);
    expect(onPreparing).toHaveBeenCalledTimes(1); // the waiting window is announced once
  });

  it('does not wait when the replay is ready at once', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const onPreparing = vi.fn();
    await loadReplayWhenReady('42', 'tok', { fetchFn: sequence(ready), sleep, onPreparing });
    expect(sleep).not.toHaveBeenCalled();
    expect(onPreparing).not.toHaveBeenCalled();
  });

  it.each([
    [404, 'missing'],
    [410, 'unavailable'],
    [403, 'auth'],
  ])('stops at once on HTTP %i (%s)', async (status, code) => {
    const sleep = vi.fn(() => Promise.resolve());
    const fetchFn = sequence(preparing, () => new Response('{}', { status }));
    await expect(loadReplayWhenReady('1', null, { fetchFn, sleep })).rejects.toMatchObject({
      code,
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('gives up with timeout after the allowed wait', async () => {
    let waited = 0;
    const sleep = vi.fn((ms: number) => {
      waited += ms;
      return Promise.resolve();
    });
    const fetchFn = vi.fn(() => Promise.resolve(preparing()));
    await expect(loadReplayWhenReady('1', null, { fetchFn, sleep })).rejects.toMatchObject({
      code: 'timeout',
    });
    expect(waited).toBeLessThanOrEqual(POLL_TIMEOUT_MS);
    expect(waited).toBeGreaterThan(POLL_TIMEOUT_MS - POLL_MAX_MS);
  });

  it('stops when the screen goes away', async () => {
    const stop = new AbortController();
    const fetchFn = sequence(preparing);
    const sleep = vi.fn(() => {
      stop.abort();
      return Promise.resolve();
    });
    await expect(
      loadReplayWhenReady('1', null, { fetchFn, sleep, signal: stop.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
