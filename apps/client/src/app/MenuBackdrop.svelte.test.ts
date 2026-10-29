import { flushSync, mount, unmount } from 'svelte';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import MenuBackdrop from './MenuBackdrop.svelte';
import { MENU_MAP } from './menuMap.ts';
import type { BackdropPhase } from './menuScene.ts';
import { setSeasonOverride } from './menuSeason.ts';

describe('MenuBackdrop (#471, #474)', () => {
  let component: Record<string, unknown> | undefined;
  // jsdom has no 2D canvas (it would log "not implemented"): the motion layer then stays empty.
  beforeAll(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });
  afterAll(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    if (component !== undefined) void unmount(component);
    component = undefined;
    document.body.innerHTML = '';
    setSeasonOverride(null);
  });

  function render(phase: BackdropPhase, opponent: string | null = null, withMap = true): void {
    component = mount(MenuBackdrop, {
      target: document.body,
      props: { map: withMap ? MENU_MAP : null, phase, opponent, waited: 0 },
    });
    flushSync();
  }
  const has = (selector: string): boolean => document.querySelector(selector) !== null;

  it('is a decoration: hidden from assistive technology, plain dark without a map', () => {
    render('idle', null, false);
    expect(document.querySelector('.backdrop')?.getAttribute('aria-hidden')).toBe('true');
    expect(has('svg.scene')).toBe(false);
  });

  it('draws the map, the fog, the motion and the capitals as layers of their own', () => {
    render('idle');
    const layers = [...document.querySelectorAll('.backdrop > .layer')].map((e) => e.classList[0]);
    expect(layers).toEqual(['scene', 'fog', 'motion', 'capitals']);
  });

  it('idle: a question mark where the enemy capital is, no hole in the fog', () => {
    render('idle');
    expect(document.querySelector('.unknown-mark')?.textContent).toBe('?');
    expect(has('.sight-hole') || has('.ban-ring')).toBe(false);
  });

  it('searching: the scout opens a hole in the fog round itself (DEC-35)', () => {
    render('search');
    const hole = document.querySelector('.sight-hole');
    expect(hole).not.toBeNull();
    expect(Number(hole?.getAttribute('r'))).toBeGreaterThan(0);
    expect(has('.unknown-mark')).toBe(true);
  });

  it('found and confirmed: the nick of the opponent on the enemy capital, the fog open', () => {
    for (const phase of ['found', 'confirmed'] as const) {
      render(phase, 'Vega');
      expect(document.querySelector('.nick-text')?.textContent).toBe('Vega');
      expect(has('.unknown-mark')).toBe(false);
      expect(has('.sight-hole')).toBe(true);
      void unmount(component as Record<string, unknown>);
      component = undefined;
    }
  });

  it('banned: a dashed amber ring on the own capital', () => {
    render('banned');
    expect(has('.ban-ring')).toBe(true);
    expect(has('.sight-hole')).toBe(false);
  });

  it('shortens a long nick on the map', () => {
    render('found', 'AVeryLongNickName');
    expect(document.querySelector('.nick-text')?.textContent).toBe('AVeryLongNi…');
  });

  it('tints the terrain by the season', () => {
    setSeasonOverride('winter');
    render('idle');
    expect(document.querySelector('.backdrop')?.classList.contains('winter')).toBe(true);
  });
});
