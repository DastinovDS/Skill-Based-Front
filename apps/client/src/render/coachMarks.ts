/**
 * The goal marks of a tutorial card on the map (`docs/design/tutorial.md`, section 8, "Compass"):
 * what the coach asks the map to mark, and the timing of their motion. Plain data and functions,
 * no PixiJS (the view is `coachMarkView.ts`). The motion stops by itself (WCAG 2.2.2): the compass
 * points turn once, the glow breathes four times, the marks in turn make one pass; under "less
 * motion" everything shows still at once.
 */

/** One terrain of the marks in turn (I.7): its places and the word of the card it lights. */
export interface CoachTurn {
  /** The label beside the first place (a terrain name of the dictionary). */
  readonly label: string;
  readonly nodes: readonly number[];
}

export interface CoachMarks {
  /** Changes whenever another card shows: the motion starts again. */
  readonly seq: number;
  /** When the card showed, `performance.now()` ms. */
  readonly since: number;
  /** Places to ring; `ring`: the wide ring of capacity and fights. */
  readonly nodes: readonly { readonly id: number; readonly ring: boolean }[];
  /** The own group standing in each of these places is ringed. */
  readonly groupsAt: readonly number[];
  /** Roads, by their two end nodes (the chevron points from the first to the second). */
  readonly roads: readonly (readonly [number, number])[];
  /** The VP badge of these cities is ringed. */
  readonly vpBadges: readonly number[];
  /** The capacity ring of these places is lit itself, segment by segment (review 4, P3). */
  readonly capacities: readonly number[];
  /** The warehouse row under these places is lit itself (P3). */
  readonly warehouses: readonly number[];
  /** The count under the group in these places (an enemy's range, "1-2") is lit itself (P3). */
  readonly counts: readonly number[];
  /** The marks in turn: each terrain's area flashes in turn, then its label stays (P4); or null. */
  readonly turns: readonly CoachTurn[] | null;
  /**
   * A focus phase (P5): no Compass; the map is dimmed but for the places, roads and warehouse rows
   * above, where the charges are made and carried.
   */
  readonly focus: boolean;
}

/** The look of a Compass mark in world units (the walkthrough's marks at the map's fit scale). */
export const COMPASS = {
  /** From the capacity ring of the place to the inner ring. */
  gap: 9,
  /** From the inner ring to the outer, dashed one. */
  step: 6,
  /** The wide ring (capacity, a fight) stands this much further out. */
  wide: 5,
  /** Around a VP badge. */
  badge: 9,
  /** The rails of a road mark stand this far either side of the road. */
  rail: 9,
  /** The compass points: half length and half width. */
  point: { length: 7.5, width: 3.6 },
  /** One turn of the points, ms. */
  spinMs: 9000,
  /** One breath of the glow, ms; it breathes this many times. */
  breatheMs: 2400,
  breaths: 4,
  /** The marks in turn: each terrain this long, ms, then all of them stay. */
  turnMs: 2000,
  /** An element mark (capacity, warehouse, count): the glow and rim stand this far out. */
  element: { pad: 4.5, glow: 7 },
  /** A focus phase: how dark the rest of the map goes, and the fade in and out, ms. */
  focus: { dim: 0.5, fadeMs: 600, pad: 10, road: 14 },
} as const;

/** The flash of a terrain area while its word is named (0..1): two soft pulses in its 2 s. */
export function turnFlash(ms: number, reduced: boolean): number {
  if (reduced) return 0;
  const t = Math.max(0, Math.min(1, ms / COMPASS.turnMs));
  // Two pulses, eased: up, down, up, down.
  return Math.sin(t * Math.PI * 2) ** 2;
}

/** The darkness of a focus phase `ms` after it began: fades in, then holds. */
export function focusDim(ms: number, reduced: boolean): number {
  if (reduced) return COMPASS.focus.dim;
  const t = Math.max(0, Math.min(1, ms / COMPASS.focus.fadeMs));
  return COMPASS.focus.dim * (0.5 - Math.cos(t * Math.PI) / 2);
}

/** The rotation of the compass points `ms` after the card showed (radians): one eased turn. */
export function compassTurn(ms: number, reduced: boolean): number {
  if (reduced || ms >= COMPASS.spinMs) return 0;
  const t = Math.max(0, ms) / COMPASS.spinMs;
  // cubic-bezier(.65,0,.35,1) of the mockup, approximated by an ease in and out.
  const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  return eased * 2 * Math.PI;
}

/** The alpha of the soft glow `ms` after the card showed: it breathes, then rests. */
export function compassGlow(ms: number, reduced: boolean): number {
  const rest = 0.6;
  if (reduced) return rest;
  const total = COMPASS.breatheMs * COMPASS.breaths;
  if (ms >= total) return rest;
  const phase = (Math.max(0, ms) % (2 * COMPASS.breatheMs)) / COMPASS.breatheMs;
  const k = phase <= 1 ? phase : 2 - phase;
  const eased = 0.5 - Math.cos(k * Math.PI) / 2;
  return 0.25 + 0.6 * eased;
}

/**
 * Which terrain of the marks in turn shows `ms` after the card showed: its index while the pass
 * runs, `'all'` once it is over (every terrain stays, each with its label). One pass, `turnMs` a
 * terrain; under "less motion" `'all'` at once.
 */
export function turnPhase(ms: number, count: number, reduced: boolean): number | 'all' {
  if (reduced || count <= 0) return 'all';
  const index = Math.floor(Math.max(0, ms) / COMPASS.turnMs);
  return index >= count ? 'all' : index;
}
