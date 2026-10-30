import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale, translate } from '../i18n/index.ts';
import { SAMPLE_RAW } from './fixture.ts';
import ReplayScreen from './ReplayScreen.svelte';

// PixiJS needs WebGL; the map is covered by GameCanvas tests and the visual job.
vi.mock('../render/GameCanvas.svelte', () => ({
  default: () => ({ fitMap: () => undefined, setInsets: () => undefined }),
}));

let screen: Record<string, unknown> | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  setLocale('en');
  // jsdom has no 2D canvas (the menu backdrop of the frame would log "not implemented").
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  // jsdom has no ResizeObserver (`bind:clientHeight` of the bars uses it).
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
});

afterEach(() => {
  if (screen !== undefined) void unmount(screen);
  screen = undefined;
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const answer = (status: number, body: unknown = {}): Response =>
  new Response(JSON.stringify(body), { status });

function open(
  answers: Response[],
  onback = vi.fn(),
  extra: Record<string, unknown> = {},
): HTMLElement {
  const queue = [...answers];
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(queue.shift() ?? answer(200, SAMPLE_RAW))),
  );
  const target = document.body.appendChild(document.createElement('div'));
  screen = mount(ReplayScreen, { target, props: { matchId: '7', onback, ...extra } });
  return target;
}

const pressedView = (root: HTMLElement): string[] =>
  [...root.querySelectorAll('.view button')]
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.textContent.trim());

/** Lets the pending promises and `delay` ms of timers run. */
async function wait(delay: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(delay);
  flushSync();
}

describe('ReplayScreen', () => {
  it('shows the waiting window while the server prepares, then opens the replay (#259)', async () => {
    const root = open([answer(202), answer(202)]);
    await wait(0);
    expect(root.textContent).toContain(translate('en', 'replay.title.preparing'));
    expect(root.querySelector('[role="alert"]')).toBeNull();

    await wait(2000); // the second answer: still preparing
    expect(root.textContent).toContain(translate('en', 'replay.title.preparing'));

    await wait(3000); // the third: the file
    expect(root.textContent).not.toContain(translate('en', 'replay.title.preparing'));
    expect(root.querySelector('.viewer')).not.toBeNull();
  });

  it('says "not found" for a match that does not exist', async () => {
    const root = open([answer(404)]);
    await wait(0);
    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      translate('en', 'replay.error.missing'),
    );
  });

  it('says "unavailable" when the server will not make the replay', async () => {
    const root = open([answer(202), answer(410)]);
    await wait(2000);
    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      translate('en', 'replay.error.unavailable'),
    );
  });

  it('says "no longer available" for a replay the retention removed', async () => {
    const root = open([answer(410, { detail: 'replay has expired', reason: 'expired' })]);
    await wait(0);
    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      translate('en', 'replay.error.expired'),
    );
  });

  it('gives up after the allowed wait', async () => {
    const root = open(Array.from({ length: 200 }, () => answer(202)));
    await wait(6 * 60 * 1000);
    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      translate('en', 'replay.error.timeout'),
    );
  });

  it('keeps "Back" in the waiting window and in the error', async () => {
    const onback = vi.fn();
    const root = open([answer(202)], onback);
    await wait(0);
    root.querySelector('button')?.click();
    expect(onback).toHaveBeenCalledTimes(1);
  });

  it('goes back on Esc while the frame is shown', async () => {
    const onback = vi.fn();
    open([answer(404)], onback);
    await wait(0);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onback).toHaveBeenCalledTimes(1);
  });

  it('offers "Try again" only where asking again can help, and asks again', async () => {
    const missing = open([answer(404)]);
    await wait(0);
    expect(missing.textContent).not.toContain(translate('en', 'replay.retry'));
    void unmount(screen as Record<string, unknown>);
    document.body.innerHTML = '';

    const root = open([answer(500), answer(200, SAMPLE_RAW)]);
    await wait(0);
    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      translate('en', 'replay.error.network'),
    );
    const retry = [...root.querySelectorAll('button')].find((b) =>
      b.textContent.includes(translate('en', 'replay.retry')),
    );
    expect(retry).toBeDefined();
    retry?.click();
    await wait(0);
    expect(root.querySelector('.viewer')).not.toBeNull();
  });

  it('opens a replay as the side the viewer played', async () => {
    const root = open([answer(200, SAMPLE_RAW)]);
    await wait(0);
    // No side known and no nicks in the file: both, player 1 blue.
    expect(pressedView(root)).toEqual([translate('en', 'replay.view.both')]);
  });

  it('opens as the side that has the viewer nick, or the side the app says', async () => {
    const nicks = ['Danya', 'Guest-7'];
    const byNick = open([answer(200, { ...(SAMPLE_RAW as object), nicks })], vi.fn(), {
      nick: 'guest-7',
    });
    await wait(0);
    expect(pressedView(byNick)).toEqual(['Guest-7']);
    void unmount(screen as Record<string, unknown>);
    document.body.innerHTML = '';

    const bySide = open([answer(200, SAMPLE_RAW)], vi.fn(), { me: 1 });
    await wait(0);
    expect(pressedView(bySide)).toEqual([translate('en', 'replay.player2')]);
  });
});
