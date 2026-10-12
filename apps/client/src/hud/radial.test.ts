import { describe, expect, it } from 'vitest';
import { DEV_RULES } from './devFeed.ts';
import {
  RADIAL,
  ROAD_HALF,
  passivePerMinute,
  roadSectorAt,
  sectorAt,
  sectorPath,
  stanceRates,
} from './radial.ts';

describe('stanceRates', () => {
  it('gives mvp-0 the table of the guide: 3/18, 6/12, 9/6 and 12 from the capital', () => {
    const rates = stanceRates(DEV_RULES);
    expect(rates.map((r) => [r.stance, r.cpPerMinCenti / 100, r.chargesPerMin])).toEqual([
      ['economy', 3, 18],
      ['balance', 6, 12],
      ['war', 9, 6],
    ]);
    expect(passivePerMinute(DEV_RULES)).toBe(12);
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

describe('sectorAt', () => {
  it('cancels in the dead zone', () => {
    expect(sectorAt(0, 0)).toBeNull();
    expect(sectorAt(RADIAL.dead - 1, 0)).toBeNull();
  });

  it('picks balance up, economy down left and war down right', () => {
    expect(sectorAt(0, -80)).toBe('balance');
    expect(sectorAt(-70, 40)).toBe('economy');
    expect(sectorAt(70, 40)).toBe('war');
  });

  it('keeps the sector far outside the ring (a flick)', () => {
    expect(sectorAt(900, 500)).toBe('war');
    expect(sectorAt(-900, 500)).toBe('economy');
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

describe('roadSectorAt (road type menu, DEC-22)', () => {
  it('picks fast on the left and freight on the right; the middle cancels', () => {
    expect(roadSectorAt(0, 0)).toBeNull();
    expect(roadSectorAt(-80, 0)).toBe('fast');
    expect(roadSectorAt(80, 0)).toBe('freight');
    // Any part of a sector selects it, also near the top and bottom.
    expect(roadSectorAt(-5, -90)).toBe('fast');
    expect(roadSectorAt(5, 90)).toBe('freight');
  });

  it('draws sectors wider than a half circle with the large arc flag', () => {
    expect(sectorPath(0, 100)).toContain(' 0 1 1 ');
    expect(sectorPath(0, ROAD_HALF)).not.toContain(' 0 1 1 ');
  });
});
