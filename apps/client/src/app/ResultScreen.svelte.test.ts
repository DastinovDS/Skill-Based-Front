import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale, translate } from '../i18n/index.ts';
import type { MatchEndMsg, UnratedReason } from '../protocol.gen.ts';
import type { MatchSummary } from './matchSummary.ts';
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
  stats: null,
});

describe('ResultScreen', () => {
  let component: Record<string, unknown> | undefined;
  afterEach(() => {
    if (component !== undefined) void unmount(component);
    component = undefined;
    document.body.innerHTML = '';
    setLocale('en');
  });

  function render(
    me: 0 | 1,
    message: MatchEndMsg,
    onreplay = vi.fn(),
    summary: MatchSummary | null = null,
    onmenu = vi.fn(),
  ): string {
    setLocale('en');
    // The window listener of an earlier screen would take the key first.
    if (component !== undefined) void unmount(component);
    component = mount(ResultScreen, {
      target: document.body,
      props: { me, end: message, summary, onreplay, onmenu },
    });
    flushSync();
    return document.body.textContent;
  }

  it('names the map of the match by its code', () => {
    expect(render(0, end(0))).not.toContain('gen1-17');
    void unmount(component ?? {});
    component = mount(ResultScreen, {
      target: document.body,
      props: { me: 0, end: end(0), mapId: 'gen1-17', onreplay: vi.fn(), onmenu: vi.fn() },
    });
    flushSync();
    expect(document.body.textContent).toContain('gen1-17');
  });

  it('says who won from the side we played', () => {
    expect(render(1, end(1))).toContain(translate('en', 'result.victory'));
  });

  it('shows our VP first, whichever side we are', () => {
    render(1, end(0));
    const score = document.querySelector('.score')?.getAttribute('aria-label');
    expect(score).toBe('Victory points: 5 for You, 3 for Your opponent');
  });

  it('names the players in the score when the match gave the nicks', () => {
    render(0, end(0), vi.fn(), summary);
    expect(document.querySelector('.score')?.textContent).toContain('Ember');
    expect(document.querySelector('.score')?.textContent).toContain('Marta');
  });

  const summary: MatchSummary = { nicks: { mine: 'Ember', enemy: 'Marta' } };

  it('words the reason from our side', () => {
    expect(render(0, { ...end(1), reason: 'capital_captured' })).toContain('Your capital fell.');
    document.body.innerHTML = '';
    expect(render(1, { ...end(1), reason: 'capital_captured' })).toContain(
      'You took the enemy capital.',
    );
    document.body.innerHTML = '';
    expect(render(0, { ...end(0), reason: 'forfeit' }, vi.fn(), summary)).toContain(
      'Marta gave up.',
    );
    document.body.innerHTML = '';
    expect(render(0, { ...end(1), reason: 'forfeit' })).toContain('You gave up.');
    document.body.innerHTML = '';
    expect(render(0, { ...end(null), reason: 'double_defeat' })).toContain(
      'Both capitals fell at the same time.',
    );
  });

  const totals: NonNullable<MatchEndMsg['stats']> = {
    units_killed: 19,
    units_lost: 12,
    cities_captured: 5,
    provinces_captured: 3,
    attacks: 7,
    attacks_won: 4,
    defenses: 3,
    defenses_held: 2,
  };

  it('shows the server totals of the match (#824), each under its caption', () => {
    render(0, { ...end(0), stats: totals });
    const rows = [...document.querySelectorAll('.stats > div')].map((row) => [
      row.querySelector('dt')?.textContent,
      row.querySelector('dd')?.textContent.replace(/\s+/g, ' ').trim(),
    ]);
    expect(rows).toEqual([
      ['Units killed', '19'],
      ['Units lost', '12'],
      ['Cities captured', '5'],
      ['Provinces captured', '3'],
      ['Attacks won', '4 of 7'],
      ['Defenses held', '2 of 3'],
      ['Match length', '0:10'],
    ]);
  });

  it('shows no VP peak, cities held or charges delivered any more (#824)', () => {
    const text = render(0, { ...end(0), stats: totals }, vi.fn(), summary);
    expect(text).not.toMatch(/VP peak|Cities held|Charges delivered/);
  });

  it('shows only the match length when the server sent no totals', () => {
    render(0, end(0), vi.fn(), summary);
    expect(document.querySelectorAll('.stats > div')).toHaveLength(1);
    expect(document.querySelector('.stats')?.textContent).toContain('Match length');
  });

  it('marks the outcome by shape: our helmet, the enemy one, both', () => {
    render(0, end(0));
    expect(document.querySelectorAll('.verdict svg')).toHaveLength(1);
    document.body.innerHTML = '';
    render(0, end(1));
    expect(document.querySelectorAll('.verdict svg')).toHaveLength(1);
    document.body.innerHTML = '';
    render(0, end(null));
    expect(document.querySelectorAll('.verdict svg')).toHaveLength(2);
  });

  it('works from the keyboard: Enter opens the replay, Esc goes to the menu', () => {
    const onreplay = vi.fn();
    const onmenu = vi.fn();
    render(0, end(0), onreplay, null, onmenu);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(onreplay).toHaveBeenCalledOnce();
    expect(onmenu).toHaveBeenCalledOnce();
  });

  it('shows the rating change of a rated match, with a sign', () => {
    expect(render(0, end(0, { before: 800, after: 1082 }))).toContain('+282');
    document.body.innerHTML = '';
    expect(render(1, end(0, { before: 800, after: 757 }))).toContain('-43');
  });

  it('shows no rating line when the match is not rated', () => {
    expect(render(0, end(0))).not.toContain('Rating');
  });

  it('names a draw and opens the replay', () => {
    const onreplay = vi.fn();
    expect(render(0, end(null), onreplay)).toContain(translate('en', 'result.draw'));
    document.querySelector<HTMLButtonElement>('button.lapis-btn.primary')?.click();
    expect(onreplay).toHaveBeenCalledOnce();
  });

  describe('DEC-34: why a match did not change the rating', () => {
    const unrated = (reason: UnratedReason): MatchEndMsg => ({
      ...end(0),
      rated: false,
      unrated_reason: reason,
    });

    it.each([
      ['casual', 'Only matches from the queue'],
      ['guest', 'You played as a guest'],
      ['opponent_guest', 'Your opponent played as a guest'],
      ['opponent_calibrating', 'still in calibration'],
      ['opponent_limit', 'too often'],
      ['opponent_early_resign', 'gave up early'],
    ] as const)('says it for %s', (reason, words) => {
      const text = render(0, unrated(reason));
      expect(text).toContain(words);
      expect(text).toContain(translate('en', `result.unrated.${reason}`));
    });

    it('says nothing of the sort about a rated match', () => {
      const text = render(0, { ...end(0, { before: 800, after: 830 }), rated: true });
      expect(text).not.toMatch(/Not ranked|did not change/);
    });

    it('shows the calibration progress and no rating yet (Spare: no hint line, #845)', () => {
      const text = render(0, {
        ...end(0),
        rated: true,
        unrated_reason: null,
        calibration: { played: 3, total: 5 },
      });
      expect(text).toContain('Calibration 3/5');
      expect(text).not.toContain('Your rating shows once calibration is over.');
      expect(text).not.toContain('from ');
    });

    it('shows the first rating together with the finished calibration', () => {
      const text = render(0, {
        ...end(0, { before: 800, after: 860 }),
        rated: true,
        calibration: { played: 5, total: 5 },
      });
      expect(text).toContain('Calibration 5/5');
      expect(text).toContain('+60');
      expect(text).not.toContain('Your rating shows once calibration is over.');
    });
  });
});
