import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale } from '../i18n/index.ts';
import type { FightCard, RoundRow } from '../match/fightLog.ts';
import FightBoard from './FightBoard.svelte';

const row = (tick: number, own: Partial<RoundRow['own']>, enemy: Partial<RoundRow['enemy']>) =>
  ({
    tick,
    own: { shots: 0, virtual: 0, spent: 0, losses: 0, ...own },
    enemy: { shots: 0, virtual: 0, spent: 0, losses: 0, ...enemy },
  }) satisfies RoundRow;

const card = (over: Partial<FightCard> = {}): FightCard => ({
  id: 'f1',
  node: 3,
  edge: null,
  rows: [
    row(120, { shots: 1, spent: 1 }, { shots: 1, virtual: 1, spent: 1, losses: 1 }),
    row(110, { shots: 2, virtual: 1, spent: 1 }, { shots: 1, spent: 1 }),
  ],
  complete: true,
  totals: { own: { shots: 3, losses: 0 }, enemy: { shots: 2, losses: 1 } },
  ...over,
});

describe('FightBoard', () => {
  const initial = getLocale();
  let mounted: Record<string, unknown> | undefined;

  afterEach(() => {
    if (mounted !== undefined) void unmount(mounted);
    mounted = undefined;
    setLocale(initial);
    document.body.innerHTML = '';
  });

  function render(fights: readonly FightCard[]): HTMLElement {
    const target = document.body.appendChild(document.createElement('div'));
    mounted = mount(FightBoard, { target, props: { fights } });
    return target;
  }

  it('draws nothing without a fight', () => {
    expect(render([]).querySelector('.board')).toBeNull();
  });

  it('draws a row per round, the newest on top, with the place', () => {
    setLocale('en');
    const target = render([card()]);
    expect(target.querySelector('.place')?.textContent).toBe('Fight: city 3');
    expect(target.querySelectorAll('.rows .row')).toHaveLength(2);
  });

  it('tells a real shot from a bonus one by shape: a disc against a diamond', () => {
    const target = render([card()]);
    const [newest, older] = [...target.querySelectorAll('.rows .row')];
    // Newest round: own one real shot; enemy one bonus shot.
    const [ownNew, enemyNew] = [...(newest?.querySelectorAll('.cell') ?? [])];
    expect(ownNew?.querySelectorAll('.glyph.shot')).toHaveLength(1);
    expect(ownNew?.querySelectorAll('.glyph.bonus')).toHaveLength(0);
    expect(enemyNew?.querySelectorAll('.glyph.bonus')).toHaveLength(1);
    expect(enemyNew?.querySelectorAll('.glyph.shot')).toHaveLength(0);
    // Older round: own two shots, the bonus one first, then the real one.
    const pips = [...(older?.querySelector('.cell')?.querySelectorAll('.pips .glyph') ?? [])];
    expect(pips.map((p) => p.classList.contains('bonus'))).toEqual([true, false]);
  });

  it('shows the charges spent and the units killed, and says all of it in words', () => {
    setLocale('en');
    const target = render([card()]);
    const enemyNew = target.querySelector('.rows .row:first-child .cell.enemy');
    expect(enemyNew?.getAttribute('aria-label')).toBe(
      'Shots 1, of them bonus 1, charges spent 1, units killed 1',
    );
    const nums = [...(enemyNew?.querySelectorAll('.num') ?? [])].map((n) => n.textContent.trim());
    expect(nums).toEqual(['1', '1']);
  });

  it('shows the totals of the fight from the view', () => {
    const target = render([card()]);
    const counts = [...target.querySelectorAll('.totals .count')].map((c) => c.textContent);
    expect(counts).toEqual(['3', '0', '2', '1']);
  });

  it('marks cut history and counts the fights beyond three', () => {
    setLocale('en');
    const target = render([
      card({ complete: false }),
      card({ id: 'f2' }),
      card({ id: 'f3' }),
      card({ id: 'f4' }),
    ]);
    expect(target.querySelectorAll('.card')).toHaveLength(3);
    expect(target.querySelector('.gap')?.getAttribute('aria-label')).toBe(
      'The earlier rounds were missed',
    );
    expect(target.querySelector('.more')?.textContent).toBe('+1 more fights');
  });

  it('is in Russian when the language is', () => {
    setLocale('ru');
    const target = render([card({ node: null, edge: 7 })]);
    expect(target.querySelector('.place')?.textContent).toBe('Бой: дорога 7');
  });
});
