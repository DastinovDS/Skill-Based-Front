import { HELMET_SCALE, helmet, helmetExtent, type HelmetKind } from '../units/helmet.ts';
import { fitReach } from './cityLayout.ts';
import { HELMET_INSIDE, PROVINCE, UNIT_SIDES } from './style.ts';

/** Width of the helmet of a token of size step `side` (a city icon is a little smaller). */
export function helmetWidth(side: number, inside: boolean): number {
  return Math.round(side * HELMET_SCALE * (inside ? HELMET_INSIDE : 1) * 100) / 100;
}

/**
 * The width of the helmet `kind` of width `width`, or a smaller one whose drawing (casing and strap
 * included) reaches no further than `reach` from its middle: a unit icon stays inside the capacity
 * ring (#940). Rounded down to a quarter unit so the baked keys stay few.
 */
export function helmetFit(kind: HelmetKind, width: number, reach: number): number {
  let w = width;
  // The casing and the strap do not scale with the width, so the first guess can still be a little
  // too wide: a few steps settle it.
  for (let step = 0; step < 6 && w > 4; step++) {
    const e = helmetExtent(helmet(kind, w));
    const span = Math.max(e.right, -e.left, e.bottom, -e.top);
    if (span <= reach) break;
    w = Math.min(w - 0.25, Math.floor(((w * reach) / span) * 4) / 4);
  }
  return w;
}

/**
 * The share of its full width the helmet of a small group keeps in a province (A6, #949): the
 * match's fitted width over the full one. The backdrops of the menus, which draw their own helmets,
 * follow it.
 */
export function provinceHelmetShare(): number {
  const full = helmetWidth(UNIT_SIDES[0], true);
  return helmetFit('own', full, fitReach(PROVINCE.radius)) / full;
}
