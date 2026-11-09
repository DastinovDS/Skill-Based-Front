// `import.meta.env` of Vite: the e2e package type-checks this file through `camera.ts` too.
/// <reference types="vite/client" />
/**
 * The softness of the Engraved lines of the map (#865): the owner found the light hairlines on the
 * dark ground too sharp. One place for the knobs every line of the map reads:
 *
 * - `ink`: the ivory of the ink lines of the pieces and marks (helmets, walls, arrows, rings, the
 *   edge of sight), darker and warmer as the level rises;
 * - `line`: a factor of the alpha of the light lines of the map (the border rules and beads, the
 *   cut and the faint area line, the lanes of the roads, the edge of sight);
 * - `hatch`: a factor of the alpha of the hatches (the Border band, the rules of the fog veil, the
 *   hatched arrows and ribbons);
 * - `weight`: the thinnest stroke in device pixels (1 before #865): a little thicker and fainter, a
 *   line shimmers less when the map pans or zooms.
 *
 * Level 0 is the look of #829 as merged. A dev scene or the dev server takes another level from
 * `?soft=<0..3>` (`devSoftLevel`); a production build always draws `DEFAULT_SOFT_LEVEL`.
 */

export interface Softness {
  readonly ink: number;
  readonly line: number;
  readonly hatch: number;
  readonly weight: number;
}

/** 0 = as merged (#829), 1 = slight, 2 = medium, 3 = strong. */
export const SOFT_LEVELS: readonly Softness[] = [
  { ink: 0xece4d1, line: 1, hatch: 1, weight: 1 },
  { ink: 0xdcd2bc, line: 0.86, hatch: 0.82, weight: 1.15 },
  { ink: 0xccc0a6, line: 0.74, hatch: 0.66, weight: 1.3 },
  { ink: 0xbaad92, line: 0.62, hatch: 0.52, weight: 1.5 },
];

/** The level a production build draws. */
export const DEFAULT_SOFT_LEVEL = 0;

/** The level of `?soft=<n>` in a query string, or `fallback` when there is none or it is not a level. */
export function softLevelOf(search: string, fallback = DEFAULT_SOFT_LEVEL): number {
  const raw = new URLSearchParams(search).get('soft');
  const level = raw === null || raw === '' ? Number.NaN : Number(raw);
  return Number.isInteger(level) && level >= 0 && level < SOFT_LEVELS.length ? level : fallback;
}

/** The level of this page: `?soft=` on the dev server, the default in a production build. */
function devSoftLevel(): number {
  if (!import.meta.env.DEV || typeof window === 'undefined') return DEFAULT_SOFT_LEVEL;
  return softLevelOf(window.location.search);
}

/** The softness the map draws with; read once when the page loads. */
export const SOFT: Softness = SOFT_LEVELS[devSoftLevel()] ?? (SOFT_LEVELS[0] as Softness);
