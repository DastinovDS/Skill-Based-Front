/**
 * Geometry and numbers of an enemy figure on a half of a road (EF2 "Pointer", entering and leaving
 * "Dissolve and marks", #354, ui-style 27, DEC-33): a ▽ token, a solid pointer head in front of it, a
 * plate with the level under it, the figure dissolving in over `FIGURE.dissolve` units from the
 * border point, and on entering a ring and a tick on the border point.
 *
 * Pure functions, no PixiJS and no DOM. Position, direction and level come from `EnemyGroup`
 * (`pos`, `toward_b`, `detail`, `units`, `charged`, `units_range`); nothing is decided here.
 */
import { tf } from '../i18n/index.ts';
import type { EnemyGroup } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import { rangeLabel } from './rangeLabel.ts';

export const FIGURE = {
  /** The head: its tip this far in front of the token centre, its length and its width. */
  head: { tip: 30, length: 14, width: 8 },
  /** The plate with the level: its centre this far under the token centre, its height and side padding. */
  plate: { drop: 26, height: 16, padX: 6, fontSize: 11 },
  /** The figure goes from invisible to opaque over this many world units from the border point. */
  dissolve: 24,
  /** A figure first seen this close to the border point (world units) has come out of the fog. */
  entryNear: 40,
  /** The ring on entering spreads from `from` to `to` over `ringSeconds`; the tick fades over `tickSeconds`. */
  entry: { from: 6, to: 28, ringSeconds: 0.8, tickSeconds: 2, tickHalf: 12 },
} as const;

/** Opacity of a figure `distance` world units from the border point inside its visible half. */
export function dissolveAlpha(distance: number): number {
  return Math.min(1, Math.max(0, distance / FIGURE.dissolve));
}

/**
 * The text of the plate: «4 · 3●» (units and charged) at the exact level, the range («3-5») at the
 * range level, `null` at presence (the dashed token with its «?» is the level then).
 */
export function plateText(figure: EnemyGroup): string | null {
  if (figure.detail === 'exact' && figure.units !== null && figure.charged !== null) {
    return tf('figure.plate', { units: figure.units, charged: figure.charged });
  }
  if (figure.detail === 'range' && figure.units_range !== null) {
    return rangeLabel(figure.units_range);
  }
  return null;
}

/** The unit vector of the direction the figure goes along the road `a` → `b`. */
export function heading(a: Point, b: Point, towardB: boolean): Point {
  const [from, to] = towardB ? [a, b] : [b, a];
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  return length === 0
    ? { x: 1, y: 0 }
    : { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
}

/** The three corners of the pointer head round the token centre: the tip in front, the base behind it. */
export function headCorners(dir: Point): [Point, Point, Point] {
  const { tip, length, width } = FIGURE.head;
  const baseX = dir.x * (tip - length);
  const baseY = dir.y * (tip - length);
  // The normal of the direction: the base is `width` wide.
  const nx = -dir.y * (width / 2);
  const ny = dir.x * (width / 2);
  return [
    { x: dir.x * tip, y: dir.y * tip },
    { x: baseX + nx, y: baseY + ny },
    { x: baseX - nx, y: baseY - ny },
  ];
}

export interface EntryMarks {
  /** The ring on the border point: its radius and opacity; `null` once it has spread. */
  readonly ring: { readonly radius: number; readonly alpha: number } | null;
  /** The tick across the road: its opacity; `null` after `tickSeconds`. */
  readonly tick: { readonly alpha: number } | null;
}

/**
 * The marks of a figure that came out of the fog `age` seconds ago: one ring spreading from the
 * border point (none with "less motion") and a tick that stays for 2 s, fading over its last second.
 */
export function entryMarks(age: number, reduced: boolean): EntryMarks {
  const { from, to, ringSeconds, tickSeconds } = FIGURE.entry;
  const spread = age / ringSeconds;
  const ring =
    reduced || age < 0 || spread >= 1
      ? null
      : { radius: from + (to - from) * spread, alpha: 1 - spread };
  const tick =
    age < 0 || age >= tickSeconds ? null : { alpha: Math.min(1, Math.max(0, tickSeconds - age)) };
  return { ring, tick };
}

/** Whether a figure first seen `distance` world units from the border point came out of the fog there. */
export function cameOutOfFog(distance: number): boolean {
  return distance <= FIGURE.entryNear;
}
