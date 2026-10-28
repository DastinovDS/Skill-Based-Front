/**
 * Geometry of a city (ui-style.md 9.4): radius by capacity, the capacity ring made of segments,
 * the overflow segments and the warehouse bar under the ring.
 *
 * Pure functions, no PixiJS and no DOM. Capacity, garrison and warehouse come from the snapshot;
 * nothing is inferred here.
 */
import {
  BAR_GAP,
  BAR_SEGMENT,
  BARRACKS_MARK,
  QUEUE_SLOT,
  RING_GAP,
  RING_MAX_SEGMENTS,
  RING_SEGMENT,
} from './style.ts';

/**
 * City radius by capacity class: up to 2, 3-4, 5-6, 7 and more. A province is a small ring of its
 * own radius, whatever its capacity (DEC-23, C1): `PROVINCE.radius`.
 */
export function cityRadius(capacity: number): number {
  if (capacity <= 2) return 11;
  if (capacity <= 4) return 14;
  if (capacity <= 6) return 17;
  return 20;
}

/** Radius of the capacity ring. */
export function ringRadius(radius: number): number {
  return radius + RING_GAP;
}

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

/**
 * What a warehouse place shows (ui-style 9.4, C1): `filled` holds a charge, `frame` is room for one,
 * `dashed` is a place of a level that is not built yet (the shape tells it, not the colour).
 */
export type PlaceState = 'filled' | 'frame' | 'dashed';

export interface BarSegment {
  /** Left edge from the middle of the bar. */
  readonly x: number;
  readonly state: PlaceState;
  /** Holds a charge (`state === 'filled'`). */
  readonly filled: boolean;
}

export interface WarehouseBar {
  readonly width: number;
  readonly segments: BarSegment[];
}

/**
 * Warehouse bar: a place per unit of warehouse capacity, `warehouse` of them filled (the rest a
 * frame), then `locked` dashed places for the levels not built yet (always the last ones).
 */
export function warehouseSegments(warehouse: number, capacity: number, locked = 0): WarehouseBar {
  const cap = Math.max(0, Math.floor(capacity));
  const filled = Math.min(cap, Math.max(0, Math.floor(warehouse)));
  const total = cap + Math.max(0, Math.floor(locked));
  const { pitch, pad } = BAR_SEGMENT;
  const width = total * pitch + 2 * pad - (pitch - BAR_SEGMENT.width);
  const segments: BarSegment[] = [];
  for (let i = 0; i < total; i++) {
    const state: PlaceState = i < filled ? 'filled' : i < cap ? 'frame' : 'dashed';
    segments.push({ x: -width / 2 + pad + i * pitch, state, filled: state === 'filled' });
  }
  return { width, segments };
}

/** What `ruleset_public.city_upgrades` says of the warehouse levels (DEC-26). */
export interface WarehouseLevels {
  readonly warehouseMaxLevel: number;
  readonly warehouseGainPerLevel: number;
}

/**
 * Dashed places of an own city: the levels above its `level` up to the top one, `gain` places each
 * (`warehouse_level` of the view, the two numbers of the ruleset). 0 for a city whose level the view
 * does not give (a foreign one) and without city development.
 */
export function lockedPlaces(level: number | null, levels: WarehouseLevels | null): number {
  if (level === null || levels === null) return 0;
  return Math.max(0, levels.warehouseMaxLevel - Math.max(0, level)) * levels.warehouseGainPerLevel;
}

/** Where the warehouse bar sits: its top edge, from the city centre. */
export function barTop(radius: number): number {
  return ringRadius(radius) + BAR_GAP;
}

export interface QueueSlot {
  /** Left edge from the middle of the mark. */
  readonly x: number;
  /** Filled share of the slot, 0..1: the progress of the unit in production, 0 for the rest. */
  readonly fill: number;
}

export interface QueueMark {
  readonly width: number;
  readonly slots: QueueSlot[];
}

/**
 * The recruit queue of an own city (DEC-25): a slot per queued unit, the first filled by
 * `progress / unitTicks` (both from the server). A full first slot is a ready unit waiting for a
 * place: a unit in production never shows a full slot, it appears at full progress.
 */
export function queueSlots(queue: number, progress: number, unitTicks: number): QueueMark {
  const count = Math.max(0, Math.floor(queue));
  const { pitch, pad } = QUEUE_SLOT;
  const width = count === 0 ? 0 : count * pitch + 2 * pad - (pitch - QUEUE_SLOT.width);
  const first = unitTicks > 0 ? Math.min(1, Math.max(0, progress / unitTicks)) : 0;
  const slots: QueueSlot[] = [];
  for (let i = 0; i < count; i++) {
    slots.push({ x: -width / 2 + pad + i * pitch, fill: i === 0 ? first : 0 });
  }
  return { width, slots };
}

/** Where the queue mark sits: its top edge, from the city centre (above the ring). */
export function queueTop(radius: number): number {
  return -(ringRadius(radius) + BAR_GAP) - QUEUE_SLOT.height - 2;
}

/**
 * Whether a city shows the barracks mark (DEC-26): only when the city development is on and the
 * snapshot says the city has one. Own cities and enemy cities next to an own node (DEC-31, the
 * server decides) carry `has_barracks`; it is `null` for the other foreign cities (AGENTS.md 4.4),
 * so the mark goes away with the neighbourhood and nothing is guessed.
 */
export function showsBarracks(hasBarracks: boolean | null, cityDevelopment: boolean): boolean {
  return cityDevelopment && hasBarracks === true;
}

/** Corners of the little house glyph of the barracks, relative to the middle of its mark. */
export const BARRACKS_HOUSE: readonly (readonly [number, number])[] = [
  [0, -4.5],
  [4.5, -0.5],
  [3.5, -0.5],
  [3.5, 4],
  [-3.5, 4],
  [-3.5, -0.5],
  [-4.5, -0.5],
];

/**
 * Where the barracks mark sits: outside the capacity ring on the left of the city, clear of the VP
 * badge (upper right), the supply sign (upper left), the queue (above) and the warehouse bar
 * (below), from the city centre.
 */
export function barracksAt(radius: number): { x: number; y: number } {
  return { x: -(ringRadius(radius) + BARRACKS_MARK.radius + 1), y: 0 };
}
