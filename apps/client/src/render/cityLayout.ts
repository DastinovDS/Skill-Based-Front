/**
 * Geometry of a city (ui-style.md 9.4): radius by capacity, the capacity ring made of segments,
 * the overflow segments and the warehouse bar under the ring.
 *
 * Pure functions, no PixiJS and no DOM. Capacity, garrison and warehouse come from the snapshot;
 * nothing is inferred here.
 */
import {
  BAR_SEGMENT,
  OVERFLOW_RING_GAP,
  RING_GAP,
  RING_MAX_SEGMENTS,
  RING_SEGMENT,
} from './style.ts';

/** City radius by capacity class: up to 2, 3-4, 5-6, 7 and more. */
export function cityRadius(capacity: number): number {
  if (capacity <= 2) return 13;
  if (capacity <= 4) return 17;
  if (capacity <= 6) return 21;
  return 25;
}

/** Radius of the capacity ring. */
export function ringRadius(radius: number): number {
  return radius + RING_GAP;
}

/** How far from the city centre the rings and the bar reach (tokens under a city start there). */
export const CITY_REACH_BELOW = RING_GAP + 4 + 9 + BAR_SEGMENT.height + 4;

/**
 * The radius tokens of groups standing in a city are laid out from: below the largest city's rings
 * and bar, whatever the capacity class, so the slots do not move when a capacity changes (and the
 * end-to-end tests can click them without knowing the capacity).
 */
export const NODE_SLOT_RADIUS = cityRadius(99) + CITY_REACH_BELOW;

const START = -Math.PI / 2;
const FULL = 2 * Math.PI;

export interface Arc {
  readonly from: number;
  readonly to: number;
  /** Filled with a unit of the garrison. */
  readonly filled: boolean;
}

export interface Ring {
  /** `true`: one solid arc with notches (capacity above `RING_MAX_SEGMENTS`). */
  readonly solid: boolean;
  readonly arcs: Arc[];
  /** Angles of the notches (a tick at every fifth unit) of a solid ring. */
  readonly notches: number[];
}

/**
 * The capacity ring: as many segments as the capacity, the first `garrison` of them filled. Above
 * `RING_MAX_SEGMENTS` units the ring is one solid arc (the filled part and the rest) with a notch
 * at every fifth unit.
 */
export function capacityRing(capacity: number, garrison: number): Ring {
  const cap = Math.max(0, Math.floor(capacity));
  const filled = Math.min(cap, Math.max(0, Math.floor(garrison)));
  if (cap === 0) return { solid: false, arcs: [], notches: [] };
  if (cap > RING_MAX_SEGMENTS) {
    const split = START + (FULL * filled) / cap;
    const arcs: Arc[] = [];
    if (filled > 0) arcs.push({ from: START, to: split, filled: true });
    if (filled < cap) arcs.push({ from: split, to: START + FULL, filled: false });
    const notches: number[] = [];
    for (let i = 5; i < cap; i += 5) notches.push(START + (FULL * i) / cap);
    return { solid: true, arcs, notches };
  }
  const arcs: Arc[] = [];
  for (let i = 0; i < cap; i++) {
    arcs.push({
      from: START + (FULL * i) / cap + RING_SEGMENT.gap / 2,
      to: START + (FULL * (i + 1)) / cap - RING_SEGMENT.gap / 2,
      filled: i < filled,
    });
  }
  return { solid: false, arcs, notches: [] };
}

/** Most overflow segments drawn on the second ring (more would not fit). */
export const MAX_OVERFLOW_SEGMENTS = 8;

/** Arcs of the units above the capacity, on the ring `OVERFLOW_RING_GAP` outside the first one. */
export function overflowArcs(over: number): Arc[] {
  const count = Math.min(MAX_OVERFLOW_SEGMENTS, Math.max(0, Math.floor(over)));
  const arcs: Arc[] = [];
  for (let i = 0; i < count; i++) {
    arcs.push({ from: START + i * 0.55 + 0.06, to: START + i * 0.55 + 0.51, filled: true });
  }
  return arcs;
}

/** Radius of the second (overflow) ring. */
export function overflowRadius(radius: number): number {
  return ringRadius(radius) + OVERFLOW_RING_GAP;
}

export interface BarSegment {
  /** Left edge from the middle of the bar. */
  readonly x: number;
  readonly filled: boolean;
}

export interface WarehouseBar {
  readonly width: number;
  readonly segments: BarSegment[];
}

/** Warehouse bar: a segment per unit of capacity, `warehouse` of them filled. */
export function warehouseSegments(warehouse: number, capacity: number): WarehouseBar {
  const cap = Math.max(0, Math.floor(capacity));
  const filled = Math.min(cap, Math.max(0, Math.floor(warehouse)));
  const { pitch, pad } = BAR_SEGMENT;
  const width = cap * pitch + 2 * pad - (pitch - BAR_SEGMENT.width);
  const segments: BarSegment[] = [];
  for (let i = 0; i < cap; i++) {
    segments.push({ x: -width / 2 + pad + i * pitch, filled: i < filled });
  }
  return { width, segments };
}

/** Where the warehouse bar sits: its top edge, from the city centre. */
export function barTop(radius: number): number {
  return ringRadius(radius) + 9;
}
