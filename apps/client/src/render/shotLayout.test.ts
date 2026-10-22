import { describe, expect, it } from 'vitest';
import type { RoundFx } from './fightFx.ts';
import { fightPlace } from './fightFx.ts';
import { CANCEL_SHARE, HIT_SHARE, impactsOf, type Contacts } from './fightImpact.ts';
import {
  AFTERGLOW_SHARE,
  ECHOES,
  MIN_BEND,
  MIN_REACH,
  SPARKS,
  TAIL_SEGMENTS,
  TAIL_SHARE,
  TAIL_WIDTH,
  TOKEN_REACH,
  TRACER_END_SHARE,
  arcAt,
  brightness,
  echoesOf,
  pathPoints,
  shotPhase,
  shotsOf,
  sparkCount,
  sparksOf,
  tailFactor,
  tailOutline,
  tracerBudget,
  type Shot,
} from './shotLayout.ts';
import { FIGHT_FX_STRENGTH, FIGHT_GAP } from './style.ts';
import type { MapFile } from '../protocol.gen.ts';

const map = {
  nodes: [
    { id: 0, x: 10, y: 120 },
    { id: 1, x: 110, y: 120 },
  ],
  edges: [{ id: 0, a: 0, b: 1 }],
} as unknown as MapFile;
const place = (): NonNullable<ReturnType<typeof fightPlace>> => {
  const result = fightPlace(map, 1, null, null, () => 14);
  if (result === undefined) throw new Error('no place');
  return result;
};
const round = (
  shots: [number, number],
  losses: [number, number] = [0, 0],
  virtual: [number, number] = [0, 0],
): RoundFx => ({ kind: 'round', tick: 100, place: place(), shots, virtual, losses });

/** The groups of the fight FIGHT_GAP apart, own on the left (the fight is in a city, the road runs along x). */
const contacts = (gap: number = FIGHT_GAP): Contacts => ({
  own: { x: 100 - gap / 2, y: 100 },
  enemy: { x: 100 + gap / 2, y: 100 },
});

const shotsFor = (fx: RoundFx, gap?: number, strength?: number): Shot[] =>
  impactsOf(fx, 0).flatMap((impact) => shotsOf(impact, contacts(gap), strength));

const dist = (p: { x: number; y: number }, q: { x: number; y: number }): number =>
  Math.hypot(p.x - q.x, p.y - q.y);

describe('the form of a shot, by the fields of the round', () => {
  it('is one shot of the side that shot, from it to the other (a kill or a charge put out)', () => {
    const [kill] = shotsFor(round([1, 0], [0, 1]));
    expect(kill).toMatchObject({ shooter: 'own', bonus: false, cancel: false, at: HIT_SHARE });
    // It leaves at the token of the shooter and lands at the token of the victim.
    // (a bit less than `TOKEN_REACH` when the groups stand close: 0.3 of the gap)
    const reach = Math.min(TOKEN_REACH, 0.3 * FIGHT_GAP);
    expect(kill?.a.x).toBeCloseTo(contacts().own.x + reach);
    expect(kill?.b.x).toBeCloseTo(contacts().enemy.x - reach - 1);
    const [discharge] = shotsFor(round([0, 1]));
    expect(discharge).toMatchObject({ shooter: 'enemy', cancel: false });
    expect(discharge?.a.x).toBeGreaterThan(discharge?.b.x ?? 0);
  });

  it('is a bonus shot only when all of the shots of the side were virtual', () => {
    expect(shotsFor(round([1, 0], [0, 0], [1, 0]))[0]?.bonus).toBe(true);
    expect(shotsFor(round([2, 0], [0, 0], [1, 0]))[0]?.bonus).toBe(false);
  });

  it('is two shots that cancel, each of its own form: a bonus one can meet a real one', () => {
    const shots = shotsFor(round([1, 1], [0, 0], [1, 0]));
    expect(shots.map((s) => [s.shooter, s.bonus, s.cancel])).toEqual([
      ['own', true, true],
      ['enemy', false, true],
    ]);
    expect(shots.every((s) => s.at === CANCEL_SHARE)).toBe(true);
  });

  it('is no shot where nobody shot: a silent charge has no projectile', () => {
    // `mute` is not part of the round at all: a side with nothing to fire has `shots` 0.
    expect(shotsFor(round([0, 0]))).toEqual([]);
  });
});

describe('the two shots that meet bend round each other', () => {
  const [own, enemy] = shotsFor(round([1, 1]));
  if (own === undefined || enemy === undefined) throw new Error('two shots');

  it('end at the same point, the middle between the groups', () => {
    const middle = { x: 100, y: 100 };
    expect(dist(own.b, middle)).toBeCloseTo(0);
    expect(dist(enemy.b, middle)).toBeCloseTo(0);
    expect(dist(arcAt(own, 1), arcAt(enemy, 1))).toBeCloseTo(0);
  });

  it('bend to opposite sides of the road, a lens of two arcs', () => {
    // The road runs along y = 100; a shot bends to the left of its way, so one bows up and the other down.
    const side = (shot: Shot): number => Math.sign(shot.ctrl.y - 100);
    expect(side(own)).not.toBe(0);
    expect(side(own)).toBe(-side(enemy));
    // And the arcs really leave the road: the middle of each is off it by the sag, the other way round.
    const sag = (shot: Shot): number => arcAt(shot, 0.5).y - 100;
    expect(Math.abs(sag(own))).toBeGreaterThanOrEqual(MIN_BEND / 2 - 0.01);
    expect(sag(own)).toBeCloseTo(-sag(enemy), 5);
  });

  it('sets out from its own side', () => {
    expect(own.a.x).toBeLessThan(100);
    expect(enemy.a.x).toBeGreaterThan(100);
  });
});

describe('at the distance of 46 the trail is lengthened, the groups stay where they are (risk 1)', () => {
  it('starts the path behind the shooter when the way between the groups is short', () => {
    const [shot] = shotsFor(round([1, 0], [0, 1]));
    if (shot === undefined) throw new Error('a shot');
    const reach = MIN_REACH * tailFactor();
    expect(shot.length).toBeCloseTo(reach, 5);
    expect(shot.start).toBeGreaterThan(0.5);
    // The path begins on the far side of the shooter from the target.
    expect(shot.p0.x).toBeLessThan(contacts().own.x);
    expect(dist(shot.p0, shot.a)).toBeCloseTo(reach - dist(shot.a, shot.b), 5);
  });

  it('leaves a long way alone', () => {
    const [shot] = shotsFor(round([1, 0], [0, 1]), 160);
    expect(shot?.start).toBe(0);
    expect(shot?.p0).toEqual(shot?.a);
  });

  it('follows the strength: "medium" lengthens less than "Stronger", and the tail is shorter', () => {
    const [strong] = shotsFor(round([1, 0], [0, 1]), FIGHT_GAP, FIGHT_FX_STRENGTH);
    const [medium] = shotsFor(round([1, 0], [0, 1]), FIGHT_GAP, 1);
    expect(medium?.length ?? 99).toBeLessThan(strong?.length ?? 0);
    expect(tailFactor(1)).toBeLessThan(tailFactor(FIGHT_FX_STRENGTH));
    expect(brightness(1)).toBeLessThan(brightness(FIGHT_FX_STRENGTH));
    expect(sparkCount(FIGHT_FX_STRENGTH)).toBe(SPARKS);
    expect(sparkCount(1)).toBeLessThan(SPARKS);
  });

  it('keeps the arc bent: the sag is never less than the least bend', () => {
    const [shot] = shotsFor(round([1, 0], [0, 1]));
    if (shot === undefined) throw new Error('a shot');
    expect(Math.abs(arcAt(shot, 0.5).y - 100)).toBeGreaterThanOrEqual(MIN_BEND / 2 - 0.01);
  });

  it('puts the groups on the same spot apart when they overlap, without a degenerate shot', () => {
    const [shot] = shotsFor(round([1, 0], [0, 1]), 16);
    expect(Number.isFinite(shot?.length)).toBe(true);
    expect(shot?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('time, by the round and not by seconds', () => {
  const [kill] = shotsFor(round([1, 0], [0, 1]));
  const [own] = shotsFor(round([1, 1]));
  if (kill === undefined || own === undefined) throw new Error('shots');

  it.each([10, 20])('flies %i-tick rounds for 0.3 of a round, then fades for 0.25', (ticks) => {
    expect(shotPhase(-0.1, kill, ticks)).toBeNull();
    expect(shotPhase(0, kill, ticks)).toMatchObject({ kind: 'flight', flown: 0, s: kill.start });
    const mid = shotPhase((HIT_SHARE * ticks) / 2, kill, ticks);
    expect(mid).toMatchObject({ kind: 'flight', flown: 0.5 });
    expect(mid?.kind === 'flight' ? mid.s : 0).toBeCloseTo((kill.start + 1) / 2);
    const hit = HIT_SHARE * ticks;
    expect(shotPhase(hit, kill, ticks)).toMatchObject({ kind: 'fade', fade: 0 });
    expect(shotPhase(hit + (AFTERGLOW_SHARE * ticks) / 2, kill, ticks)).toMatchObject({
      kind: 'fade',
      fade: 0.5,
    });
    expect(shotPhase(TRACER_END_SHARE * ticks, kill, ticks)).toBeNull();
    expect(TRACER_END_SHARE * ticks).toBeCloseTo(hit + AFTERGLOW_SHARE * ticks);
  });

  it('meets in the middle after half the time of a hit (0.3 s of 2 s against 0.6 s)', () => {
    expect(own.at).toBe(CANCEL_SHARE);
    expect(CANCEL_SHARE).toBeCloseTo(HIT_SHARE / 2);
    expect(shotPhase(CANCEL_SHARE * 20 - 0.01, own, 20)?.kind).toBe('flight');
    expect(shotPhase(CANCEL_SHARE * 20, own, 20)?.kind).toBe('fade');
    // With the round of 20 ticks at 10 Hz these are the seconds of ui-style 29.1.
    expect((HIT_SHARE * 20) / 10).toBeCloseTo(0.6);
    expect((CANCEL_SHARE * 20) / 10).toBeCloseTo(0.3);
    expect((AFTERGLOW_SHARE * 20) / 10).toBeCloseTo(0.5);
  });
});

describe('the tail', () => {
  const [shot] = shotsFor(round([1, 0], [0, 1]));
  if (shot === undefined) throw new Error('a shot');

  it('tapers: nothing at the tail end, the full width at the head', () => {
    const tail = tailOutline(shot, 1, 1);
    expect(tail.axis).toHaveLength(TAIL_SEGMENTS + 1);
    const width = (i: number): number => {
      const l = tail.left[i];
      const r = tail.right[i];
      return l === undefined || r === undefined ? -1 : dist(l, r);
    };
    expect(width(0)).toBeCloseTo(0);
    expect(width(TAIL_SEGMENTS)).toBeCloseTo(TAIL_WIDTH * tailFactor());
    for (let i = 1; i <= TAIL_SEGMENTS; i++) expect(width(i)).toBeGreaterThan(width(i - 1));
  });

  it('ends at the head and reaches back by the share of the path, not before its start', () => {
    const tail = tailOutline(shot, 0.9, 1);
    expect(tail.axis[TAIL_SEGMENTS]).toEqual(arcAt(shot, 0.9));
    expect(tail.axis[0]).toEqual(arcAt(shot, 0.9 - TAIL_SHARE * tailFactor()));
    // At the start of the path the tail is cut at it.
    expect(tailOutline(shot, 0.2, 1).axis[0]).toEqual(arcAt(shot, 0));
  });

  it('is wider where the map is zoomed out (the effects keep their size on the screen)', () => {
    const wide = tailOutline(shot, 1, 2);
    const narrow = tailOutline(shot, 1, 1);
    const w = (t: typeof wide): number =>
      dist(t.left[TAIL_SEGMENTS] ?? { x: 0, y: 0 }, t.right[TAIL_SEGMENTS] ?? { x: 0, y: 0 });
    expect(w(wide)).toBeCloseTo(2 * w(narrow));
  });

  it('has the path of the afterglow from its start to the landing', () => {
    const path = pathPoints(shot);
    expect(path[0]).toEqual(shot.p0);
    expect(dist(path[path.length - 1] ?? shot.a, shot.b)).toBeCloseTo(0);
  });
});

describe('the sparks and the echoes', () => {
  const [shot] = shotsFor(round([1, 0], [0, 1]));
  const [bonus] = shotsFor(round([1, 0], [0, 0], [1, 0]));
  if (shot === undefined || bonus === undefined) throw new Error('shots');

  it('are born along the flown way and live a short while', () => {
    expect(sparksOf(shot, 0, 3)).toHaveLength(0);
    const flying = sparksOf(shot, 0.5, 3);
    expect(flying.length).toBeGreaterThan(0);
    expect(flying.length).toBeLessThanOrEqual(SPARKS);
    for (const spark of flying) {
      expect(spark.life).toBeGreaterThanOrEqual(0);
      expect(spark.life).toBeLessThan(1);
    }
    // The same on every frame of a tick, a different one for another seed.
    expect(sparksOf(shot, 0.5, 3)).toEqual(flying);
    expect(sparksOf(shot, 0.5, 4)).not.toEqual(flying);
    // Fewer at "medium".
    expect(sparksOf(shot, 0.9, 3, 1).length).toBeLessThanOrEqual(sparkCount(1));
  });

  it('trail a bonus shot as three diamonds, smaller and fainter behind it', () => {
    const echoes = echoesOf(bonus, 0.95);
    expect(echoes).toHaveLength(ECHOES.length);
    expect(echoes.map((e) => e.size)).toEqual([...echoes.map((e) => e.size)].sort((a, b) => b - a));
    expect(echoes.map((e) => e.alpha)).toEqual(
      [...echoes.map((e) => e.alpha)].sort((a, b) => b - a),
    );
  });

  it('keep the particles of a tracer in a small budget', () => {
    expect(tracerBudget(shot)).toBeLessThanOrEqual(8);
    expect(tracerBudget(bonus)).toBeLessThanOrEqual(11);
    expect(tracerBudget(bonus)).toBeGreaterThan(tracerBudget(shot));
  });
});
