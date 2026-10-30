import { describe, expect, it } from 'vitest';
import { statusKeyAction, statusView, type StatusInput } from './matchStatus.ts';

const READY: StatusInput = { status: 'ready', paused: null, me: 0, notice: null, pauseLeft: 0 };
const paused = (by: 0 | 1) => ({ type: 'paused', paused: true, by, ends_in_s: 30 }) as const;

describe('statusView', () => {
  it('shows nothing while the match runs', () => {
    expect(statusView(READY)).toBeNull();
    expect(statusView({ ...READY, status: 'connecting' })).toBeNull();
  });

  it('tones a reconnect as info and every dead end as an alert, with the way out', () => {
    expect(statusView({ ...READY, status: 'reconnecting' })).toMatchObject({
      tone: 'info',
      role: 'status',
      actions: ['menu'],
    });
    const dead = {
      failed: ['retry', 'menu'],
      gone: ['menu'],
      version_mismatch: ['reload'],
      replaced: ['menu'],
    } as const;
    for (const [status, actions] of Object.entries(dead)) {
      const view = statusView({ ...READY, status: status as keyof typeof dead });
      expect(view).toMatchObject({ tone: 'alert', role: 'alert', icon: 'alert' });
      expect(view?.actions).toEqual(actions);
    }
  });

  it('offers Resume only to the player who paused, with the countdown', () => {
    const mine = statusView({ ...READY, paused: paused(0), pauseLeft: 41 });
    expect(mine).toMatchObject({ tone: 'info', seconds: 41, actions: ['resume'] });
    const theirs = statusView({ ...READY, paused: paused(1), pauseLeft: 41 });
    expect(theirs).toMatchObject({ title: 'match.paused.enemy.title', actions: [] });
  });

  it('ranks a dead connection over a pause, and a pause over a refusal', () => {
    expect(statusView({ ...READY, status: 'gone', paused: paused(0) })?.title).toBe(
      'match.status.gone.title',
    );
    const both = statusView({ ...READY, paused: paused(0), notice: 'match.error.pauseDenied' });
    expect(both?.title).toBe('match.paused.you.title');
    expect(statusView({ ...READY, notice: 'match.error.pauseDenied' })).toMatchObject({
      tone: 'alert',
      role: 'alert',
      text: null,
    });
  });
});

describe('statusKeyAction', () => {
  it('does the main action on Enter and leaves on Esc in a dead match', () => {
    const failed = statusView({ ...READY, status: 'failed' });
    expect(statusKeyAction(failed, 'Enter')).toBe('retry');
    expect(statusKeyAction(failed, 'Escape')).toBe('menu');
    const version = statusView({ ...READY, status: 'version_mismatch' });
    expect(statusKeyAction(version, 'Enter')).toBe('reload');
    expect(statusKeyAction(version, 'Escape')).toBeNull();
  });

  it('keeps Esc for the exit dialog while a match only reconnects or pauses', () => {
    const reconnecting = statusView({ ...READY, status: 'reconnecting' });
    expect(statusKeyAction(reconnecting, 'Escape')).toBeNull();
    expect(statusKeyAction(reconnecting, 'Enter')).toBeNull();
    const mine = statusView({ ...READY, paused: paused(0) });
    expect(statusKeyAction(mine, 'Enter')).toBe('resume');
    expect(statusKeyAction(mine, 'Escape')).toBeNull();
    expect(statusKeyAction(null, 'Enter')).toBeNull();
  });
});
