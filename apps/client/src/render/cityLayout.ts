/**
 * Geometry of a city (ui-style.md 9.4): radius by capacity, the capacity ring made of segments,
 * the overflow segments and the warehouse bar under the ring.
 *
 * Pure functions, no PixiJS and no DOM. Capacity, garrison and warehouse come from the snapshot;
 * nothing is inferred here.
 */
import {
  BAR_GAP,
  RING_ENGRAVED,
  RING_GAP,
  RING_MAX_SEGMENTS,
  RING_SEGMENT,
  VP_BADGE_LIFT,
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

/**
 * How far the helmet of a unit icon may reach from its middle in a node of body `radius` (#940): to
 * the inner edge of the capacity ring (the dark cut is `RING_ENGRAVED.cut` wide, centred on it),
 * less a hair, so the cells of the ring stay uncovered.
 */
export function fitReach(radius: number): number {
  return ringRadius(radius) - RING_ENGRAVED.cut / 2 - 1;
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

/** Where the warehouse bar sits: its top edge, from the city centre. */
export function barTop(radius: number): number {
  return ringRadius(radius) + BAR_GAP;
}

/**
 * Whether a city shows the barracks (DEC-26): only when the city development is on and the
 * snapshot says the city has one. Own cities and enemy cities next to an own node (DEC-31, the
 * server decides) carry `has_barracks`; it is `null` for the other foreign cities (AGENTS.md 4.4),
 * so the mark goes away with the neighbourhood and nothing is guessed.
 */
export function showsBarracks(hasBarracks: boolean | null, cityDevelopment: boolean): boolean {
  return cityDevelopment && hasBarracks === true;
}

/**
 * Where the VP badge sits: the gilt lozenge on the capacity ring at its upper right (the angle of
 * -45 degrees, the Engraved mockup's `vpBadge`, #847), from the city centre.
 */
export function vpBadgeAt(radius: number): { x: number; y: number } {
  const d = ringRadius(radius) + VP_BADGE_LIFT;
  return { x: d * Math.cos(-Math.PI / 4), y: d * Math.sin(-Math.PI / 4) };
}
