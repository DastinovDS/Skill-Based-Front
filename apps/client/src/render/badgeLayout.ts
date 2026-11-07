/**
 * The geometry of the advantage and disadvantage badges (#791, variant 8 "Chevrons" of #776,
 * ui-style 32): a count told by strokes, chevrons up (green) for an advantage, down (red) for a
 * disadvantage. Pure functions, no PixiJS: what a badge says comes from the server (the terrain mark
 * of a node, `NodeView.terrain_mark`) or from the fight view (`FightView.virtual_left`, `mute`);
 * nothing here decides it (AGENTS.md 7.1).
 */
import type { Point } from './camera.ts';
import { BADGE } from './style.ts';

/** Up: an advantage (bonus shots); down: a disadvantage (a charge silenced or burned). */
export type BadgeDir = 'up' | 'down';

/** One badge: its direction and how many it counts (at least 1). */
export interface BadgeMark {
  readonly dir: BadgeDir;
  readonly count: number;
}

/** The count a badge shows: 1 to `BADGE.maxCount`, and one more for every bigger count ("9+"). */
export function badgeCount(count: number): number {
  return Math.min(Math.max(1, Math.floor(count)), BADGE.maxCount + 1);
}

/** The number written beside one chevron: none up to `BADGE.maxStrokes`, then "4".."9", then "9+". */
export function badgeLabel(count: number): string {
  const n = badgeCount(count);
  if (n <= BADGE.maxStrokes) return '';
  return n > BADGE.maxCount ? `${String(BADGE.maxCount)}+` : String(n);
}

/** The chevrons drawn: as many as the count up to `BADGE.maxStrokes`, one when a number tells it. */
export function chevronCount(count: number): number {
  const n = badgeCount(count);
  return n <= BADGE.maxStrokes ? n : 1;
}

/**
 * The chevrons of a badge of `size` around (0, 0), each a polyline of three points: the tip up for
 * `up` (^), down for `down` (v); several are stacked `0.46 * size` apart.
 */
export function chevronStrokes(dir: BadgeDir, size: number, count: number): Point[][] {
  const n = chevronCount(count);
  const y = dir === 'up' ? 1 : -1;
  const strokes: Point[][] = [];
  for (let i = 0; i < n; i++) {
    const oy = (i - (n - 1) / 2) * size * 0.46;
    strokes.push([
      { x: -size * 0.56, y: y * size * 0.26 + oy },
      { x: 0, y: -y * size * 0.26 + oy },
      { x: size * 0.56, y: y * size * 0.26 + oy },
    ]);
  }
  return strokes;
}

/** Font size of the number beside a chevron. */
export function badgeFont(size: number): number {
  return Math.max(BADGE.minFont, size * BADGE.font);
}

/**
 * The box of a badge around its origin (the middle of the chevrons), the dark outline included;
 * a number widens it to the right. `labelWidth`: the width of the number, measured by the caller
 * (0 without one).
 */
export function badgeBox(
  size: number,
  count: number,
  labelWidth = 0,
): { x: number; y: number; width: number; height: number } {
  const n = chevronCount(count);
  const pad = (size * BADGE.stroke + BADGE.outline) / 2 + 1;
  const halfW = size * 0.56 + pad;
  const halfH = size * 0.26 + ((n - 1) / 2) * size * 0.46 + pad;
  const label = badgeLabel(count) === '' ? 0 : size * 0.1 + labelWidth + 3;
  return { x: -halfW, y: -halfH, width: 2 * halfW + label, height: 2 * halfH };
}

/** The height of a badge without its outline: the step between two stacked badges. */
export function badgeHeight(size: number, count: number): number {
  const n = chevronCount(count);
  return size * (0.72 + 0.46 * (n - 1));
}

/**
 * Where the badges of one corner go: the first on `corner`, the next ones under it (an up badge
 * above a down one), `size` apart plus their heights. Returns the middle of each, in order.
 */
export function stackBadges(corner: Point, marks: readonly BadgeMark[], size: number): Point[] {
  const at: Point[] = [];
  let y = corner.y;
  marks.forEach((mark, i) => {
    if (i > 0) {
      const before = marks[i - 1];
      const h0 = before === undefined ? 0 : badgeHeight(size, before.count);
      y += (h0 + badgeHeight(size, mark.count)) / 2 + 1;
    }
    at.push({ x: corner.x, y });
  });
  return at;
}

/**
 * The badges of a node's defender on the map from the server's terrain mark (`NodeView.
 * terrain_mark`): positive, chevrons up (mountains); negative, chevrons down (plains); `null` or 0,
 * none.
 */
export function terrainBadges(mark: number | null | undefined): BadgeMark[] {
  if (mark === null || mark === undefined || mark === 0) return [];
  return [{ dir: mark > 0 ? 'up' : 'down', count: Math.abs(mark) }];
}

/** The scale on top of a token's own that keeps a badge at least `BADGE.minPx` on screen. */
export function badgeFloor(pxPerUnit: number, size: number = BADGE.size): number {
  if (pxPerUnit <= 0) return 1;
  return Math.max(1, BADGE.minPx / (size * pxPerUnit));
}
