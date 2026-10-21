import { describe, expect, it } from 'vitest';
import { DEV_RULES } from './devFeed.ts';
import {
  BIG_RING,
  RADIAL,
  SECTORS,
  SUPPLY_HALF,
  SUPPLY_RING,
  SUPPLY_SECTORS,
  frontOf,
  type SupplyChoice,
  halfFor,
  sectorHit,
  sectorPath,
  stanceRates,
} from './radial.ts';

describe('stanceRates', () => {
  it('gives mvp-0 the table of the guide: 3/18, 6/12, 9/6', () => {
    const rates = stanceRates(DEV_RULES);
    expect(rates.map((r) => [r.stance, r.cpPerMinCenti / 100, r.chargesPerMin])).toEqual([
      ['economy', 3, 18],
      ['balance', 6, 12],
      ['war', 9, 6],
    ]);
  });

  it('follows the ruleset, not constants', () => {
    const rules = {
      ...DEV_RULES,
      cp: { ...DEV_RULES.cp, per_period: 200 },
      economy: { ...DEV_RULES.economy, charges_per_cp: 3 },
    };
    // 200 per 5 s: 2400 centi-CP a minute; war: 25% = 50 centi into charges, 150 stay.
    const war = stanceRates(rules).find((r) => r.stance === 'war');
    expect(war?.cpPerMinCenti).toBe(150 * 12);
    expect(war?.chargesPerMin).toBe(Math.floor((50 * 3 * 12) / 100));
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

describe('the supply menu (DEC-18, DEC-28)', () => {
  const supply = SUPPLY_SECTORS.map((x) => ({ angle: x.angle, item: x.choice }));
  const hit = (dx: number, dy: number) => sectorHit(supply, dx, dy, SUPPLY_RING, SUPPLY_HALF);

  it('picks marker 1 up, marker 2 on the right and the transfer on the left', () => {
    expect(hit(0, -60)).toBe('front0');
    expect(hit(60, 0)).toBe('front1');
    expect(hit(-60, 0)).toBe('transfer');
    expect(hit(0, 0)).toBeNull();
  });

  it('is a smaller ring than the big one, as small as the group menu', () => {
    expect(SUPPLY_RING.outer).toBeLessThan(BIG_RING.outer);
  });

  it('has one key per sector: 1 and 2 for the markers, 3 for the transfer', () => {
    expect(SUPPLY_SECTORS.map((s) => [s.choice, s.key])).toEqual([
      ['front0', '1'],
      ['front1', '2'],
      ['transfer', '3'],
    ]);
  });

  it('tells the marker of a choice, none for the transfer', () => {
    expect(['front0', 'front1', 'transfer'].map((c) => frontOf(c as SupplyChoice))).toEqual([
      0,
      1,
      null,
    ]);
  });
});
