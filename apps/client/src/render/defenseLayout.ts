/**
 * Geometry of the "Defense" counter and of the left column of a city (#349, L1 "Left column",
 * D1 "Diamond pips"; ui-style.md 35). Pure functions, no PixiJS: the numbers come from the snapshot,
 * nothing is inferred here (AGENTS.md 7.1).
 */
import { ringRadius } from './cityLayout.ts';
import { CITY_COLUMN, DEFENSE_PIPS, RING_SEGMENT } from './style.ts';

/** The gathered "Defense" bonus and the cap it can grow to (DEC-30): the server's numbers. */
export interface DefensePips {
  readonly bonus: number;
  readonly cap: number;
}

/** A diamond of the counter: the centre from the near end of the capsule, filled when gathered. */
export interface Pip {
  readonly x: number;
  readonly radius: number;
  readonly filled: boolean;
}

/** A number of the form above `DEFENSE_PIPS.maxPips` places: the left edge of its text, the text. */
export interface PipNumber {
  readonly x: number;
  readonly text: string;
}

/** The capsule beside the badge: its width, its diamonds and, above 6 places, the two numbers. */
export interface CounterLayout {
  readonly width: number;
  readonly pips: readonly Pip[];
  readonly numbers: readonly PipNumber[];
}

/**
 * The capsule of an own group's counter: one diamond per cap place (filled = gathered, hollow =
 * room), so a cap that grows adds a hollow diamond and nothing looks lost. Above `maxPips` places:
 * "filled x gathered, hollow x room". `null`: no charged units, so no places (the badge alone).
 */
export function counterLayout(pips: DefensePips): CounterLayout | null {
  const cap = Math.max(0, Math.floor(pips.cap));
  if (cap === 0) return null;
  const bonus = Math.min(cap, Math.max(0, Math.floor(pips.bonus)));
  const { maxPips, radius, smallRadius, pitch, inset, padding, charWidth } = DEFENSE_PIPS;
  if (cap <= maxPips) {
    const diamonds: Pip[] = [];
    for (let i = 0; i < cap; i++) {
      diamonds.push({ x: inset + i * pitch, radius, filled: i < bonus });
    }
    return { width: cap * pitch + padding, pips: diamonds, numbers: [] };
  }
  const gathered = `×${String(bonus)}`;
  const room = `×${String(cap - bonus)}`;
  const firstText = 12 - 1;
  const secondDiamond = 12 + gathered.length * charWidth + 6;
  return {
    width: 12 + gathered.length * charWidth + 12 + room.length * charWidth + 4,
    pips: [
      { x: 6, radius: smallRadius, filled: true },
      { x: secondDiamond, radius: smallRadius, filled: false },
    ],
    numbers: [
      { x: firstText, text: gathered },
      { x: secondDiamond + 5, text: room },
    ],
  };
}

/** What a column of a city holds, top to bottom: the barracks, then the signs of "Defense". */
export type ColumnKind = 'barracks' | 'factory' | 'fort' | 'defense';

/** One entry of the column: where its middle (the badge of a sign) is, in city units, and its scale. */
export interface ColumnSlot {
  readonly kind: ColumnKind;
  readonly x: number;
  readonly y: number;
}

/**
 * The scale of the marks of a city: they are never smaller than `CITY_COLUMN.iconPx` on screen, so
 * below zoom 1 they grow by `1 / cameraScale` (a 16 unit icon at scale `s` is `16 s` px wide).
 */
export function markScale(cameraScale: number): number {
  return cameraScale > 0 ? Math.max(1, 1 / cameraScale) : 1;
}

/** The left edge of the column: just outside the capacity ring of a city of `radius` (negative x). */
export function columnEdge(radius: number): number {
  return -(ringRadius(radius) + RING_SEGMENT.base / 2 + CITY_COLUMN.clear);
}

/**
 * The slots of the column of a city, in the order of `kinds`: centred on the city's height, `step`
 * apart. The middle of a barracks is `8 k` from the edge, the badge of a sign `9 k` (the counter
 * grows from the badge outward, to the left).
 */
export function columnSlots(
  radius: number,
  kinds: readonly ColumnKind[],
  scale: number,
): ColumnSlot[] {
  const edge = columnEdge(radius);
  const step = CITY_COLUMN.step * scale;
  return kinds.map((kind, i) => {
    const reach = (kind === 'defense' ? CITY_COLUMN.badgeRadius : 8) * scale;
    return { kind, x: edge - reach, y: (i - (kinds.length - 1) / 2) * step };
  });
}

/** The kinds of the column: the barracks (if the city shows it), then one entry per sign. */
export function columnKinds(
  barracks: boolean,
  signs: number,
  /** Economy v2 (DEC-41): the factory and bunker marks, under the barracks. */
  marks: readonly ('factory' | 'fort')[] = [],
): ColumnKind[] {
  const kinds: ColumnKind[] = barracks ? ['barracks'] : [];
  kinds.push(...marks);
  for (let i = 0; i < signs; i++) kinds.push('defense');
  return kinds;
}

/**
 * The middle of the column of a city's marks at scale 1, where the barracks mark sits when it is
 * alone: what the tail of an order keeps clear of (`tailStart`). A sign under the barracks mark
 * shifts the pair by half a step, which the clearance of the tail covers.
 */
export function barracksAt(radius: number): { x: number; y: number } {
  const [slot] = columnSlots(radius, ['barracks'], 1);
  return { x: slot?.x ?? 0, y: slot?.y ?? 0 };
}
