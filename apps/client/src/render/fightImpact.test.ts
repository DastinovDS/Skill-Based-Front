import { describe, expect, it } from 'vitest';
import type { MapFile } from '../protocol.gen.ts';
import { fightPlace, placeKey, type RoundFx } from './fightFx.ts';
import {
  CANCEL_SHARE,
  HIT_SHARE,
  IMPACT_SHARE,
  NEXT_WIND_SHARE,
  NUMBER_SHARE,
  ROUND_END_SHARE,
  WIND_SHARE,
  armed,
  burstProgress,
  contactPoints,
  contactProgress,
  impactParticles,
  impactsOf,
  inFirstRound,
  numberProgress,
  particleBudget,
  silentProgress,
  windProgress,
  type Impact,
} from './fightImpact.ts';
import type { ParticleSpec } from './particles.ts';
import { FIGHT_FX_STRENGTH, FIGHT_GAP } from './style.ts';

const map = {
  nodes: [
    { id: 0, x: 10, y: 120 },
    { id: 1, x: 110, y: 120 },
  ],
  edges: [{ id: 0, a: 0, b: 1 }],
} as unknown as MapFile;
const radius = (): number => 14;
const place = (): NonNullable<ReturnType<typeof fightPlace>> => {
  const result = fightPlace(map, 1, null, null, radius);
  if (result === undefined) throw new Error('no place');
  return result;
};

const round = (
  shots: [number, number],
  losses: [number, number] = [0, 0],
  virtual: [number, number] = [0, 0],
): RoundFx => ({ kind: 'round', tick: 100, place: place(), shots, virtual, losses });

// A 20-tick round at 10 Hz is the 2 s of DEC-32: the shares are the seconds of ui-style 29.1.
const seconds = (share: number, roundTicks: number, tickHz = 10): number =>
  (share * roundTicks) / tickHz;

describe('timing: shares of the round (ui-style 29.1)', () => {
  it('is the seconds of the style guide for the round of 20 ticks', () => {
    expect(seconds(WIND_SHARE, 20)).toBeCloseTo(0.35);
    expect(seconds(HIT_SHARE, 20)).toBeCloseTo(0.6);
    expect(seconds(CANCEL_SHARE, 20)).toBeCloseTo(0.3);
    expect(seconds(IMPACT_SHARE, 20)).toBeCloseTo(1.0);
    expect(seconds(NUMBER_SHARE, 20)).toBeCloseTo(1.0);
    expect(seconds(ROUND_END_SHARE, 20)).toBeCloseTo(1.6);
    expect(seconds(NEXT_WIND_SHARE, 20)).toBeCloseTo(1.65);
  });

  it('is all over before the next wind-up starts', () => {
    expect(ROUND_END_SHARE).toBeLessThan(NEXT_WIND_SHARE);
  });

  it.each([10, 20])('follows the round of %i ticks, not fixed seconds', (roundTicks) => {
    const [impact] = impactsOf(round([1, 0]), 0);
    if (impact === undefined) throw new Error('no impact');
    // Nothing before the hit, a burst for half a round after it, nothing after that.
    const hit = HIT_SHARE * roundTicks;
    expect(burstProgress(hit - 0.5, impact, roundTicks)).toBeNull();
    expect(burstProgress(hit, impact, roundTicks)).toBe(0);
    expect(burstProgress(hit + (IMPACT_SHARE * roundTicks) / 2, impact, roundTicks)).toBeCloseTo(
      0.5,
    );
    expect(burstProgress(hit + IMPACT_SHARE * roundTicks, impact, roundTicks)).toBeNull();
    // The whole round lasts 0.8 of it: at 10 ticks the effects end 8 ticks after the tick, at 20 after 16.
    expect(burstProgress(ROUND_END_SHARE * roundTicks - 0.01, impact, roundTicks)).toBeLessThan(1);
    expect(burstProgress(ROUND_END_SHARE * roundTicks, impact, roundTicks)).toBeNull();
  });

  it.each([10, 20])('shows the wind-up in the last 0.175 of a round of %i ticks', (roundTicks) => {
    const next = 500;
    const length = WIND_SHARE * roundTicks;
    expect(windProgress(next, next - length - 0.1, roundTicks)).toBeNull();
    expect(windProgress(next, next - length, roundTicks)).toBe(0);
    expect(windProgress(next, next - length / 2, roundTicks)).toBeCloseTo(0.5);
    expect(windProgress(next, next + 0.1, roundTicks)).toBeNull();
  });

  it.each([10, 20])('keeps the "-N" for half a round after the hit (%i ticks)', (roundTicks) => {
    const [kill] = impactsOf(round([1, 0], [0, 1]), 0);
    if (kill === undefined) throw new Error('no impact');
    const hit = HIT_SHARE * roundTicks;
    expect(numberProgress(hit - 1, kill, roundTicks)).toBeNull();
    expect(numberProgress(hit + NUMBER_SHARE * roundTicks - 0.1, kill, roundTicks)).toBeLessThan(1);
    expect(numberProgress(hit + NUMBER_SHARE * roundTicks, kill, roundTicks)).toBeNull();
  });

  it('times the contact ring, the silent ring and the first round', () => {
    expect(contactProgress(0, 20)).toBe(0);
    expect(contactProgress(6, 20)).toBeNull();
    expect(silentProgress(4.5, 20)).toBeCloseTo(0.5);
    expect(silentProgress(9, 20)).toBeNull();
    expect(inFirstRound(100, 120, 20)).toBe(true);
    expect(inFirstRound(100, 140, 20)).toBe(false);
  });
});

describe('impactsOf: what a round did, by its fields', () => {
  it('cancels when both sides shot, and lands halfway in time', () => {
    const impacts = impactsOf(round([1, 1]), 0);
    expect(impacts).toEqual([
      { kind: 'cancel', shooter: null, victim: null, bonus: false, losses: 0, at: CANCEL_SHARE },
    ]);
  });

  it('kills when one side shot and the other lost a unit', () => {
    expect(impactsOf(round([1, 0], [0, 1]), 0)).toEqual([
      { kind: 'kill', shooter: 'own', victim: 'enemy', bonus: false, losses: 1, at: HIT_SHARE },
    ]);
    // The same round seen from the other player: the enemy shot the own unit.
    expect(impactsOf(round([1, 0], [0, 1]), 1)).toEqual([
      { kind: 'kill', shooter: 'enemy', victim: 'own', bonus: false, losses: 1, at: HIT_SHARE },
    ]);
  });

  it('puts a charge out when one side shot and nobody died', () => {
    const [impact] = impactsOf(round([0, 1]), 0);
    expect(impact).toMatchObject({ kind: 'discharge', shooter: 'enemy', victim: 'own', losses: 0 });
  });

  it('is a bonus shot only when all the shots of the side were virtual', () => {
    expect(impactsOf(round([1, 0], [0, 0], [1, 0]), 0)[0]?.bonus).toBe(true);
    expect(impactsOf(round([2, 0], [0, 0], [1, 0]), 0)[0]?.bonus).toBe(false);
    expect(impactsOf(round([1, 1], [0, 0], [1, 1]), 0)[0]?.bonus).toBe(true);
    expect(impactsOf(round([1, 1], [0, 0], [1, 0]), 0)[0]?.bonus).toBe(false);
  });

  it('draws nothing for a round nobody shot in (an old event has no shots)', () => {
    expect(impactsOf(round([0, 0]), 0)).toEqual([]);
  });
});

describe('what the view says: armed sides', () => {
  it('is armed with a charge that speaks, or a bonus shot', () => {
    expect(armed({ charged: 2, mute: 0, bonus: 0 })).toBe(true);
    expect(armed({ charged: 1, mute: 1, bonus: 0 })).toBe(false);
    expect(armed({ charged: 1, mute: 1, bonus: 1 })).toBe(true);
    expect(armed({ charged: 0, mute: 0, bonus: 0 })).toBe(false);
  });
});

describe('where the two sides stand', () => {
  it('uses both tokens when both are known', () => {
    const contacts = contactPoints(map, place(), {
      own: { x: 100, y: 120 },
      enemy: { x: 130, y: 120 },
    });
    expect(contacts).toEqual({ own: { x: 100, y: 120 }, enemy: { x: 130, y: 120 } });
  });

  it('mirrors the unknown side across the place of the fight', () => {
    const contacts = contactPoints(map, place(), { own: { x: 90, y: 100 } });
    expect(contacts.enemy).toEqual({ x: 130, y: 140 });
  });

  it('puts the sides FIGHT_GAP apart along the road when no token is known', () => {
    const road = fightPlace(map, null, 0, 1000, radius);
    if (road === undefined) throw new Error('no place');
    const contacts = contactPoints(map, road, {});
    expect(contacts.enemy.x - contacts.own.x).toBeCloseTo(FIGHT_GAP);
    expect(contacts.own.y).toBe(contacts.enemy.y);
    expect((contacts.own.x + contacts.enemy.x) / 2).toBeCloseTo(road.at.x);
  });

  it('keeps two tokens on one spot apart', () => {
    const at = place().at;
    const contacts = contactPoints(map, place(), { own: at, enemy: at });
    expect(
      Math.hypot(contacts.enemy.x - contacts.own.x, contacts.enemy.y - contacts.own.y),
    ).toBeGreaterThanOrEqual(16);
  });

  it('has one key per place', () => {
    expect(placeKey(place())).toBe(placeKey(place()));
  });
});

describe('the particles of an impact', () => {
  const contacts = { own: { x: 80, y: 100 }, enemy: { x: 126, y: 100 } };
  const colors = { own: 0x5b9bff, enemy: 0xe5484d };
  const look = { contacts, colors, scale: 1, seed: 3 };
  const collect = (impact: Impact, u: number, strength?: number): ParticleSpec[] => {
    const out: ParticleSpec[] = [];
    impactParticles((p) => out.push(p), impact, u, {
      ...look,
      ...(strength === undefined ? {} : { strength }),
    });
    return out;
  };
  const impact = (over: Partial<Impact>): Impact => ({
    kind: 'kill',
    shooter: 'own',
    victim: 'enemy',
    bonus: false,
    losses: 1,
    at: HIT_SHARE,
    ...over,
  });

  it('is "Stronger": 1.6, and "medium" is one constant away', () => {
    expect(FIGHT_FX_STRENGTH).toBe(1.6);
  });

  it('has 6 to 16 sparks and shards per hit at both strengths (the budget of ui-style 27.3)', () => {
    for (const k of [1, FIGHT_FX_STRENGTH]) {
      for (const kind of ['kill', 'discharge'] as const) {
        const burst = collect(impact({ kind }), 0.05, k).filter(
          (p) => p.kind === 'square' || p.kind === 'triangle',
        );
        expect(burst.length).toBeGreaterThanOrEqual(6);
        expect(burst.length).toBeLessThanOrEqual(16);
      }
    }
  });

  it('has more particles and bigger flashes at "Stronger" than at "medium"', () => {
    const strong = collect(impact({}), 0.05, FIGHT_FX_STRENGTH);
    const medium = collect(impact({}), 0.05, 1);
    expect(strong.length).toBeGreaterThan(medium.length);
    const flash = (list: ParticleSpec[]): number => list.find((p) => p.kind === 'glow')?.size ?? 0;
    expect(flash(strong)).toBeGreaterThan(flash(medium));
  });

  it('is told apart by form, not by hue: ■ real, ◇ bonus, ▽ kill, ✕ cancel', () => {
    const kinds = (list: ParticleSpec[]): Set<string> => new Set(list.map((p) => p.kind));
    const real = kinds(collect(impact({ kind: 'discharge', losses: 0 }), 0.1));
    expect(real.has('square')).toBe(true);
    expect(real.has('triangle')).toBe(false);
    expect(real.has('ring')).toBe(true);
    const bonus = kinds(collect(impact({ kind: 'discharge', losses: 0, bonus: true }), 0.1));
    expect(bonus.has('diamond')).toBe(true);
    expect(bonus.has('square')).toBe(false);
    expect(bonus.has('dashRing')).toBe(true);
    const kill = kinds(collect(impact({}), 0.1));
    expect(kill.has('triangle')).toBe(true);
    const cancel = kinds(
      collect(
        impact({ kind: 'cancel', shooter: null, victim: null, losses: 0, at: CANCEL_SHARE }),
        0.2,
      ),
    );
    expect(cancel.has('cross')).toBe(true);
    expect(cancel.has('triangle')).toBe(false);
  });

  it('puts the shards in the colour of the side that lost the unit', () => {
    const shards = collect(impact({}), 0.1).filter((p) => p.kind === 'triangle');
    expect(shards.length).toBeGreaterThan(0);
    for (const shard of shards) {
      // Enemy red or its lightened tone: the red channel is the strongest.
      expect(((shard.color >> 16) & 0xff) >= (shard.color & 0xff)).toBe(true);
    }
    const own = collect(impact({ shooter: 'enemy', victim: 'own' }), 0.1).filter(
      (p) => p.kind === 'triangle',
    );
    for (const shard of own)
      expect((shard.color & 0xff) >= ((shard.color >> 16) & 0xff)).toBe(true);
  });

  it('puts the hit on the victim and the cancel between the two', () => {
    const ring = collect(impact({}), 0.1).find((p) => p.kind === 'ring');
    expect(ring).toMatchObject({ x: contacts.enemy.x, y: contacts.enemy.y });
    const cancel = collect(
      impact({ kind: 'cancel', shooter: null, victim: null, losses: 0 }),
      0.1,
    ).find((p) => p.kind === 'ring');
    expect(cancel).toMatchObject({ x: 103, y: 100 });
  });

  it('draws nothing outside of its burst, and is the same at the same progress', () => {
    expect(collect(impact({}), -0.1)).toEqual([]);
    expect(collect(impact({}), 1)).toEqual([]);
    expect(collect(impact({}), 0.4)).toEqual(collect(impact({}), 0.4));
  });

  it('keeps the budget it says at the start of a burst', () => {
    for (const kind of ['kill', 'discharge', 'cancel'] as const) {
      const one = impact({ kind, ...(kind === 'cancel' ? { shooter: null, victim: null } : {}) });
      expect(collect(one, 0.05).length).toBeLessThanOrEqual(particleBudget(one) + 1);
    }
  });

  it('grows with the zoom-out scale, so it keeps its size on the screen', () => {
    const big = new Array<ParticleSpec>();
    impactParticles((p) => big.push(p), impact({}), 0.1, { ...look, scale: 2 });
    const small = collect(impact({}), 0.1);
    const flash = (list: ParticleSpec[]): number => list.find((p) => p.kind === 'glow')?.size ?? 0;
    expect(flash(big)).toBeCloseTo(2 * flash(small));
  });
});
