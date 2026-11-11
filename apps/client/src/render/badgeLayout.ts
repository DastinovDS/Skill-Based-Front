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
function badgeHeight(size: number, count: number): number {
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

/** An axis-aligned box, in the unit of the token it belongs to. */
export interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** The width of the number beside a chevron (as baked: `chevronBadgeSpec`). */
export function badgeLabelWidth(size: number, count: number): number {
  return badgeLabel(count).length * badgeFont(size) * 0.62;
}

/**
 * The box of the badges of `marks` as stacked from the origin (`stackBadges`), the outline and the
 * number included, around the origin of the layer that holds them (their first one's middle).
 */
export function badgesBox(marks: readonly BadgeMark[], size: number = BADGE.size): Box | null {
  const places = stackBadges({ x: 0, y: 0 }, marks, size);
  let box: Box | null = null;
  marks.forEach((mark, i) => {
    const at = places[i];
    if (at === undefined) return;
    const b = badgeBox(size, mark.count, badgeLabelWidth(size, mark.count));
    // The box is padded by a unit more than the outline needs: the badge may share it.
    const x0 = at.x + b.x + 1;
    const y0 = at.y + b.y + 1;
    const x1 = x0 + b.width - 2;
    const y1 = y0 + b.height - 2;
    box =
      box === null
        ? { x0, y0, x1, y1 }
        : {
            x0: Math.min(box.x0, x0),
            y0: Math.min(box.y0, y0),
            x1: Math.max(box.x1, x1),
            y1: Math.max(box.y1, y1),
          };
  });
  return box;
}

/**
 * C2 "Shoulder inside" (#956, #954): the terrain chevrons of a group standing in the middle of its
 * node sit on the helmet's upper-right shoulder, inside the capacity ring: `want` (about 0.78) of
 * their drawn size, smaller down to `SHOULDER.min` where the ring is small, and never reaching the
 * ring's cells. Pure geometry in the unit of the token: it does not depend on the zoom (the helmet
 * and the badge scale together), only on the size of the node.
 */
export const SHOULDER = {
  /** The share of the drawn size at the normal zoom (the mockup's 0.78). */
  scale: 0.78,
  /** The least share a crowded small node gets. */
  min: 0.5,
  /** The most a far zoom asks for: the minimum size on screen is then `BADGE.shoulderPx`. */
  max: 1,
  /** The way down from the share wanted to the least. */
  step: 0.04,
  /** The preferred direction of the badge from the middle of the helmet (rad, up and right). */
  angle: -0.27 * Math.PI,
  /** The directions tried, nearest to `angle` first. */
  arc: { from: -0.46 * Math.PI, to: -0.06 * Math.PI, step: 0.02 * Math.PI },
  /** The turn (rad) that costs as much as a tenth of the scale. */
  swing: 0.15 * Math.PI,
  /** The clear space kept from the number and the ticks. */
  clear: 0.6,
} as const;

/** The share of the drawn size the badge wants at `pxPerUnit` screen px per unit of the token. */
export function shoulderWant(pxPerUnit: number): number {
  if (pxPerUnit <= 0) return SHOULDER.scale;
  const want = BADGE.shoulderPx / (BADGE.size * pxPerUnit);
  return Math.round(Math.min(SHOULDER.max, Math.max(SHOULDER.scale, want)) * 50) / 50;
}

function overlaps(a: Box, b: Box, clear: number): boolean {
  return a.x0 < b.x1 + clear && a.x1 > b.x0 - clear && a.y0 < b.y1 + clear && a.y1 > b.y0 - clear;
}

/** The farthest corner of `box` (scaled by `scale`, its origin at `at`) from the helmet's middle. */
function farthest(box: Box, scale: number, at: Point): number {
  let far = 0;
  for (const x of [box.x0, box.x1]) {
    for (const y of [box.y0, box.y1]) {
      far = Math.max(far, Math.hypot(at.x + x * scale, at.y + y * scale));
    }
  }
  return far;
}

/** What a badge on the shoulder keeps clear of: the number of units first, the selection's tick after. */
export interface KeepClear {
  readonly number: Box | null;
  readonly ticks: readonly Box[];
}

/**
 * Where the badge box `box` goes on the shoulder: the layer's origin and its scale. The box stays
 * inside the circle of radius `bound` round the middle of the helmet (the inner edge of the capacity
 * ring) and clear of the number of units and the corner tick of the selection (`keep`). Of the free
 * places (a scale from `want` down to `SHOULDER.min`, a direction of `SHOULDER.arc`, as far out as
 * the ring, the number and the tick allow) the cheapest wins: a tenth of the scale costs as much as
 * `SHOULDER.swing` of the arc, so the badge gives up some size before it climbs onto the crown, and
 * some turn before it shrinks too far. When the least badge finds no place, what yields is first the
 * tick (it only hides under the badge), then the ring by a few units (a count with a number on the
 * smallest node): the number of units is never covered.
 */
export function shoulderBadge(
  box: Box,
  bound: number,
  keep: KeepClear,
  want: number,
): { at: Point; scale: number } {
  const top = Math.min(SHOULDER.max, Math.max(want, SHOULDER.scale));
  const scales: number[] = [];
  for (let k = 0; top - k * SHOULDER.step > SHOULDER.min; k++) scales.push(top - k * SHOULDER.step);
  scales.push(SHOULDER.min);
  const boxAt = (scale: number, at: Point): Box => ({
    x0: at.x + box.x0 * scale,
    y0: at.y + box.y0 * scale,
    x1: at.x + box.x1 * scale,
    y1: at.y + box.y1 * scale,
  });
  const search = (limit: number, avoid: readonly Box[]): { at: Point; scale: number } | null => {
    /** The farthest out along `angle` that still fits the circle: against the ring. */
    const outermost = (scale: number, angle: number): number => {
      let d = limit;
      while (
        d > 0 &&
        farthest(box, scale, { x: Math.cos(angle) * d, y: Math.sin(angle) * d }) > limit
      ) {
        d -= 0.25;
      }
      return Math.max(d, 0);
    };
    let best: { at: Point; scale: number; cost: number } | null = null;
    for (const scale of scales) {
      for (let a = SHOULDER.arc.from; a <= SHOULDER.arc.to + 1e-9; a += SHOULDER.arc.step) {
        const cost = (top - scale) * 10 + Math.abs(a - SHOULDER.angle) / SHOULDER.swing;
        if (best !== null && cost >= best.cost) continue;
        for (let d = outermost(scale, a); d > 0; d -= 0.5) {
          const at = { x: Math.cos(a) * d, y: Math.sin(a) * d };
          const mine = boxAt(scale, at);
          if (avoid.every((other) => !overlaps(mine, other, SHOULDER.clear))) {
            best = { at, scale: Math.round(scale * 100) / 100, cost };
            break;
          }
        }
      }
    }
    return best === null ? null : { at: best.at, scale: best.scale };
  };
  const number = keep.number === null ? [] : [keep.number];
  const found =
    search(bound, [...number, ...keep.ticks]) ??
    search(bound, number) ??
    search(bound + 1.5, number) ??
    search(bound + 3.5, number);
  if (found !== null) return found;
  const d = bound;
  return {
    at: { x: Math.cos(SHOULDER.angle) * d * 0.7, y: Math.sin(SHOULDER.angle) * d * 0.7 },
    scale: SHOULDER.min,
  };
}
