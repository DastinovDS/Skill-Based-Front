import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n/index.ts';
import MatchClock from './MatchClock.svelte';

describe('MatchClock: T3 "Cartouche" (#1005)', () => {
  let mounted: Record<string, unknown>[] = [];

  afterEach(() => {
    for (const m of mounted) void unmount(m);
    mounted = [];
    document.body.innerHTML = '';
  });

  function render(props: { seconds: number; last: boolean; paused: boolean }): HTMLElement {
    setLocale('en');
    const target = document.body.appendChild(document.createElement('div'));
    mounted.push(mount(MatchClock, { target, props }));
    flushSync();
    return target;
  }

  it('shows the time as a timer with its accessible name', () => {
    const target = render({ seconds: 664, last: false, paused: false });
    const clock = target.querySelector('[role="timer"]');
    expect(clock?.getAttribute('aria-label')).toBe('Time left 11:04');
    expect(target.querySelector('.figures')?.textContent).toBe('11:04');
    expect(target.querySelectorAll('.bracket')).toHaveLength(8);
  });

  it('keeps one box whatever the figures: the frame never changes width', () => {
    const widths = [600, 599, 60, 59, 0].map((seconds) => {
      const svg = render({ seconds, last: seconds <= 60, paused: false }).querySelector('svg');
      return svg?.getAttribute('width');
    });
    expect(new Set(widths).size).toBe(1);
  });

  it('beats the serifs in the last minute only, and not at the end or in a pause', () => {
    expect(render({ seconds: 300, last: false, paused: false }).querySelector('.swell')).toBeNull();
    expect(
      render({ seconds: 42, last: true, paused: false }).querySelector('.swell'),
    ).not.toBeNull();
    expect(render({ seconds: 0, last: true, paused: false }).querySelector('.swell')).toBeNull();
    expect(render({ seconds: 42, last: true, paused: true }).querySelector('.swell')).toBeNull();
  });

  it('says a pause by shape: dashed rules, hollow serifs, and in its name', () => {
    const running = render({ seconds: 463, last: false, paused: false });
    const paused = render({ seconds: 463, last: false, paused: true });
    expect(paused.querySelectorAll('.outer').length).toBeGreaterThan(
      running.querySelectorAll('.outer').length,
    );
    // The hole of a hollow serif is one more casing per serif.
    expect(paused.querySelectorAll('.smooth .serif-casing')).toHaveLength(4);
    expect(running.querySelectorAll('.smooth .serif-casing')).toHaveLength(2);
    expect(paused.querySelector('[role="timer"]')?.getAttribute('aria-label')).toBe(
      'Time left 7:43, paused',
    );
  });
});
