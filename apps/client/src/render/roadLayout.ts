/**
 * Geometry and state of the roads of the map (R1 "Lanes", ui-style 26, #345).
 *
 * Pure functions, no PixiJS and no DOM: `MapView`, `FogView` and `EntityView` apply their results,
 * and Vitest checks them directly. Nothing here knows a game rule: the halves of a road in fog come
 * from the player's view, the owners of the ends from the nodes.
 */
import type { PlayerId } from '../protocol.gen.ts';
import type { Point } from './camera.ts';

type Owner = PlayerId | null;

/**
 * What a road is, by the owners of its ends: `internal` (both ends belong to one player: its
 * supply runs there) or `buffer` (the owners differ, or an end has none).
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

/** A line of `length` cut into dashes: `[start, end]` of each, the last one shortened. */
export function dashRuns(length: number, dash: number, gap: number): [number, number][] {
  const runs: [number, number][] = [];
  if (length <= 0 || dash <= 0) return runs;
  for (let at = 0; at < length; at += dash + gap) runs.push([at, Math.min(length, at + dash)]);
  return runs;
}

/**
 * The dashes of the lane of a road stretch as quadrilaterals in the world: the stretch starts at
 * `origin` and runs `length` along `angle` (radians); the lane is cut into dashes of `dash` with
 * `gap` between them, `width` wide.
 */
export function laneDashes(
  origin: Point,
  angle: number,
  length: number,
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
  for (const [from, to] of dashRuns(length, dash, gap)) {
    quads.push([at(from, -width / 2), at(to, -width / 2), at(to, width / 2), at(from, width / 2)]);
  }
  return quads;
}
