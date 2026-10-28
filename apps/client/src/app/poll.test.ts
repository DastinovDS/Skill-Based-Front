import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POLL_TIMEOUT_MS, startPolling } from './poll.ts';

describe('startPolling', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs at once and then one period after each run has finished', async () => {
    const tick = vi.fn(() => Promise.resolve());
    const stop = startPolling(tick, 1000);
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(2);
    stop();
  });

  it('never overlaps: a slow run delays the next one instead of piling up', async () => {
    let running = 0;
    let most = 0;
    const tick = vi.fn(async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      running -= 1;
    });
    const stop = startPolling(tick, 1000);
    await vi.advanceTimersByTimeAsync(19_000);
    expect(most).toBe(1);
    // 3 s of work and 1 s of rest: five runs in 19 s, not nineteen.
    expect(tick).toHaveBeenCalledTimes(5);
    stop();
  });

  it('aborts a run that does not answer within the timeout, and goes on', async () => {
    const signals: AbortSignal[] = [];
    const tick = vi.fn(
      (signal: AbortSignal) =>
        new Promise<void>((resolve) => {
          signals.push(signal);
          signal.addEventListener('abort', () => {
            resolve();
          });
        }),
    );
    const stop = startPolling(tick, 1000, 2000);
    await vi.advanceTimersByTimeAsync(1999);
    expect(signals[0]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signals[0]?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(2);
    stop();
  });

  it('keeps polling after a run that throws', async () => {
    const tick = vi.fn(() => Promise.reject(new Error('boom')));
    const stop = startPolling(tick, 1000);
    await vi.advanceTimersByTimeAsync(2500);
    expect(tick).toHaveBeenCalledTimes(3);
    stop();
  });

  it('stops for good, and aborts the run in flight', async () => {
    let signal: AbortSignal | undefined;
    const tick = vi.fn((given: AbortSignal) => {
      signal = given;
      return new Promise<void>(() => undefined);
    });
    const stop = startPolling(tick, 1000);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    expect(signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('has a default timeout shorter than the 15 s the queue waits for a heartbeat', () => {
    expect(POLL_TIMEOUT_MS).toBeLessThan(15_000);
  });
});
