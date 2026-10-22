/**
 * Geometry and state of the roads of the map (R1 "Lanes", ui-style 26, #345).
 *
 * Pure functions, no PixiJS and no DOM: `MapView`, `FogView` and `EntityView` apply their results,
 * and Vitest checks them directly. Nothing here knows a game rule: the level of a road, its
 * halves in fog and a build come from the player's view, the owners of the ends from the nodes.
 */
import type { Detail, PlayerId } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import { ROAD_LANE } from './style.ts';

type Owner = PlayerId | null;

/**
 * What a road is, by the owners of its ends: `internal` (both ends belong to one player: its
 * supply runs there and it can be upgraded) or `buffer` (the owners differ, or an end has none).
 */
export type RoadKind = { readonly kind: 'internal'; readonly owner: PlayerId } | { kind: 'buffer' };

export function roadKind(a: Owner, b: Owner): RoadKind {
  return a !== null && a === b ? { kind: 'internal', owner: a } : { kind: 'buffer' };
}

/**
 * How a stretch of road is drawn: `own0` / `own1`: solid lanes on a band of the colour of that
 * player; `buffer`: dashed lanes; `fog`: dotted lanes (a half in fog).
 */
export type RoadStyle = 'own0' | 'own1' | 'buffer' | 'fog';

export function roadStyle(kind: RoadKind, fog: boolean): RoadStyle {
  if (fog) return 'fog';
  return kind.kind === 'buffer' ? 'buffer' : kind.owner === 0 ? 'own0' : 'own1';
}

/** A stretch of a road from `from` to `to` (fractions 0..1 of its length) in one style. */
export interface RoadSegment {
  readonly from: number;
  readonly to: number;
  readonly style: RoadStyle;
}

/**
 * The stretches of a road: the half of the end `a` and the half of the end `b` are told apart at
 * `split` (the border point, DEC-21) when exactly one of them is in fog (`fog`: per half), else
 * the road is one stretch.
 */
export function roadSegments(
  kind: RoadKind,
  fog: readonly [boolean, boolean],
  split: number,
): RoadSegment[] {
  const [first, second] = fog;
  if (first === second) return [{ from: 0, to: 1, style: roadStyle(kind, first) }];
  return [
    { from: 0, to: split, style: roadStyle(kind, first) },
    { from: split, to: 1, style: roadStyle(kind, second) },
  ];
}

/** Offsets of the lanes of a road of `level` from its axis, across it (level = number of lanes). */
export function laneOffsets(level: number): number[] {
  const lanes = Math.max(1, Math.round(level));
  const pitch = ROAD_LANE.width + ROAD_LANE.gap;
  return Array.from({ length: lanes }, (_, i) => (i - (lanes - 1) / 2) * pitch);
}

/** A line of `length` cut into dashes: `[start, end]` of each, the last one shortened. */
export function dashRuns(length: number, dash: number, gap: number): [number, number][] {
  const runs: [number, number][] = [];
  if (length <= 0 || dash <= 0) return runs;
  for (let at = 0; at < length; at += dash + gap) runs.push([at, Math.min(length, at + dash)]);
  return runs;
}

/**
 * The dashes of the lanes of a road stretch as quadrilaterals in the world: the stretch starts at
 * `origin` and runs `length` along `angle` (radians); each of the `level` lanes (`laneOffsets`)
 * is cut into dashes of `dash` with `gap` between them, `width` wide.
 */
export function laneDashes(
  origin: Point,
  angle: number,
  length: number,
  level: number,
  dash: number,
  gap: number,
  width: number,
): Point[][] {
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const at = (along: number, across: number): Point => ({
    x: origin.x + ux * along - uy * across,
    y: origin.y + uy * along + ux * across,
  });
  const quads: Point[][] = [];
  for (const offset of laneOffsets(level)) {
    const near = offset - width / 2;
    const far = offset + width / 2;
    for (const [from, to] of dashRuns(length, dash, gap)) {
      quads.push([at(from, near), at(to, near), at(to, far), at(from, far)]);
    }
  }
  return quads;
}

/** What the fog layer needs to know of a road. */
export interface RoadFog {
  readonly detail: Detail;
  readonly halves: readonly { readonly detail: Detail; readonly seen: unknown }[];
}

/**
 * A road that was never seen: the level of the road is in fog, and neither of its halves has a
 * sighting (`seen`: every sighting of a place is recorded, also one without enemies, so `null` for
 * a half in fog means it was never in view). Its level is the 1 of DEC-17, not a known one.
 */
export function neverSeen(road: RoadFog): boolean {
  return (
    road.detail === 'fog' &&
    road.halves.length > 0 &&
    road.halves.every((half) => half.detail === 'fog' && half.seen === null)
  );
}

/**
 * The part of a road build that is done, 0..1: what the own build has left (`doneTick` is the tick
 * the level grows) of the `total` ticks a level takes. 0 without a known `total`.
 */
export function buildProgress(doneTick: number, tick: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - (doneTick - tick) / total));
}

// --- The tape of a road being built ------------------------------------------------------------

/** Cut a convex polygon to the strip `xMin <= x <= xMax` (Sutherland-Hodgman, two edges). */
function clipToStrip(polygon: readonly Point[], xMin: number, xMax: number): Point[] {
  const clip = (points: readonly Point[], inside: (p: Point) => boolean, x: number): Point[] => {
    const out: Point[] = [];
    points.forEach((current, i) => {
      const previous = points[(i + points.length - 1) % points.length];
      if (previous === undefined) return;
      const cross = (): Point => {
        const t = (x - previous.x) / (current.x - previous.x);
        return { x, y: previous.y + (current.y - previous.y) * t };
      };
      if (inside(current)) {
        if (!inside(previous)) out.push(cross());
        out.push(current);
      } else if (inside(previous)) {
        out.push(cross());
      }
    });
    return out;
  };
  const right = clip(polygon, (p) => p.x >= xMin, xMin);
  return clip(right, (p) => p.x <= xMax, xMax);
}

/**
 * The warning stripes of the tape over a road of `length` and `width`, in the frame of the road
 * (x along it from 0, y across, centred): slanted parallelograms at 45 degrees, `stripe` long and
 * one `period` apart, cut to the road. Empty for a road without length.
 */
export function tapeStripes(
  length: number,
  width: number,
  period: number,
  stripe: number,
): Point[][] {
  if (length <= 0 || width <= 0 || period <= 0 || stripe <= 0) return [];
  const half = width / 2;
  const stripes: Point[][] = [];
  // A stripe leans by the full width, so one that starts that far before the road still reaches it.
  for (let x0 = -width; x0 < length; x0 += period) {
    const polygon = clipToStrip(
      [
        { x: x0, y: -half },
        { x: x0 + stripe, y: -half },
        { x: x0 + stripe + width, y: half },
        { x: x0 + width, y: half },
      ],
      0,
      length,
    );
    if (polygon.length >= 3) stripes.push(polygon);
  }
  return stripes;
}
