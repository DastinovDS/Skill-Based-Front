import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n/index.ts';
import { PLAYER_COLOUR_IDS } from '../theme/tokens.ts';
import type { HudData } from './hudData.ts';
import StartBanner from './StartBanner.svelte';

describe('StartBanner: the first seconds of a match (U4, DEC-49)', () => {
  let mounted: Record<string, unknown>[] = [];

  afterEach(() => {
    for (const m of mounted) void unmount(m);
    mounted = [];
    document.body.innerHTML = '';
  });

  function title(colour: (typeof PLAYER_COLOUR_IDS)[number] | null): string {
    setLocale('en');
    const target = document.body.appendChild(document.createElement('div'));
    const data = { nicks: { me: 'Ember', enemy: 'Bot' } } as unknown as HudData;
    mounted.push(mount(StartBanner, { target, props: { data, visible: true, colour } }));
    flushSync();
    return target.querySelector('.title')?.textContent ?? '';
  }

  it('names the colour of the player in the match', () => {
    for (const id of PLAYER_COLOUR_IDS) {
      expect(title(id).toLowerCase()).toContain(`you are ${id}.`);
    }
  });

  it('names Lapis while the colour is not known', () => {
    expect(title(null)).toBe('You are Lapis. Your capital is here');
  });

  it('sets the capital star in ink in a rule with two lozenges, not a coloured triangle (#968)', () => {
    title('lapis');
    const mark = document.body.querySelector('.banner .mark');
    expect(mark).not.toBeNull();
    expect(mark?.querySelectorAll('.star')).toHaveLength(1);
    expect(mark?.querySelectorAll('.loz')).toHaveLength(1);
    expect(mark?.querySelector('rect[mask]')).not.toBeNull();
    expect(mark?.getAttribute('aria-hidden')).toBe('true');
  });
});
