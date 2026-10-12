/**
 * The stance radial menu (ui-style 11): geometry, the table of numbers from the ruleset and which
 * sector a pointer is over. Pure functions, no DOM.
 */
import type { RulesetPublic, Stance } from '../protocol.gen.ts';

export const RADIAL = {
  /** Outer and inner radius of the ring, and the dead zone of "cancel" (CSS px). */
  outer: 150,
  inner: 34,
  dead: 28,
  /** Half the angle of a sector (116 degrees in all, with a gap between neighbours). */
  half: 58,
  /** A press shorter than this keeps the menu open (ms); longer: release selects. */
  tapMs: 200,
} as const;

/** The fixed order: economy bottom left, balance on top, war bottom right (screen angles, y down). */
export const SECTORS: readonly {
  readonly stance: Stance;
  readonly angle: number;
  readonly key: string;
}[] = [
  { stance: 'economy', angle: 150, key: '1' },
  { stance: 'balance', angle: 270, key: '2' },
  { stance: 'war', angle: 30, key: '3' },
];

/**
 * The item whose sector centre (`angle`, screen degrees) is nearest to the pointer at (`dx`, `dy`)
 * from the middle of a menu; `null` in the dead zone. Any part of a sector selects it.
 */
export function nearestSector<T>(
  sectors: readonly { readonly angle: number; readonly item: T }[],
  dx: number,
  dy: number,
): T | null {
  if (Math.hypot(dx, dy) < RADIAL.dead) return null;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  let best: T | null = null;
  let nearest = Infinity;
  for (const { item, angle: centre } of sectors) {
    // The angular distance to the centre of the sector, 0..180.
    const distance = Math.abs(((((angle - centre + 540) % 360) + 360) % 360) - 180);
    if (distance < nearest) {
      nearest = distance;
      best = item;
    }
  }
  return best;
}

const STANCE_SECTORS = SECTORS.map((s) => ({ angle: s.angle, item: s.stance }));

/** The stance whose sector is nearest to the pointer at (`dx`, `dy`) from the centre; `null` in the dead zone. */
export function sectorAt(dx: number, dy: number): Stance | null {
  return nearestSector(STANCE_SECTORS, dx, dy);
}

/** A road type the first upgrade chooses (DEC-22). */
export type RoadType = 'fast' | 'freight';

/** The road type menu (DEC-22): fast on the left, freight on the right; keys 1 and 2. */
export const ROAD_SECTORS: readonly {
  readonly type: RoadType;
  readonly angle: number;
  readonly key: string;
}[] = [
  { type: 'fast', angle: 180, key: '1' },
  { type: 'freight', angle: 0, key: '2' },
];

/** Half the angle of a road type sector: two sectors of 144 degrees with gaps between them. */
export const ROAD_HALF = 72;

const TYPE_SECTORS = ROAD_SECTORS.map((s) => ({ angle: s.angle, item: s.type }));

/** The road type under the pointer at (`dx`, `dy`) from the middle of the menu; `null`: dead zone. */
export function roadSectorAt(dx: number, dy: number): RoadType | null {
  return nearestSector(TYPE_SECTORS, dx, dy);
}

/** SVG path of the ring sector around `centre` degrees, relative to the middle of the menu. */
export function sectorPath(centre: number, half: number = RADIAL.half): string {
  const rad = (deg: number): number => (deg * Math.PI) / 180;
  const at = (r: number, deg: number): string =>
    `${(r * Math.cos(rad(deg))).toFixed(2)} ${(r * Math.sin(rad(deg))).toFixed(2)}`;
  const a0 = centre - half;
  const a1 = centre + half;
  const { outer, inner } = RADIAL;
  const large = a1 - a0 > 180 ? 1 : 0;
  return (
    `M${at(outer, a0)} A${String(outer)} ${String(outer)} 0 ${String(large)} 1 ${at(outer, a1)} ` +
    `L${at(inner, a1)} A${String(inner)} ${String(inner)} 0 ${String(large)} 0 ${at(inner, a0)} Z`
  );
}

/** Where the text of a sector sits (relative to the middle of the menu). */
export function labelPoint(centre: number): { x: number; y: number } {
  const rad = (centre * Math.PI) / 180;
  const r = RADIAL.outer * 0.62;
  return { x: r * Math.cos(rad), y: r * Math.sin(rad) };
}

export interface StanceRate {
  readonly stance: Stance;
  /** CP a minute that stay CP, in hundredths. */
  readonly cpPerMinCenti: number;
  /** Charges a minute that the stance turns CP into (the capital's own production is extra). */
  readonly chargesPerMin: number;
}

/**
 * The two numbers of a stance from the public ruleset (not rules, only arithmetic over them):
 * every `cp.period_ticks` the quantum `cp.per_period` is split, `pct` percent (rounded down) into
 * charges at `charges_per_cp`, the rest stays CP. Same arithmetic as `gow_sim.systems.economy`.
 * With `mvp-0`: economy 3 / 18, balance 6 / 12, war 9 / 6.
 */
export function stanceRates(rules: RulesetPublic): StanceRate[] {
  const { cp, economy, tick_hz } = rules;
  const ticksPerMinute = 60 * tick_hz;
  return SECTORS.map(({ stance }) => {
    const toCharges = Math.floor((cp.per_period * economy.stance_to_charges_pct[stance]) / 100);
    return {
      stance,
      cpPerMinCenti: Math.floor(((cp.per_period - toCharges) * ticksPerMinute) / cp.period_ticks),
      chargesPerMin: Math.floor(
        (toCharges * economy.charges_per_cp * ticksPerMinute) / cp.period_ticks / 100,
      ),
    };
  });
}

/** Charges a minute the capital makes in any stance (`economy.passive_*`). */
export function passivePerMinute(rules: RulesetPublic): number {
  const { economy, tick_hz } = rules;
  return Math.floor((economy.passive_amount * 60 * tick_hz) / economy.passive_period_ticks);
}
