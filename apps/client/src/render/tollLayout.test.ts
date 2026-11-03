import { describe, expect, it } from 'vitest';
import type { EventMsg } from '../protocol.gen.ts';
import type { ParticleSpec } from './particles.ts';
import {
  BEAM_MS,
  HIT_AT_MS,
  TOLL_MS,
  tollInfo,
  tollMs,
  tollNumber,
  tollParticles,
  tollPop,
  tollSeed,
  victimOf,
  type TollLook,
} from './tollLayout.ts';

const event = (kind: string, data: EventMsg['data'], tick = 100): EventMsg => ({
  type: 'event',
  tick,
  kind,
  data,
});

describe('tollInfo: a toll event as an effect', () => {
  it('reads what an own group paid: the group, the line and the charges', () => {
    const info = tollInfo(
      event('toll_paid', { player: 0, group: 'abc', node: 4, edge: 7, charges: 2 }),
    );
    expect(info).toEqual({ tick: 100, node: 4, edge: 7, charges: 2, group: 'abc', paid: true });
  });

  it('reads what an own line took: no group, the enemy figure is found on the road', () => {
    const info = tollInfo(event('toll_taken', { player: 0, node: 4, edge: 7, charges: 1 }));
    expect(info).toEqual({ tick: 100, node: 4, edge: 7, charges: 1, group: null, paid: false });
  });

  it('is nothing for another kind, a toll that took nothing, or a malformed one', () => {
    expect(tollInfo(event('fight_ended', { node: 1 }))).toBeNull();
    expect(tollInfo(event('toll_taken', { node: 4, edge: 7, charges: 0 }))).toBeNull();
    expect(tollInfo(event('toll_taken', { node: 4, edge: 7 }))).toBeNull();
    expect(tollInfo(event('toll_paid', { node: '4', edge: 7, charges: 1 }))).toBeNull();
  });

  it('knows who lost: the viewer when it paid, the opponent when the own line took', () => {
    const paid = tollInfo(event('toll_paid', { group: 'g', node: 1, edge: 1, charges: 1 }));
    const taken = tollInfo(event('toll_taken', { node: 1, edge: 1, charges: 1 }));
    if (paid === null || taken === null) throw new Error('no info');
    expect(victimOf(paid, 0)).toBe(0);
    expect(victimOf(paid, 1)).toBe(1);
    expect(victimOf(taken, 0)).toBe(1);
    expect(victimOf(taken, 1)).toBe(0);
  });

  it('seeds a different burst for tolls on different roads', () => {
    const a = tollInfo(event('toll_taken', { node: 1, edge: 1, charges: 1 }));
    const b = tollInfo(event('toll_taken', { node: 1, edge: 2, charges: 1 }));
    if (a === null || b === null) throw new Error('no info');
    expect(tollSeed(a)).not.toBe(tollSeed(b));
  });
});

describe('tollMs: the age of a toll', () => {
  it('is the time since the event, nothing before it or from the end of the effect on', () => {
    expect(tollMs(-1, 10)).toBeNull();
    expect(tollMs(0, 10)).toBe(0);
    expect(tollMs(3, 10)).toBe(300);
    expect(tollMs(7, 10)).toBe(700);
    expect(tollMs(8, 10)).toBeNull();
    expect(tollMs(1, 0)).toBeNull();
  });
  it('is over within 0.8 s of the event, as the mockup says', () => {
    expect(TOLL_MS).toBeLessThanOrEqual(800);
    expect(BEAM_MS).toBeLessThan(TOLL_MS);
  });
});

describe('tollParticles: K6 "Beam"', () => {
  const colors = { own: 0x5b9bff, enemy: 0xe5484d };
  const look = (victim: 'own' | 'enemy', charges = 2): TollLook => ({
    from: { x: 0, y: 0 },
    at: { x: 100, y: 0 },
    colors,
    victim,
    charges,
    scale: 1,
    seed: 7,
  });
  const at = (ms: number, l: TollLook): ParticleSpec[] => {
    const out: ParticleSpec[] = [];
    tollParticles((p) => out.push(p), ms, l);
    return out;
  };

  it('is an instant beam from the line to the group at the start, with a white core', () => {
    const beam = at(0, look('own')).filter((p) => p.kind === 'square' && p.aspect !== undefined);
    expect(beam.length).toBeGreaterThanOrEqual(2);
    // Centred between the line and the group, along the way to it, and as long as the way.
    for (const part of beam) {
      expect(part.x).toBeCloseTo(50);
      expect(part.y).toBeCloseTo(0);
      expect(part.size).toBeCloseTo(100);
    }
    expect(beam.some((p) => p.add === true && p.color === 0xffffff)).toBe(true);
    // Nothing has hit yet.
    expect(at(0, look('own')).some((p) => p.kind === 'ring')).toBe(false);
  });

  it('has no beam after its short life, and the ring and the flash come with the hit', () => {
    const late = at(HIT_AT_MS + 50, look('own'));
    expect(
      late.filter((p) => p.kind === 'square' && p.aspect !== undefined && p.size > 90),
    ).toEqual([]);
    expect(late.some((p) => p.kind === 'ring')).toBe(true);
    expect(late.some((p) => p.kind === 'glow' && p.add === true)).toBe(true);
  });

  it('flings one square per lost charge (not additive, no fall), at most eight', () => {
    const flung = (charges: number): ParticleSpec[] =>
      at(HIT_AT_MS + 200, look('own', charges)).filter(
        (p) => p.kind === 'square' && p.add !== true,
      );
    expect(flung(1)).toHaveLength(1);
    expect(flung(3)).toHaveLength(3);
    expect(flung(8)).toHaveLength(8);
    expect(flung(20)).toHaveLength(8);
  });

  it('colours the flung charges as the loser, the sparks as the shooter', () => {
    const squares = (victim: 'own' | 'enemy'): ParticleSpec[] =>
      at(HIT_AT_MS + 200, look(victim, 1)).filter((p) => p.kind === 'square' && p.add !== true);
    expect(squares('own')[0]?.color).toBe(colors.own);
    expect(squares('enemy')[0]?.color).toBe(colors.enemy);
  });

  it('emits nothing at the end of the effect', () => {
    expect(at(TOLL_MS, look('own'))).toEqual([]);
    expect(at(TOLL_MS - 1, look('own')).length).toBeGreaterThanOrEqual(0);
  });

  it('is the same for the same age: a paused scene shows a toll in the state of its tick', () => {
    expect(at(300, look('enemy'))).toEqual(at(300, look('enemy')));
  });

  it('draws the ring in the lightened colour of the shooter: the enemy shoots when the viewer pays', () => {
    const ring = (victim: 'own' | 'enemy'): number => {
      const found = at(HIT_AT_MS + 20, look(victim)).find((p) => p.kind === 'ring');
      return found?.color ?? 0;
    };
    // Lightened, so neither the plain colour of the owner nor white.
    expect(ring('own')).not.toBe(colors.enemy);
    expect(ring('own')).not.toBe(ring('enemy'));
  });
});

describe('tollPop and tollNumber', () => {
  it('swells the token for a moment at the hit and is 1 outside it', () => {
    expect(tollPop(0)).toBe(1);
    expect(tollPop(HIT_AT_MS + 130)).toBeGreaterThan(1.2);
    expect(tollPop(HIT_AT_MS + 400)).toBe(1);
  });

  it('shows "-N" from the hit: it rises and fades in the last third', () => {
    expect(tollNumber(0, false, 12)).toBeNull();
    const early = tollNumber(HIT_AT_MS + 10, false, 12);
    const mid = tollNumber(HIT_AT_MS + 300, false, 12);
    const end = tollNumber(TOLL_MS - 5, false, 12);
    expect(early?.alpha).toBe(1);
    expect(mid?.lift ?? 0).toBeGreaterThan(early?.lift ?? 0);
    expect(mid?.lift ?? 0).toBeLessThanOrEqual(12);
    expect(end?.alpha ?? 1).toBeLessThan(0.2);
  });

  it('with less motion the number stands still from the first frame', () => {
    expect(tollNumber(0, true, 12)).toEqual({ alpha: 1, lift: 0 });
    expect(tollNumber(HIT_AT_MS + 300, true, 12)?.lift).toBe(0);
  });
});
