import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale, translate } from '../i18n/index.ts';
import type { MatchEndMsg } from '../protocol.gen.ts';
import ResultScreen from './ResultScreen.svelte';

const end = (winner: 0 | 1 | null, rating: MatchEndMsg['rating'] = null): MatchEndMsg => ({
  type: 'match_end',
  tick: 100,
  reason: 'timer',
  winner,
  vp: [3, 5],
  rating,
  rated: rating !== null,
  unrated_reason: rating !== null ? null : 'casual',
  calibration: null,
});

describe('ResultScreen', () => {
  let component: Record<string, unknown> | undefined;
  afterEach(() => {
    if (component !== undefined) void unmount(component);
    component = undefined;
    document.body.innerHTML = '';
    setLocale('en');
  });

  function render(me: 0 | 1, message: MatchEndMsg, onreplay = vi.fn()): string {
    setLocale('en');
    component = mount(ResultScreen, {
      target: document.body,
      props: { me, end: message, onreplay, onmenu: vi.fn() },
    });
    flushSync();
    return document.body.textContent;
  }

  it('says who won from the side we played', () => {
    expect(render(1, end(1))).toContain(translate('en', 'result.victory'));
  });

  it('shows our VP first, whichever side we are', () => {
    expect(render(1, end(0))).toContain('you 5, enemy 3');
  });

  it('shows the rating change of a rated match, with a sign', () => {
    expect(render(0, end(0, { before: 800, after: 1082 }))).toContain('Rating: 800 → 1082 (+282)');
    document.body.innerHTML = '';
    expect(render(1, end(0, { before: 800, after: 757 }))).toContain('Rating: 800 → 757 (-43)');
  });

  it('shows no rating line when the match is not rated', () => {
    expect(render(0, end(0))).not.toContain('Rating');
  });

  it('names a draw and opens the replay', () => {
    const onreplay = vi.fn();
    expect(render(0, end(null), onreplay)).toContain(translate('en', 'result.draw'));
    document.querySelector<HTMLButtonElement>('button.primary')?.click();
    expect(onreplay).toHaveBeenCalledOnce();
  });
});
