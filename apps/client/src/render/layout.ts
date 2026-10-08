/**
 * Geometry of groups, charges, warehouses, packets, intents and fight marks (CLI-04, #60).
 *
 * Pure functions, no PixiJS and no DOM: the renderer only applies their results, and Vitest checks
 * them directly. Units are world units (docs/design/map-format.md, y grows down) unless stated.
 * Nothing here knows a game rule: numbers come from the snapshot and events.
 */
import type { EventMsg, MapFile } from '../protocol.gen.ts';
import type { Point } from './camera.ts';

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
export const LANE_OFFSET = 13;

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

export const TOKEN_FULL = { width: 54, height: 32 } as const;
export const TOKEN_COMPACT = { width: 44, height: 22 } as const;
export const MAX_PIPS = 10;
export const PIPS_PER_ROW = 5;
export const PIP_SPACING = 7;
/** Vertical centre of the row with the mode glyph and the numbers, inside a full token. */
export const TOKEN_TOP_ROW_Y = -9;

export interface Pip {
  x: number;
  y: number;
  filled: boolean;
}

export interface PipLayout {
  pips: Pip[];
  /** More units than `MAX_PIPS`: the pips show the share of charged units, not the count. */
  scaled: boolean;
}

/**
 * Charge pips of a group, relative to the centre of a full token: one dot per unit, filled if the
 * unit is charged, hollow if not (a charge is never told by colour alone). Up to `PIPS_PER_ROW`
 * dots in a row, at most two rows. A group of more than `MAX_PIPS` units draws `MAX_PIPS` dots
 * with the same share of filled ones (at least one if anything is charged); the numbers next to
 * the pips stay exact.
 */
export function pipLayout(units: number, charged: number): PipLayout {
  const total = Math.max(0, Math.floor(units));
  const full = Math.min(total, Math.max(0, Math.floor(charged)));
  const scaled = total > MAX_PIPS;
  const shown = scaled ? MAX_PIPS : total;
  const filled = scaled
    ? full === 0
      ? 0
      : Math.max(1, Math.round((full * MAX_PIPS) / total))
    : full;
  const rows = shown > PIPS_PER_ROW ? 2 : 1;
  const pips: Pip[] = [];
  for (let i = 0; i < shown; i++) {
    const row = Math.floor(i / PIPS_PER_ROW);
    const inRow = row === 0 ? Math.min(shown, PIPS_PER_ROW) : shown - PIPS_PER_ROW;
    const col = i - row * PIPS_PER_ROW;
    pips.push({
      x: (col - (inRow - 1) / 2) * PIP_SPACING,
      y: rows === 1 ? 7 : 3 + row * 8,
      filled: i < filled,
    });
  }
  return { pips, scaled };
}

/** Text of the numbers on a token: charged units over all units. */
export function countLabel(units: number, charged: number): string {
  return `${String(charged)}/${String(units)}`;
}

/**
 * Centres of tokens standing under a city, relative to the city centre: two columns, rows going
 * down. `radius` is the city radius, `height` the token height.
 */
export function nodeSlots(
  count: number,
  radius: number,
  size: { width: number; height: number } = TOKEN_FULL,
): Point[] {
  const gap = 4;
  const slots: Point[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / 2);
    // A lone token in its row is centred, a pair sits in two columns.
    const inRow = Math.min(2, count - row * 2);
    const col = i - row * 2;
    slots.push({
      x: (col - (inRow - 1) / 2) * (size.width + gap),
      y: radius + 10 + size.height / 2 + row * (size.height + gap),
    });
  }
  return slots;
}

// --- Warehouse ---------------------------------------------------------------------------------

export const BAR = { width: 32, height: 6 } as const;
/** Most capacity units that still get their own segment mark on the bar. */
export const MAX_BAR_SEGMENTS = 10;

export interface WarehouseBar {
  /** Filled share of the bar, 0..1. */
  ratio: number;
  /** x (from the left end of the bar) of the marks between capacity units. */
  marks: number[];
}

/** The warehouse fill bar: charges against the capacity of the city. */
export function warehouseBar(warehouse: number, capacity: number): WarehouseBar {
  const cap = Math.max(0, Math.floor(capacity));
  const ratio = cap === 0 ? 0 : Math.min(1, Math.max(0, warehouse / cap));
  const marks: number[] = [];
  if (cap > 1 && cap <= MAX_BAR_SEGMENTS) {
    for (let i = 1; i < cap; i++) marks.push((BAR.width * i) / cap);
  }
  return { ratio, marks };
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

// --- Road builds of cities (DEC-16) -----------------------------------------------------------

export interface BuildGeometry {
  /** Short bars across the road, from rim to rim. */
  ties: [Point, Point][];
  /** Where the hammer disc sits: on the road, `markDistance` past the rim of the building city. */
  mark: Point;
}

/**
 * Marks of a road being built from the city at `from` towards `to`: bars across the road every
 * `spacing` units between the city rims (`fromRadius`, `toRadius`), `halfWidth` to each side, and
 * the point of the hammer disc (never past the middle of the road). `null` if the cities overlap.
 */
export function buildGeometry(
  from: Point,
  to: Point,
  fromRadius: number,
  toRadius: number,
  halfWidth: number,
  spacing: number,
  markDistance: number,
): BuildGeometry | null {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length <= fromRadius + toRadius || spacing <= 0) return null;
  const ux = (to.x - from.x) / length;
  const uy = (to.y - from.y) / length;
  const at = (d: number): Point => ({ x: from.x + ux * d, y: from.y + uy * d });
  const ties: [Point, Point][] = [];
  const end = length - toRadius;
  for (let d = fromRadius + spacing / 2; d < end; d += spacing) {
    const c = at(d);
    // Right-hand normal of (ux, uy) in a y-down plane is (-uy, ux).
    ties.push([
      { x: c.x - uy * halfWidth, y: c.y + ux * halfWidth },
      { x: c.x + uy * halfWidth, y: c.y - ux * halfWidth },
    ]);
  }
  return { ties, mark: at(Math.min(fromRadius + markDistance, length / 2)) };
}

/** Time left until `ticksLeft` ticks pass, as `m:ss`, rounded up (language-neutral). */
export function timeLeftLabel(ticksLeft: number, tickHz: number): string {
  const seconds = tickHz > 0 ? Math.max(0, Math.ceil(ticksLeft / tickHz)) : 0;
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;
}

// --- Fight marks -------------------------------------------------------------------------------

/** How long a fight mark stays on the map, ticks. */
export const FIGHT_MARK_TICKS = 50;

export interface FightInfo {
  event: EventMsg;
  /** Units lost by player 0 and player 1. */
  losses: readonly [number, number];
  /** Where the fight was: a city, or the middle of an edge. */
  at: Point;
}

function intField(data: EventMsg['data'], key: string): number | null {
  const value = data[key];
  return typeof value === 'number' ? value : null;
}

/**
 * A `fight` event as a mark on the map, or `null` if it is not one or names an unknown place.
 * A fight on an edge has no exact point in the event: its mark sits in the middle of the road.
 * The events come from `gow_sim.systems.combat` (`fight`: `node` or `edge`, `losses_0`, `losses_1`).
 */
export function fightInfo(event: EventMsg, map: MapFile): FightInfo | null {
  if (event.kind !== 'fight') return null;
  const losses0 = intField(event.data, 'losses_0');
  const losses1 = intField(event.data, 'losses_1');
  if (losses0 === null || losses1 === null) return null;
  const node = intField(event.data, 'node');
  const edge = intField(event.data, 'edge');
  let at: Point | undefined;
  if (node !== null) {
    at = nodePoint(map, node);
  } else if (edge !== null) {
    const ends = edgeEnds(map, edge);
    at = ends && edgePoint(ends.a, ends.b, true, EDGE_PROGRESS / 2);
  }
  return at === undefined ? null : { event, losses: [losses0, losses1], at };
}

/**
 * Opacity of a fight mark at render tick `tick`: `null` before the event and after the mark
 * expired, 1 for most of its life, then fading out.
 */
export function fightMarkAlpha(eventTick: number, tick: number): number | null {
  const age = tick - eventTick;
  if (age < 0 || age >= FIGHT_MARK_TICKS) return null;
  const fadeFrom = FIGHT_MARK_TICKS * 0.7;
  return age <= fadeFrom ? 1 : 1 - (age - fadeFrom) / (FIGHT_MARK_TICKS - fadeFrom);
}
