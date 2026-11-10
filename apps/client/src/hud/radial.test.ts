import { describe, expect, it } from 'vitest';
import type { RulesetPublic } from '../protocol.gen.ts';
import { DEV_RULES_STANCES } from './devFeed.ts';
import {
  BIG_RING,
  RADIAL,
  SECTORS,
  halfFor,
  sectorHit,
  sectorPath,
  stanceRates,
} from './radial.ts';

/** The stance rules of `mvp-4-stances` with `factories_follow` set (DEC-47). */
function withKey(factoriesFollow: boolean): RulesetPublic {
  const { stances } = DEV_RULES_STANCES;
  return { ...DEV_RULES_STANCES, stances: { ...stances, factories_follow: factoriesFollow } };
}

describe('stanceRates', () => {
  it('reads the periods of `stances` under economy v2 (DEC-44)', () => {
    // 600 ticks a minute: War 600 / 80 CP and 600 / 400 charges, Balance 6 and 3, Economy 3 and 6.
    const rates = stanceRates(DEV_RULES_STANCES);
    expect(rates.map((r) => [r.stance, r.cpPerMinCenti / 100, r.chargesPerMin])).toEqual([
      ['economy', 3, 6],
      ['balance', 6, 3],
      ['war', 7.5, 1.5],
    ]);
  });

  it('multiplies the charges by the working factories under factories_follow (DEC-47)', () => {
    const rules = withKey(true);
    // The capital and two more: three times the capital's 6 / 3 / 1.5 a minute.
    expect(
      stanceRates(rules, 3).map((r) => [r.stance, r.cpPerMinCenti / 100, r.chargesPerMin]),
    ).toEqual([
      ['economy', 3, 18],
      ['balance', 6, 9],
      ['war', 7.5, 4.5],
    ]);
    // Only the capital works (or no count given): the capital's rate.
    expect(stanceRates(rules, 1).map((r) => r.chargesPerMin)).toEqual([6, 3, 1.5]);
    expect(stanceRates(rules).map((r) => r.chargesPerMin)).toEqual([6, 3, 1.5]);
  });
});

describe('sectorHit', () => {
  const stance = SECTORS.map((x) => ({ angle: x.angle, item: x.stance }));
  const half = halfFor(stance.length);
  const hit = (dx: number, dy: number) => sectorHit(stance, dx, dy, BIG_RING, half);

  it('picks balance up, economy down left and war down right', () => {
    expect(hit(0, -80)).toBe('balance');
    expect(hit(-70, 40)).toBe('economy');
    expect(hit(70, 40)).toBe('war');
  });

  it('hits only the drawn segment: not the hole, not past the rim, not at the edge of the ring', () => {
    expect(hit(0, 0)).toBeNull();
    expect(hit(0, -(BIG_RING.inner - 1))).toBeNull();
    expect(hit(0, -BIG_RING.inner)).toBe('balance');
    expect(hit(0, -BIG_RING.outer)).toBe('balance');
    expect(hit(0, -(BIG_RING.outer + 1))).toBeNull();
    expect(hit(900, 500)).toBeNull(); // a flick far outside no longer counts
  });

  it('leaves the gaps between neighbours out and takes the angles to the edge', () => {
    // Three sectors of 120 degrees with half = 59: a gap of 2 degrees at 330 (between balance
    // at 270 and war at 30), 90 px from the middle.
    const at = (deg: number) => [
      90 * Math.cos((deg * Math.PI) / 180),
      90 * Math.sin((deg * Math.PI) / 180),
    ];
    expect(hit(...(at(330) as [number, number]))).toBeNull();
    expect(hit(...(at(328.5) as [number, number]))).toBe('balance');
    expect(hit(...(at(331.5) as [number, number]))).toBe('war');
  });
});

describe('sectorPath', () => {
  it('is a closed ring sector between the inner and the outer radius', () => {
    const path = sectorPath(270);
    expect(path.startsWith('M')).toBe(true);
    expect(path.endsWith('Z')).toBe(true);
    expect(path).toContain(`A${String(RADIAL.outer)} ${String(RADIAL.outer)}`);
    expect(path).toContain(`A${String(RADIAL.inner)} ${String(RADIAL.inner)}`);
  });
});

describe('sectorPath', () => {
  it('draws sectors wider than a half circle with the large arc flag', () => {
    expect(sectorPath(0, 100)).toContain(' 0 1 1 ');
    expect(sectorPath(0, 89)).not.toContain(' 0 1 1 ');
  });
});
