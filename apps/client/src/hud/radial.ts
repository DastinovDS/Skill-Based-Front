/**
 * The radial menus (ui-style 11; one component, `Radial.svelte`, draws them all): geometry, the
 * table of numbers of the stance menu from the ruleset and which sector a pointer is over. Pure
 * functions, no DOM.
 */
import type { RulesetPublic, Stance } from '../protocol.gen.ts';

export const RADIAL = {
  /** Outer and inner radius of the ring, and the dead zone of "cancel" (CSS px). */
  outer: 150,
  inner: 34,
  dead: 28,
  /** Half the angle of a sector (a gap between neighbours). */
  half: 58,
  /** A press shorter than this keeps the menu open (ms); longer: release selects. */
  tapMs: 200,
} as const;

/** The two radii of a ring (CSS px); a menu on a city has its hole as wide as the city's circle. */
export interface RadialRing {
  readonly inner: number;
  readonly outer: number;
}

/** The big ring of the menus at the middle of the screen or under the pointer. */
export const BIG_RING: RadialRing = { inner: RADIAL.inner, outer: RADIAL.outer };

/** The menu of a group: a small ring around its icon (a few big sectors). */
export const GROUP_RING: RadialRing = { inner: 26, outer: 96 };

/** One sector of a menu, as `Radial.svelte` draws it. */
export interface RadialItem {
  readonly id: string;
  /** Screen angle of the middle of the sector (degrees, y down; 270 is up). */
  readonly angle: number;
  /** Its name; the current choice is marked with a tick by the caller (`current`). */
  readonly label: string;
  /** A big glyph over the name: the shape tells the choice as well as the colour. */
  readonly sign?: string;
  /** Small lines under the name (a price, a number from the ruleset). */
  readonly lines?: readonly string[];
  /** The key that does the same (not translated); drawn as a key cap. */
  readonly key?: string;
  /** The choice that is on now: a thicker outline and a tick. */
  readonly current?: boolean;
  /**
   * Draw only the glyph, the `lines` and the key: no name text (it stays the accessible name of
   * the sector). For a menu whose sectors the glyph and the price tell by themselves.
   */
  readonly compact?: boolean;
  /** Cannot be chosen now: dimmed, never lit by the pointer. */
  readonly disabled?: boolean;
}

/**
 * Screen angles (degrees, y down) of `n` sectors spread evenly, the first on top and the rest
 * clockwise; two sectors sit left and right (they would be one above the other otherwise).
 */
export function spreadAngles(n: number): number[] {
  if (n === 2) return [180, 0];
  return Array.from({ length: n }, (_, i) => (270 + (360 * i) / n) % 360);
}

/** Half the angle of one of `n` sectors: wide, with a small gap between neighbours. */
export function halfFor(n: number): number {
  return n <= 1 ? 58 : Math.min(89, 180 / n - 1);
}

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
 * The item whose drawn ring segment holds the pointer at (`dx`, `dy`) from the middle of a menu:
 * between the inner and the outer radius and within `half` degrees of the sector's angle. The
 * hit area is the drawn segment exactly: the hole, the gaps between sectors and everything outside
 * the ring give `null`.
 */
export function sectorHit<T>(
  sectors: readonly { readonly angle: number; readonly item: T }[],
  dx: number,
  dy: number,
  ring: RadialRing,
  half: number,
): T | null {
  const distance = Math.hypot(dx, dy);
  if (distance < ring.inner || distance > ring.outer) return null;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  for (const { item, angle: centre } of sectors) {
    // The angular distance to the centre of the sector, 0..180.
    const apart = Math.abs(((((angle - centre + 540) % 360) + 360) % 360) - 180);
    if (apart <= half) return item;
  }
  return null;
}

/** SVG path of the ring sector around `centre` degrees, relative to the middle of the menu. */
export function sectorPath(
  centre: number,
  half: number = RADIAL.half,
  ring: RadialRing = BIG_RING,
): string {
  const rad = (deg: number): number => (deg * Math.PI) / 180;
  const at = (r: number, deg: number): string =>
    `${(r * Math.cos(rad(deg))).toFixed(2)} ${(r * Math.sin(rad(deg))).toFixed(2)}`;
  const a0 = centre - half;
  const a1 = centre + half;
  const { outer, inner } = ring;
  const large = a1 - a0 > 180 ? 1 : 0;
  return (
    `M${at(outer, a0)} A${String(outer)} ${String(outer)} 0 ${String(large)} 1 ${at(outer, a1)} ` +
    `L${at(inner, a1)} A${String(inner)} ${String(inner)} 0 ${String(large)} 0 ${at(inner, a0)} Z`
  );
}

/** Where the text of a sector sits (relative to the middle of the menu). */
export function labelPoint(centre: number, ring: RadialRing = BIG_RING): { x: number; y: number } {
  const rad = (centre * Math.PI) / 180;
  const r = ring === BIG_RING ? ring.outer * 0.62 : (ring.inner + ring.outer) / 2;
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

/**
 * A choice of the supply menu of an own city (DEC-28, items 2 and 6): put front marker 1 or 2 on
 * the city (or take it off when it stands there), or start a transfer from it.
 */
export type SupplyChoice = 'front0' | 'front1' | 'transfer';

/** The marker index (0 or 1) of a marker choice; `null` for the transfer. */
export function frontOf(choice: SupplyChoice): number | null {
  return choice === 'front0' ? 0 : choice === 'front1' ? 1 : null;
}

/**
 * The supply menu of an own city: marker 1 up (key 1), marker 2 on the right (key 2), the transfer
 * on the left (key 3). The markers come first: placing them is what the mode is mostly for.
 */
export const SUPPLY_SECTORS: readonly {
  readonly choice: SupplyChoice;
  readonly angle: number;
  readonly key: string;
}[] = [
  { choice: 'front0', angle: 270, key: '1' },
  { choice: 'front1', angle: 0, key: '2' },
  { choice: 'transfer', angle: 180, key: '3' },
];

/** The ring of the supply menu: small, a narrow band like the city menu's (not the big ring). */
export const SUPPLY_RING: RadialRing = { inner: 30, outer: 112 };

/** Half the angle of a supply sector: sectors a quarter turn apart with a gap between them. */
export const SUPPLY_HALF = 44;
