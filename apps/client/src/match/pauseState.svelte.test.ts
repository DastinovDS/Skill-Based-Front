import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMsg } from '../protocol.gen.ts';
import { PauseState, serverErrorLine } from './pauseState.svelte.ts';

const denied = { type: 'error', code: 'PAUSE_DENIED' } as unknown as ServerMsg;
const paused = (by: 0 | 1 | null): ServerMsg =>
  ({
    type: 'paused',
    paused: by !== null,
    by,
    ends_in_s: by === null ? null : 60,
  }) as unknown as ServerMsg;

const welcome = (pause_available: boolean): ServerMsg =>
  ({ type: 'welcome', pause_available }) as unknown as ServerMsg;

describe('PauseState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('logs a refused pause and any other server error, and shows nothing (#765, G8, G9)', () => {
    const lines: string[] = [];
    const state = new PauseState((line) => lines.push(line));
    state.onMessage(denied, 0);
    state.onMessage({ type: 'error', code: 'BAD', message: null } as unknown as ServerMsg, 0);
    expect(lines).toEqual([serverErrorLine('PAUSE_DENIED'), serverErrorLine('BAD')]);
    expect(lines[0]).toBe('[client] server error: PAUSE_DENIED');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('offers the pause only when welcome says so, also after a reconnect (#448)', () => {
    const state = new PauseState();
    expect(state.available).toBe(false); // nothing is offered before the welcome
    state.onMessage(welcome(true), 0);
    expect(state.available).toBe(true);
    state.onMessage(welcome(false), 0); // a rated match, or the pause was used before a reload
    expect(state.available).toBe(false);
  });

  it('takes the pause away for good when the own pause starts, not the enemy one', () => {
    const state = new PauseState();
    state.onMessage(welcome(true), 0);
    state.onMessage(paused(1), 0);
    expect(state.available).toBe(true); // the opponent paused: the own pause is still there
    state.onMessage(paused(null), 0);
    state.onMessage(paused(0), 0);
    expect(state.available).toBe(false);
    state.onMessage(paused(null), 0);
    expect(state.available).toBe(false);
  });
});
