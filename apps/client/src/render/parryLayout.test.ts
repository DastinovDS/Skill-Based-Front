import { describe, expect, it } from 'vitest';
import type { FightPlace, RoundFx } from './fightFx.ts';
import {
  ETCH,
  PARRY,
  archEnds,
  archPoint,
  endShare,
  hitLandings,
  landShare,
  octaAngles,
  parryMarks,
  roundLayout,
  type ParryMark,
} from './parryLayout.ts';

const place: FightPlace = { node: 1, edge: null, at: { x: 100, y: 100 }, ring: 20 };
const round = (
  shots: [number, number],
  losses: [number, number],
  virtual: [number, number] = [0, 0],
  burned: [number, number] = [0, 0],
): RoundFx => ({ kind: 'round', tick: 100, place, shots, virtual, losses, burned });

const kinds = (marks: readonly ParryMark[]): string[] =>
  marks.map((m) => ('side' in m ? `${m.kind}:${m.side}` : m.kind));

describe('roundLayout: a round from the fight_round fields only (ui-style 54, the fight data)', () => {
  it('counts the pairs as shots[p] - losses[1 - p], the same for both sides', () => {
    // Both shot, nobody died: one pair.
    expect(roundLayout(round([1, 1], [0, 0]), 0)).toMatchObject({
      pairs: 1,
      hits: { own: 0, enemy: 0 },
    });
    // Player 0 shot twice, player 1 once and lost a unit: one pair and one hit by player 0.
    expect(roundLayout(round([2, 1], [0, 1]), 0)).toMatchObject({
      pairs: 1,
      hits: { own: 1, enemy: 0 },
    });
  });

  it('takes the hits by p as losses[1 - p], and sees the round from the side of `me`', () => {
    const fx = round([0, 1], [1, 0], [0, 1], [1, 0]);
    expect(roundLayout(fx, 0)).toEqual({
      pairs: 0,
      hits: { own: 0, enemy: 1 },
      virtual: { own: 0, enemy: 1 },
      burned: { own: 1, enemy: 0 },
    });
    expect(roundLayout(fx, 1)).toEqual({
      pairs: 0,
      hits: { own: 1, enemy: 0 },
      virtual: { own: 1, enemy: 0 },
      burned: { own: 0, enemy: 1 },
    });
  });

  it('draws no shot for a round without shots (an old event)', () => {
    expect(parryMarks(roundLayout(round([0, 0], [0, 0]), 0), 0.1)).toEqual([]);
  });
});

describe('parryMarks: the round in time (the mockup at 2 s a round)', () => {
  it('is the seconds of the mockup: burn 0.42, meet 0.3, hit 0.5, the fx 0.62, 0.14 apart', () => {
    const s = (share: number): number => share * 2;
    expect(s(PARRY.burnLead)).toBeCloseTo(0.42);
    expect(s(PARRY.meet)).toBeCloseTo(0.3);
    expect(s(PARRY.hit)).toBeCloseTo(0.5);
    expect(s(PARRY.fx)).toBeCloseTo(0.62);
    expect(s(PARRY.stagger)).toBeCloseTo(0.14);
  });

  it('flies a pair to the top of its arch, then glances', () => {
    const layout = roundLayout(round([1, 1], [0, 0]), 0);
    expect(kinds(parryMarks(layout, 0.05))).toEqual(['shot:own', 'shot:enemy']);
    const [own, enemy] = parryMarks(layout, PARRY.meet - 1e-6);
    // Both heads reach the middle of the arch together.
    expect(own?.kind === 'shot' && own.s).toBeCloseTo(0.5);
    expect(enemy?.kind === 'shot' && enemy.s).toBeCloseTo(0.5);
    expect(kinds(parryMarks(layout, PARRY.meet + 0.01))).toEqual(['glance']);
    expect(parryMarks(layout, PARRY.meet + PARRY.fx + 0.01)).toEqual([]);
    expect(landShare(layout)).toBeCloseTo(PARRY.meet);
    expect(endShare(layout)).toBeCloseTo(PARRY.meet + PARRY.fx);
  });

  it('flies a hit the whole arch into the unit, then bursts', () => {
    const layout = roundLayout(round([1, 0], [0, 1]), 0);
    const [shot] = parryMarks(layout, PARRY.hit - 1e-6);
    expect(shot?.kind === 'shot' && shot.s).toBeCloseTo(1);
    expect(kinds(parryMarks(layout, PARRY.hit + 0.01))).toEqual(['burst:own']);
    expect(hitLandings(layout)).toEqual([{ side: 'own', at: PARRY.hit }]);
  });

  it('draws the burn first, and the shots after it', () => {
    const layout = roundLayout(round([0, 1], [1, 0], [0, 0], [1, 0]), 0);
    expect(kinds(parryMarks(layout, 0.05))).toEqual(['burn:own']);
    expect(kinds(parryMarks(layout, PARRY.burnLead + 0.01))).toEqual(['burn:own', 'shot:enemy']);
    expect(landShare(layout)).toBeCloseTo(PARRY.burnLead + PARRY.hit);
  });

  it('makes shot i of a side a bonus shot when i < virtual (virtual first, B4)', () => {
    // Two pairs: the own bonus shot is the first; the enemy's one bonus shot too.
    const layout = roundLayout(round([2, 2], [0, 0], [1, 1]), 0);
    const marks = parryMarks(layout, PARRY.stagger + 0.01);
    const bonus = marks.flatMap((m) => (m.kind === 'shot' ? [m.bonus] : []));
    expect(bonus).toEqual([true, true, false, false]);
    // A pair and then a hit by the own side: its second shot (the hit) is the bonus one when virtual is 2.
    const hit = roundLayout(round([2, 1], [0, 1], [2, 0]), 0);
    const later = parryMarks(hit, PARRY.stagger + 0.01).flatMap((m) =>
      m.kind === 'shot' ? [[m.side, m.bonus]] : [],
    );
    expect(later).toContainEqual(['own', true]);
  });
});

describe('the arch', () => {
  it('meets at its top from both ends, bowed up the screen', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 60, y: 0 };
    const top = archPoint(a, b, 0.5, 1);
    expect(top.x).toBeCloseTo(30);
    expect(top.y).toBeCloseTo(-ETCH.lift.max);
    expect(archPoint(b, a, 0.5, 1)).toEqual(top);
    expect(archPoint(a, b, 0.25, 1)).toEqual(archPoint(b, a, 0.75, 1));
  });

  it('keeps its bow within its least and its most, grown by the scale', () => {
    const short = archPoint({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.5, 2);
    expect(short.y).toBeCloseTo(-ETCH.lift.min * 2);
  });

  it('leaves from the near edge of each token, a little up', () => {
    const ends = archEnds({ x: 0, y: 0 }, { x: 100, y: 0 }, 1);
    expect(ends.own).toEqual({ x: ETCH.reach, y: -ETCH.rise });
    expect(ends.enemy).toEqual({ x: 100 - ETCH.reach, y: -ETCH.rise });
  });

  it('turns the two squares of an octagram against each other', () => {
    const start = octaAngles(0);
    const later = octaAngles(0.5);
    expect(later.outer).toBeGreaterThan(start.outer);
    expect(later.inner).toBeLessThan(start.inner);
  });
});
