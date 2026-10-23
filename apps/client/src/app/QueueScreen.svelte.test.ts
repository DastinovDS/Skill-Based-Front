import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Api, ApiError, type QueueStatus } from '../api/http.ts';
import { setLocale, translate } from '../i18n/index.ts';
import QueueScreen from './QueueScreen.svelte';

const searching = (over: Partial<QueueStatus> = {}): QueueStatus => ({
  state: 'searching',
  waited_s: 65,
  queue_size: 3,
  bot_offer: false,
  you_confirmed: false,
  opponent_confirmed: false,
  ...over,
});

const found = (over: Partial<QueueStatus> = {}): QueueStatus =>
  searching({ state: 'found', opponent_nick: 'bob', confirm_in_s: 14.2, ...over });

describe('QueueScreen', () => {
  let component: Record<string, unknown> | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    setLocale('en');
  });
  afterEach(() => {
    if (component !== undefined) void unmount(component);
    component = undefined;
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  async function settle(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
    flushSync();
  }

  function render(
    api: Partial<Api>,
    handlers: { onstart?: () => void; onbot?: () => void; onleave?: () => void } = {},
  ): void {
    component = mount(QueueScreen, {
      target: document.body,
      props: {
        api: api as Api,
        token: 't',
        onstart: handlers.onstart ?? vi.fn(),
        onbot: handlers.onbot ?? vi.fn(),
        onleave: handlers.onleave ?? vi.fn(),
        pollMs: 1000,
      },
    });
  }

  function button(label: string): HTMLButtonElement | undefined {
    return [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === label,
    );
  }

  it('enters the queue once, then polls the status with the waiting time and queue size', async () => {
    const joinQueue = vi.fn(() => Promise.resolve(searching({ waited_s: 0, queue_size: 1 })));
    const queueStatus = vi.fn(() => Promise.resolve(searching()));
    render({ joinQueue, queueStatus });
    await settle();
    expect(document.body.textContent).toContain(translate('en', 'queue.searching'));
    await vi.advanceTimersByTimeAsync(1000);
    flushSync();
    expect(joinQueue).toHaveBeenCalledTimes(1);
    expect(queueStatus).toHaveBeenCalledWith('t');
    expect(document.body.textContent).toContain('1:05');
    expect(document.body.textContent).toContain('Players in the queue: 3');
  });

  it('confirms a found opponent and starts the match', async () => {
    const confirmQueue = vi.fn(() =>
      Promise.resolve(searching({ state: 'started', match_id: '7', map_id: 'pass' })),
    );
    const onstart = vi.fn();
    render({ joinQueue: () => Promise.resolve(found()), confirmQueue }, { onstart });
    await settle();
    expect(document.body.textContent).toContain('Opponent found: bob');
    expect(document.body.textContent).toContain('15 s');
    button(translate('en', 'queue.confirm'))?.click();
    await settle();
    expect(confirmQueue).toHaveBeenCalledWith('t');
    expect(onstart).toHaveBeenCalledWith('7', 'pass');
  });

  it('goes back to the menu when dropped from the queue', async () => {
    const onleave = vi.fn();
    render(
      {
        joinQueue: () => Promise.resolve(found()),
        queueStatus: () => Promise.reject(new ApiError('not_found', 404)),
      },
      { onleave },
    );
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onleave).toHaveBeenCalledWith('error.queue.dropped');
    expect(onleave).toHaveBeenCalledTimes(1);
  });

  it('says why it could not enter the queue', async () => {
    const onleave = vi.fn();
    render({ joinQueue: () => Promise.reject(new ApiError('conflict', 409)) }, { onleave });
    await settle();
    expect(onleave).toHaveBeenCalledWith('error.api.conflict');
  });

  it('offers a bot after a long wait and leaves the queue for it', async () => {
    const leaveQueue = vi.fn(() => Promise.resolve());
    const onbot = vi.fn();
    render(
      { joinQueue: () => Promise.resolve(searching({ bot_offer: true })), leaveQueue },
      { onbot },
    );
    await settle();
    button(translate('en', 'queue.playBot'))?.click();
    expect(leaveQueue).toHaveBeenCalledWith('t');
    expect(onbot).toHaveBeenCalled();
  });

  it('cancels the search', async () => {
    const leaveQueue = vi.fn(() => Promise.resolve());
    const onleave = vi.fn();
    render({ joinQueue: () => Promise.resolve(searching()), leaveQueue }, { onleave });
    await settle();
    expect(button(translate('en', 'queue.playBot'))).toBeUndefined();
    button(translate('en', 'queue.leave'))?.click();
    expect(leaveQueue).toHaveBeenCalledWith('t');
    expect(onleave).toHaveBeenCalledWith(null);
  });
});
