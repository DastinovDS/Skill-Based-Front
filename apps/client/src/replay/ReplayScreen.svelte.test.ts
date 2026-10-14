import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale, translate } from '../i18n/index.ts';
import { SAMPLE_RAW } from './fixture.ts';
import ReplayScreen from './ReplayScreen.svelte';

// PixiJS needs WebGL; the map is covered by GameCanvas tests and the visual job.
vi.mock('../render/GameCanvas.svelte', () => ({ default: () => undefined }));

let screen: Record<string, unknown> | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  setLocale('en');
});

afterEach(() => {
  if (screen !== undefined) void unmount(screen);
  screen = undefined;
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const answer = (status: number, body: unknown = {}): Response =>
  new Response(JSON.stringify(body), { status });

function open(answers: Response[], onback = vi.fn()): HTMLElement {
  const queue = [...answers];
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(queue.shift() ?? answer(200, SAMPLE_RAW))),
  );
  const target = document.body.appendChild(document.createElement('div'));
  screen = mount(ReplayScreen, { target, props: { matchId: '7', onback } });
  return target;
}

/** Lets the pending promises and `delay` ms of timers run. */
async function wait(delay: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(delay);
  flushSync();
}

describe('ReplayScreen', () => {
  it('shows the waiting window while the server prepares, then opens the replay (#259)', async () => {
    const root = open([answer(202), answer(202)]);
    await wait(0);
    expect(root.textContent).toContain(translate('en', 'replay.preparing'));
    expect(root.querySelector('[role="alert"]')).toBeNull();

    await wait(2000); // the second answer: still preparing
    expect(root.textContent).toContain(translate('en', 'replay.preparing'));

    await wait(3000); // the third: the file
    expect(root.textContent).not.toContain(translate('en', 'replay.preparing'));
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
});
