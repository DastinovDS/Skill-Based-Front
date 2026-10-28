import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMsg } from '../protocol.gen.ts';
import { NOTICE_MS, PauseState } from './pauseState.svelte.ts';

const denied = { type: 'error', code: 'PAUSE_DENIED' } as unknown as ServerMsg;
const paused = (by: 0 | 1 | null): ServerMsg =>
  ({
    type: 'paused',
    paused: by !== null,
    by,
    ends_in_s: by === null ? null : 60,
  }) as unknown as ServerMsg;

describe('PauseState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hides the refusal by itself after a few seconds', () => {
    const state = new PauseState();
    state.onMessage(denied, 0);
    expect(state.notice).toBe('match.error.pauseDenied');
    vi.advanceTimersByTime(NOTICE_MS - 1);
    expect(state.notice).toBe('match.error.pauseDenied');
    vi.advanceTimersByTime(1);
    expect(state.notice).toBeNull();
  });

  it('hides the refusal on the next action', () => {
    const state = new PauseState();
    state.onMessage(denied, 0);
    state.dismiss();
    expect(state.notice).toBeNull();
  });

  it('a second refusal restarts the timer', () => {
    const state = new PauseState();
    state.onMessage(denied, 0);
    vi.advanceTimersByTime(NOTICE_MS - 100);
    state.onMessage(denied, 0);
    vi.advanceTimersByTime(NOTICE_MS - 100);
    expect(state.notice).toBe('match.error.pauseDenied');
    vi.advanceTimersByTime(100);
    expect(state.notice).toBeNull();
  });

  it('shows other errors with the generic text and hides them too', () => {
    const state = new PauseState();
    state.onMessage({ type: 'error', code: 'BAD' } as unknown as ServerMsg, 0);
    expect(state.notice).toBe('match.error.generic');
    vi.advanceTimersByTime(NOTICE_MS);
    expect(state.notice).toBeNull();
  });

  it('marks the pause used only by the own pause, and keeps it after the resume', () => {
    const state = new PauseState();
    state.onMessage(paused(1), 0);
    expect(state.used).toBe(false);
    state.onMessage(paused(null), 0);
    state.onMessage(paused(0), 0);
    expect(state.used).toBe(true);
    state.onMessage(paused(null), 0);
    expect(state.used).toBe(true);
  });

  it('a paused message clears a refusal', () => {
    const state = new PauseState();
    state.onMessage(denied, 0);
    state.onMessage(paused(1), 0);
    expect(state.notice).toBeNull();
  });
});
