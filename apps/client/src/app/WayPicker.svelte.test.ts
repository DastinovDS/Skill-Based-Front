import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../i18n/index.ts';
import type { Way } from './play.ts';
import WayPicker from './WayPicker.svelte';
import { WAY_SIGNS } from './waySigns.ts';

describe('WayPicker: the plain signs of the three ways (#968, ui-style 74, D)', () => {
  let mounted: Record<string, unknown>[] = [];

  afterEach(() => {
    for (const m of mounted) void unmount(m);
    mounted = [];
    document.body.innerHTML = '';
  });

  function picker(way: Way, onchoose: (way: Way) => void = () => undefined): HTMLElement {
    setLocale('en');
    const target = document.body.appendChild(document.createElement('div'));
    const options = createRawSnippet(() => ({ render: () => '<span></span>' }));
    mounted.push(mount(WayPicker, { target, props: { way, onchoose, options } }));
    flushSync();
    return target;
  }

  it('draws one sign per way: an hourglass, a cog, a chain link', () => {
    const target = picker('match');
    const signs = [...target.querySelectorAll('.seg .way-sign')].map((s) =>
      s.getAttribute('data-way'),
    );
    expect(signs).toEqual(['match', 'bot', 'friend']);
    expect(target.querySelectorAll('.helmet-icon')).toHaveLength(0);
  });

  it('draws the signs in ink only, with no player colour', () => {
    const target = picker('bot');
    for (const sign of target.querySelectorAll('.way-sign')) {
      for (const path of sign.querySelectorAll('path')) {
        const stroke = path.getAttribute('stroke');
        expect(stroke === 'currentColor' || stroke === '#060504' || stroke === null).toBe(true);
      }
    }
    for (const way of Object.keys(WAY_SIGNS) as Way[]) {
      expect(WAY_SIGNS[way].parts.length).toBeGreaterThan(0);
    }
  });

  it('marks the chosen way and chooses another on a click', () => {
    const onchoose = vi.fn();
    const target = picker('match', onchoose);
    const seats = target.querySelectorAll<HTMLElement>('[role="radio"]');
    expect(seats[0]?.getAttribute('aria-checked')).toBe('true');
    seats[2]?.click();
    expect(onchoose).toHaveBeenCalledWith('friend');
  });
});
