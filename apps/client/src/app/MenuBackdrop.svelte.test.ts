import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { BUNDLED_MAPS } from '../map/bundledMaps.ts';
import MenuBackdrop from './MenuBackdrop.svelte';
import type { BackdropPhase } from './menuScene.ts';

const crossroads = BUNDLED_MAPS.find((m) => m.meta.name === 'crossroads');

describe('MenuBackdrop (#471)', () => {
  let component: Record<string, unknown> | undefined;
  afterEach(() => {
    if (component !== undefined) void unmount(component);
    component = undefined;
    document.body.innerHTML = '';
  });

  function render(phase: BackdropPhase, opponent: string | null = null, withMap = true): void {
    component = mount(MenuBackdrop, {
      target: document.body,
      props: { map: withMap ? (crossroads ?? null) : null, phase, opponent },
    });
    flushSync();
  }
  const has = (selector: string): boolean => document.querySelector(selector) !== null;

  it('is a decoration: hidden from assistive technology, plain dark without a map', () => {
    render('idle', null, false);
    expect(document.querySelector('.backdrop')?.getAttribute('aria-hidden')).toBe('true');
    expect(has('svg.scene')).toBe(false);
  });

  it('idle: the map with a question mark where the enemy capital is', () => {
    render('idle');
    expect(has('svg.scene')).toBe(true);
    expect(document.querySelector('.unknown-mark')?.textContent).toBe('?');
    expect(has('.road-march') || has('.road-found') || has('.ban-ring') || has('.grow')).toBe(
      false,
    );
  });

  it('searching: rings grow from the own capital and the road marches', () => {
    render('search');
    expect(document.querySelectorAll('.grow')).toHaveLength(2);
    expect(has('.road-march')).toBe(true);
    expect(has('.unknown-mark')).toBe(true);
  });

  it('found: a solid road and the nick of the opponent on the enemy capital', () => {
    render('found', 'Vega');
    expect(has('.road-found')).toBe(true);
    expect(has('.road-march')).toBe(false);
    expect(document.querySelector('.nick-text')?.textContent).toBe('Vega');
    expect(has('.unknown-mark')).toBe(false);
  });

  it('banned: a dashed amber ring on the own capital', () => {
    render('banned');
    expect(has('.ban-ring')).toBe(true);
  });

  it('shortens a long nick on the map', () => {
    render('found', 'AVeryLongNickName');
    expect(document.querySelector('.nick-text')?.textContent).toBe('AVeryLongNi…');
  });
});
