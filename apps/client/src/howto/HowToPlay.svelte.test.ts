import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HowToScreen from '../app/HowToScreen.svelte';
import { makeDock } from '../app/dockTestKit.ts';
import { setLocale, translate } from '../i18n/index.ts';
import { HOWTO } from './data.ts';
import HowToPlay from './HowToPlay.svelte';

describe('the How to play page (CLI-13, #72)', () => {
  let component: Record<string, unknown> | undefined;
  afterEach(() => {
    if (component !== undefined) void unmount(component);
    component = undefined;
    document.body.innerHTML = '';
    setLocale('en');
  });

  it('shows every section and the examples the simulation played, with its rule numbers', () => {
    component = mount(HowToPlay, { target: document.body });
    flushSync();
    const text = document.body.textContent;
    for (const key of [
      'howto.charges.title',
      'howto.roads.title',
      'howto.fight.title',
      'howto.orders.title',
      'howto.victory.title',
    ] as const) {
      expect(text).toContain(translate('en', key));
    }
    expect(document.querySelectorAll('figure.ex')).toHaveLength(HOWTO.examples.length);
    const rules = HOWTO.rules;
    expect(text).toContain(`rounds of ${String(rules.round_seconds)} s`);
    expect(text).toContain(`${String(rules.stance_charges_pct.war)}% in War`);
    // One row per frame: the start and every round of every example.
    const rows = HOWTO.examples.reduce((n, e) => n + 1 + e.rounds.length, 0);
    expect(document.querySelectorAll('.frames li')).toHaveLength(rows);
  });

  it('draws the units of a frame from the data: filled when charged, dashed when fallen', () => {
    component = mount(HowToPlay, { target: document.body });
    flushSync();
    const surplus = HOWTO.examples.findIndex((e) => e.id === 'surplus');
    const figure = document.querySelectorAll('figure.ex')[surplus] as HTMLElement;
    const last = [...figure.querySelectorAll('.frames li')].at(-1) as HTMLElement;
    // 4 attackers and 2 defenders are drawn in every frame; at the end both defenders have fallen.
    expect(last.querySelectorAll('.side')[0]?.querySelectorAll('svg')).toHaveLength(4);
    expect(last.querySelectorAll('.side')[1]?.querySelectorAll('.gone')).toHaveLength(2);
    expect(last.querySelector('.sr')?.textContent).toContain('Defense: 0 units, 0 charged');
  });

  it('tells how each example ended from the recorded outcome', () => {
    component = mount(HowToPlay, { target: document.body });
    flushSync();
    const results = [...document.querySelectorAll('.result')].map((r) => r.textContent.trim());
    HOWTO.examples.forEach((ex, i) => {
      const key = ex.end.node_taken ? 'howto.ex.taken' : 'howto.ex.bounced';
      expect(results[i]).toBe(translate('en', key).replace('{lost}', String(ex.end.losses.b)));
    });
  });

  it('the screen opens in the Dock frame with its tab marked, and Back leaves', () => {
    const onback = vi.fn();
    const { dock } = makeDock();
    component = mount(HowToScreen, { target: document.body, props: { dock, onback } });
    flushSync();
    expect(document.body.querySelector('.tabs [aria-current="page"]')?.textContent).toContain(
      translate('en', 'help.howTo'),
    );
    expect(document.body.textContent).toContain(translate('en', 'menu.tagline'));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(onback).toHaveBeenCalledOnce();
  });
});
