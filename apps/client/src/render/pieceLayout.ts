/**
 * Geometry of the Engraved pieces of a city (#847, part 2 of #829; ui-style 53g, 55k, 57k and 57u):
 * the warehouse as a row of lozenges, the barracks and factory towers on the capacity ring (Cut and
 * ring towers), the Crown arc of a build (its owed charges as lozenges, then the build time), and the
 * recruit queue as small helmets on the ring after the barracks tower.
 *
 * Pure functions, no PixiJS. Every number comes from the snapshot (`warehouse`, `building`,
 * `factory_build`, `recruit_queue`, `recruit_progress`) and `ruleset_public` (the build times and
 * prices, `recruit.unit_ticks`); nothing about the rules is decided here (AGENTS.md 7.1). Angles are
 * in radians on screen (y grows down): 0 is to the right, `PI / 2` straight down.
 * Mockup: docs/design/mockups/in-game-style-r5.html (`stockMarks`, `towerGeo`, `buildPip5`,
 * `buildTowerR5`, `recruitCells`).
 */
import type { Point } from './camera.ts';
import { ringRadius } from './cityLayout.ts';
import { CROWN, LOZENGE, RECRUIT_PIPS, TOWER } from './style.ts';

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

// --- Towers on the ring (53g, 55k) -----------------------------------------------------------------

export type TowerKind = 'barracks' | 'factory';

/** Where a tower stands on the ring: the barracks at the upper left, the factory at the left. */
export function towerAngle(kind: TowerKind): number {
  return kind === 'barracks' ? TOWER.barracksAngle : TOWER.factoryAngle;
}

/**
 * The scale of a tower at `cameraScale` css px per world unit: at least `TOWER.minScale`, and big
 * enough to stay `TOWER.screen` css px per unit of its drawing (the mockup's `max(1.35, 1.7 / ZC)`)
 * down to the zoom where that needs more than `minScale`; zoomed out further it grows only by the
 * power `TOWER.keep` of the zoom, so the towers shrink on screen with the cities and never compete
 * with them (#869). Rounded up to a quarter octave so that a zoom gesture redraws the towers only now
 * and then.
 */
export function towerScale(cameraScale: number): number {
  const out = TOWER.screen / TOWER.minScale / Math.max(1e-3, cameraScale);
  const exact = TOWER.minScale * Math.max(1, out) ** TOWER.keep;
  return 2 ** (Math.ceil(Math.log2(exact) * 4) / 4);
}

/** The middle of the tower of `kind` on the ring of a city of `radius`, from its centre. */
export function towerPoint(radius: number, kind: TowerKind): Point {
  const d = ringRadius(radius) + TOWER.out;
  const a = towerAngle(kind);
  return { x: d * Math.cos(a), y: d * Math.sin(a) };
}

/** The rotation of a tower: its top points away from the city. */
export function towerRotation(kind: TowerKind): number {
  return towerAngle(kind) + Math.PI / 2;
}

/**
 * The outline of a tower in its own frame (y up is -y, away from the city), at scale 1: the barracks
 * a square block, the factory a hall with two saw teeth.
 */
export function towerOutline(kind: TowerKind): readonly (readonly [number, number])[] {
  return kind === 'barracks' ? TOWER.barracks : TOWER.factory;
}

// --- The Crown arc of a build (57k) -----------------------------------------------------------------

export interface Crown {
  /** The radius of the arc round the city centre. */
  readonly radius: number;
  /** The angle where the arc starts (the time fills from there) and its span. */
  readonly from: number;
  readonly span: number;
  /** The centres and angles of the lozenges of the owed charges, in the order they are paid. */
  readonly lozenges: readonly { x: number; y: number; angle: number }[];
}

/**
 * The Crown arc over the tower of `kind` on a city of `radius` for a build of `cost` charges, the
 * tower at `scale` (`towerScale`): concentric with the city ring, just outside the top of the tower;
 * the lozenges `CROWN.step` apart round the tower's angle.
 */
export function crownArc(radius: number, kind: TowerKind, cost: number, scale: number): Crown {
  const top = ringRadius(radius) + TOWER.out + TOWER.halfHeight * scale;
  const r = top + CROWN.lift;
  const n = Math.max(1, Math.floor(cost));
  const span = Math.max(CROWN.minSpan, ((n + 0.9) * CROWN.step) / r);
  const mid = towerAngle(kind);
  const lozenges = [];
  for (let j = 0; j < n; j++) {
    const a = mid + (j - (n - 1) / 2) * (CROWN.step / r);
    lozenges.push({ x: r * Math.cos(a), y: r * Math.sin(a), angle: a });
  }
  return { radius: r, from: mid - span / 2, span, lozenges };
}

/** What a build shows: the charges it costs, how many are paid, and the share of its time done. */
export interface BuildProgress {
  readonly cost: number;
  readonly paid: number;
  /** 0..1 of the build time from the full payment; 0 while charges are owed. */
  readonly time: number;
  /** All the charges are paid: the time runs (the tower fills, the arc sweeps). */
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

/** The share rounded down to `steps` (one baked texture per step); 0 stays 0 and 1 stays 1. */
export function quantize(share: number, steps: number): number {
  if (!(share > 0)) return 0;
  if (share >= 1) return 1;
  return Math.floor(share * steps) / steps;
}

// --- The recruit queue as small helmets (55k) ------------------------------------------------------

/**
 * The centre and the angle of recruit slot `j` on the ring of a city of `radius`: after the barracks
 * tower, clockwise over the top of the ring.
 */
export function recruitPip(radius: number, j: number): { x: number; y: number; angle: number } {
  const d = ringRadius(radius) + TOWER.out;
  const a = TOWER.barracksAngle + RECRUIT_PIPS.first + j * RECRUIT_PIPS.step;
  return { x: d * Math.cos(a), y: d * Math.sin(a), angle: a };
}
