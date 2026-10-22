/**
 * Geometry of groups, charges, warehouses, packets, intents and fight marks (CLI-04, #60).
 *
 * Pure functions, no PixiJS and no DOM: the renderer only applies their results, and Vitest checks
 * them directly. Units are world units (docs/design/map-format.md, y grows down) unless stated.
 * Nothing here knows a game rule: numbers come from the snapshot and events.
 */
import type { MapFile } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import { tapeStripes } from './roadLayout.ts';
import { PACKET_FADE_MARGIN, PACKET_MIN_SCALE, UNIT_SIDES, UNIT_SIDE_UNKNOWN } from './style.ts';

/** A full edge in thousandths of progress, as on the wire (`OnEdgeLoc.progress`). */
export const EDGE_PROGRESS = 1000;

export function nodePoint(map: MapFile, id: number): Point | undefined {
  const node = map.nodes[id];
  return node === undefined ? undefined : { x: node.x, y: node.y };
}

/** Both ends of an edge, `a` first; `undefined` if the edge or one of its nodes is unknown. */
export function edgeEnds(map: MapFile, id: number): { a: Point; b: Point } | undefined {
  const edge = map.edges[id];
  if (edge === undefined) return undefined;
  const a = nodePoint(map, edge.a);
  const b = nodePoint(map, edge.b);
  return a === undefined || b === undefined ? undefined : { a, b };
}

/**
 * The point at `progress` thousandths of an edge, travelling away from the end `from`.
 * `fromIsA`: the travel starts at the edge's `a` end. Progress is clamped to [0, 1000].
 */
export function edgePoint(a: Point, b: Point, fromIsA: boolean, progress: number): Point {
  const t = Math.min(1, Math.max(0, progress / EDGE_PROGRESS));
  const start = fromIsA ? a : b;
  const end = fromIsA ? b : a;
  return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
}

/**
 * A point moved sideways from the road by `distance` (positive: to the right of the direction
 * `from` → `to`, with y pointing down). Travellers in opposite directions use opposite lanes, so
 * they do not sit on top of each other.
 */
export function sideways(from: Point, to: Point, at: Point, distance: number): Point {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0) return at;
  // Right-hand normal of (dx, dy) in a y-down plane is (-dy, dx).
  return {
    x: at.x + (-(to.y - from.y) / length) * distance,
    y: at.y + ((to.x - from.x) / length) * distance,
  };
}

/** Half the gap between the two lanes of a road. */
export const LANE_OFFSET = 9;

/** Where an entity on an edge is drawn: on its lane of the road (`fromIsA`: lane of the a → b way). */
export function roadPosition(
  a: Point,
  b: Point,
  fromIsA: boolean,
  progress: number,
  lane = LANE_OFFSET,
): Point {
  const at = edgePoint(a, b, fromIsA, progress);
  return fromIsA ? sideways(a, b, at, lane) : sideways(b, a, at, lane);
}

// --- Tokens (a group, or what is known about enemies in a place) -------------------------------

// --- Unit triangles (9.5) ----------------------------------------------------------------------

/** Side of the triangle of a group: steps by the number of units; `null`: the number is unknown. */
export function triangleSide(units: number | null): number {
  if (units === null) return UNIT_SIDE_UNKNOWN;
  const [s1, s2, s3, s4] = UNIT_SIDES;
  if (units <= 3) return s1;
  if (units <= 7) return s2;
  if (units <= 15) return s3;
  return s4;
}

/** Where a group token is drawn: its centre, its side and the scale of the symbol on screen. */
export interface TokenSpot extends Point {
  readonly side: number;
  /** `symbolScale` now: 1, or more when the zoom would make the triangle smaller than 20 px. */
  readonly scale: number;
}

/** Height of an equilateral triangle of `side`. */
export function triangleHeight(side: number): number {
  return (side * Math.sqrt(3)) / 2;
}

/**
 * Height share of the charge fill, from the tip: `sqrt(charged / units)`, so that the filled
 * area equals the share of charged units. 0 for an empty group.
 */
export function chargeLevel(units: number, charged: number): number {
  if (units <= 0 || charged <= 0) return 0;
  return Math.sqrt(Math.min(1, charged / units));
}

/**
 * Corners of a triangle pointing down, around the centre of its bounding box: left, right, tip.
 * `tipOrigin`: relative to the tip instead (the shape of the charge fill, scaled from there).
 */
export function triangleCorners(side: number, tipOrigin = false): [Point, Point, Point] {
  const h = triangleHeight(side);
  const top = tipOrigin ? -h : -h / 2;
  const tip = tipOrigin ? 0 : h / 2;
  return [
    { x: -side / 2, y: top },
    { x: side / 2, y: top },
    { x: 0, y: tip },
  ];
}

/** A packet near a city: scale and opacity while it glides into (or out of) the city icon. */
export function packetFade(
  distance: number,
  radius: number,
  margin = PACKET_FADE_MARGIN,
): { scale: number; alpha: number } {
  const reach = radius + margin;
  if (distance >= reach) return { scale: 1, alpha: 1 };
  const f = Math.max(0, distance) / reach;
  return { scale: PACKET_MIN_SCALE + (1 - PACKET_MIN_SCALE) * f, alpha: f };
}

/**
 * Text of the number on a token (UI round 2): ONE number, all the units. How many of them are
 * charged is the fill of the triangle; the exact numbers are in the tooltip.
 */
export function countLabel(units: number): string {
  return String(units);
}

// --- Arrows of intents -------------------------------------------------------------------------

export interface Arrow {
  start: Point;
  end: Point;
  /** Arrow head triangle: tip, then the two back corners. */
  head: readonly [Point, Point, Point];
}

/**
 * An arrow from `from` to `to`, shortened by `startInset` and `endInset` so that it leaves and
 * enters city circles instead of covering them. `null` if the points are too close for an arrow.
 */
export function arrowGeometry(
  from: Point,
  to: Point,
  startInset: number,
  endInset: number,
  headLength: number,
  headWidth: number,
): Arrow | null {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length < startInset + endInset + headLength) return null;
  const ux = (to.x - from.x) / length;
  const uy = (to.y - from.y) / length;
  const start = { x: from.x + ux * startInset, y: from.y + uy * startInset };
  const tip = { x: to.x - ux * endInset, y: to.y - uy * endInset };
  const base = { x: tip.x - ux * headLength, y: tip.y - uy * headLength };
  const half = headWidth / 2;
  return {
    start,
    end: base,
    head: [
      tip,
      { x: base.x - uy * half, y: base.y + ux * half },
      { x: base.x + uy * half, y: base.y - ux * half },
    ],
  };
}

/** A straight line cut into dashes of length `dash` with `gap` between them. */
export function dashSegments(from: Point, to: Point, dash: number, gap: number): [Point, Point][] {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0 || dash <= 0) return [];
  const ux = (to.x - from.x) / length;
  const uy = (to.y - from.y) / length;
  const segments: [Point, Point][] = [];
  for (let at = 0; at < length; at += dash + gap) {
    const end = Math.min(length, at + dash);
    segments.push([
      { x: from.x + ux * at, y: from.y + uy * at },
      { x: from.x + ux * end, y: from.y + uy * end },
    ]);
  }
  return segments;
}

// --- Road builds (DEC-16, DEC-28 item 7; R1, #345) ---------------------------------------------

export interface BuildGeometry {
  /** The band of the tape over the whole road: four corners. */
  band: Point[];
  /** The warning stripes cut to the road, each a polygon. */
  stripes: Point[][];
  /** The part that is done: four corners from the start of the road; `null` while nothing is. */
  done: Point[] | null;
  /** The middle of the road: where the plate with the level change sits. */
  mid: Point;
}

/**
 * The tape of a road being built from `from` to `to`: a band `width` wide along the whole road,
 * warning stripes `stripe` long every `period`, and the done part (`progress` of the length from
 * `from`). `null` for a road without length. World units.
 */
export function buildGeometry(
  from: Point,
  to: Point,
  width: number,
  period: number,
  stripe: number,
  progress: number,
): BuildGeometry | null {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length <= 0) return null;
  const ux = (to.x - from.x) / length;
  const uy = (to.y - from.y) / length;
  // Along the road and across it (the right-hand normal of (ux, uy) in a y-down plane is (-uy, ux)).
  const at = (x: number, y: number): Point => ({
    x: from.x + ux * x - uy * y,
    y: from.y + uy * x + ux * y,
  });
  const half = width / 2;
  const rect = (x0: number, x1: number): Point[] => [
    at(x0, -half),
    at(x1, -half),
    at(x1, half),
    at(x0, half),
  ];
  const share = Math.min(1, Math.max(0, progress));
  return {
    band: rect(0, length),
    stripes: tapeStripes(length, width, period, stripe).map((polygon) =>
      polygon.map((p) => at(p.x, p.y)),
    ),
    done: share > 0 ? rect(0, length * share) : null,
    mid: at(length / 2, 0),
  };
}

/** Time left until `ticksLeft` ticks pass, as `m:ss`, rounded up (language-neutral). */
export function timeLeftLabel(ticksLeft: number, tickHz: number): string {
  const seconds = tickHz > 0 ? Math.max(0, Math.ceil(ticksLeft / tickHz)) : 0;
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;
}

// --- Fight marks -------------------------------------------------------------------------------

/**
 * Where a fight is drawn: its city, or on an edge at `point / 2000` of the way from the end `a`
 * (`point`: twice the meeting position in thousandths, DEC-24, C3). `undefined`: unknown place.
 */
export function fightPoint(
  map: MapFile,
  node: number | null,
  edge: number | null,
  point: number | null,
): Point | undefined {
  if (node !== null) return nodePoint(map, node);
  if (edge === null) return undefined;
  const ends = edgeEnds(map, edge);
  const progress = point === null ? EDGE_PROGRESS / 2 : point / 2;
  return ends && edgePoint(ends.a, ends.b, true, progress);
}
