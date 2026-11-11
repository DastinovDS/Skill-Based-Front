import { Graphics } from 'pixi.js';
import { ENGRAVED, easeSettle } from '../theme/tokens.ts';
import { iconHalf } from './buildingLayout.ts';
import { tickPoints, type TickCorner } from './cornerTicks.ts';
import { BUILDING, BUILD_TICKS, CASING } from './style.ts';

/**
 * The corner ticks round a building just finished (#972, V12 "Toast", ui-style 75): the B6 ticks of
 * #949 for 3 s, then a short fade. Pure timing and geometry here; `cityView.ts` owns the `Graphics`.
 */

/** How the ticks look `ageMs` after the finish: `null` when they are gone. */
export interface BuildTicksShow {
  /** 0..1 of the whole mark (the fade at the end). */
  readonly alpha: number;
  /** How far outside its seat the mark still is, 0 (arrived) to 1. */
  readonly grow: number;
}

/**
 * The ticks at `ageMs` after the finish. They grow in over `growMs` (at once under "less motion",
 * where they stand still), hold until `holdMs`, fade over `fadeMs`, then `null`.
 */
export function buildTicksShow(ageMs: number, reduced: boolean): BuildTicksShow | null {
  const { holdMs, fadeMs, growMs } = BUILD_TICKS;
  if (ageMs >= holdMs + fadeMs) return null;
  const alpha = ageMs <= holdMs ? 1 : 1 - (ageMs - holdMs) / fadeMs;
  const grow = reduced ? 0 : 1 - easeSettle(Math.min(1, Math.max(0, ageMs) / growMs));
  return { alpha, grow };
}

/** The ticks round an icon of `size` world units: the half side of their box and the arm length. */
export function buildTicksBox(size: number): { edge: number; arm: number; unit: number } {
  const unit = Math.max(1, size / BUILDING.world);
  return {
    edge: iconHalf(size) + BUILD_TICKS.gap * unit,
    arm: Math.max(BUILD_TICKS.arm.min * unit, BUILD_TICKS.arm.share * size),
    unit,
  };
}

/** The four corners of the box of half side `edge`, clockwise from the top left. */
export function buildTickCorners(edge: number): TickCorner[] {
  return [
    { x: -edge, y: -edge, sx: 1, sy: 1 },
    { x: edge, y: -edge, sx: -1, sy: 1 },
    { x: edge, y: edge, sx: -1, sy: -1 },
    { x: -edge, y: edge, sx: 1, sy: -1 },
  ];
}

/** Draws the ticks of an icon of `size` into `g` (cleared first), centred on the icon's seat. */
export function drawBuildTicks(g: Graphics, size: number, show: BuildTicksShow): void {
  g.clear();
  const { edge, arm, unit } = buildTicksBox(size);
  const grow = show.grow * BUILD_TICKS.grow * unit;
  const corners = buildTickCorners(edge);
  for (const pass of ['casing', 'ink'] as const) {
    for (const corner of corners) {
      tickPoints(corner, grow, arm).forEach(([x, y], i) => {
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
    }
    if (pass === 'casing') {
      g.stroke({
        width: BUILD_TICKS.casing.width * unit,
        color: CASING,
        alpha: BUILD_TICKS.casing.alpha * show.alpha,
        cap: 'square',
        join: 'miter',
      });
    } else {
      g.stroke({
        width: BUILD_TICKS.ink.width * unit,
        color: ENGRAVED.ink,
        alpha: show.alpha,
        cap: 'butt',
        join: 'miter',
      });
    }
  }
}
