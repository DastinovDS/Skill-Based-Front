/**
 * Geometry of the Engraved pieces of a city (#847, part 2 of #829; ui-style 57u and 57k): the
 * warehouse as a row of lozenges and what a build shows (the charges it costs, how many are paid,
 * the share of its time done). Where the buildings and the recruit queue stand is `buildingLayout.ts`.
 *
 * Pure functions, no PixiJS. Every number comes from the snapshot (`warehouse`, `building`,
 * `factory_build`) and `ruleset_public` (the build times and prices); nothing about the rules is
 * decided here (AGENTS.md 7.1).
 */
import { ringRadius } from './cityLayout.ts';
import { LOZENGE } from './style.ts';

// --- The warehouse as lozenges (57u) ----------------------------------------------------------------

/**
 * The centres of `n` lozenges in a row round x = 0: `LOZENGE.pitch` apart, set in threes past four
 * (the capital's six read as two threes; a row of four stays one run).
 */
export function lozengeRow(n: number): number[] {
  const count = Math.max(0, Math.floor(n));
  if (count === 0) return [];
  const gap = count > 4 ? LOZENGE.groupGap : 0;
  const width = (count - 1) * LOZENGE.pitch + Math.floor((count - 1) / 3) * gap;
  const xs: number[] = [];
  for (let j = 0; j < count; j++) xs.push(-width / 2 + j * LOZENGE.pitch + Math.floor(j / 3) * gap);
  return xs;
}

/** The middle of the warehouse row under a city of `radius`, from its centre. */
export function lozengeRowY(radius: number): number {
  return ringRadius(radius) + LOZENGE.drop;
}

/** What a build shows: the charges it costs, how many are paid, and the share of its time done. */
export interface BuildProgress {
  readonly cost: number;
  readonly paid: number;
  /** 0..1 of the build time from the full payment; 0 while charges are owed. */
  readonly time: number;
  /** All the charges are paid: the time runs (the icon fills). */
  readonly running: boolean;
}

/**
 * A build from the snapshot: `owed` charges still to pay (`NodeBuilding.owed`, `SiteBuild.owed`),
 * `price` the charges it costs in all (`ruleset_public`; `null`: not known, then the owed ones are
 * the whole price shown), `doneTick` the tick it ends (`null` while charges are owed), `total` the
 * ticks of its time, `tick` the tick now (fractional between two snapshots).
 */
export function buildProgress(
  owed: number,
  price: number | null,
  doneTick: number | null,
  total: number,
  tick: number,
): BuildProgress {
  const due = Math.max(0, Math.floor(owed));
  const cost = Math.max(due, price === null ? due : Math.max(0, Math.floor(price)));
  const running = due === 0 && doneTick !== null;
  let time = 0;
  if (running && total > 0) {
    const left = Math.max(0, doneTick - tick);
    time = Math.min(1, Math.max(0, (total - left) / total));
  }
  return { cost, paid: cost - due, time, running };
}
