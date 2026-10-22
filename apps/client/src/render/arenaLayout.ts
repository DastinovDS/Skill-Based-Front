/**
 * Where the arenas of fights stand so that they do not cover each other, a city or the edge of
 * the screen (#360). Pure functions, no PixiJS and no DOM.
 *
 * The arena (A1) floats over its place at a gap that is fixed in screen px (`arenaCenter`). When
 * several fights are close, or a city is near the top of the screen, that spot is taken: the plate
 * then moves to the free spot nearest to it, over the place or under it, aside by a plate's width
 * or further up. Nothing here decides what happens in a fight, it only picks a place on the screen
 * for what the view already shows.
 *
 * The work is done in "scaled world" px: world units times the camera scale. It differs from the
 * screen px only by a shift, which overlaps do not depend on; the view rectangle (the canvas) is
 * given in the same px.
 */
import type { Point } from './camera.ts';
import { ARENA_GAP_EDGE, ARENA_GAP_NODE, PLATE } from './fightFx.ts';

/** A rectangle in px: `left < right`, `top < bottom`. */
export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** One arena to place. */
export interface ArenaSlot {
  /** The true place (a city, or the meeting point on a road) in world units. */
  readonly at: Point;
  /** Radius of the capacity ring of the city in world units; 0 on a road. */
  readonly ring: number;
  /** The fight is on a road: its plate floats over the meeting point and has a tether. */
  readonly road: boolean;
  /** What is drawn beyond the plate, px: the arrows and their labels, the caption, the end label. */
  readonly top: number;
  readonly bottom: number;
}

/** A city the arenas must not cover (its ring in world units). */
export interface Obstacle {
  readonly at: Point;
  readonly ring: number;
}

/** Where an arena stands: the middle of its plate in world units, and how far from its usual spot. */
export interface ArenaSpot {
  readonly x: number;
  readonly y: number;
  /** Distance from the usual spot over the place, px; 0: it stands where it always did. */
  readonly moved: number;
}

const NO_REACH = { top: 0, bottom: 0 } as const;
/** Air kept between two plates (px). */
const MARGIN = 4;
/** What a city takes beyond its ring (px): its group, the counter of capacity, the badges. */
const CITY_REACH = { side: 14, top: 16, bottom: 24 } as const;
/** Prices of a px²: the arrows of two arenas meeting, covering a plate, covering a city, leaving the screen. */
const PRICE = { reach: 1, plate: 4, city: 3, outside: 2 } as const;
/** Price of moving a plate one px from its usual spot: a plate never travels far for a small gain. */
const PRICE_MOVE = 40;
/** The steps of the search (px): aside by about half a plate, up by about half of one. */
const STEP_X = 100;
const STEP_UP = 45;
/** Candidate columns, in steps; rows above the place and rows under it. */
const COLUMNS = [0, 1, -1, 2, -2, 3, -3] as const;
const ROWS_ABOVE = [0, 1, 2, 3] as const;
const ROWS_BELOW = [0, 1, 2] as const;

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  if (w <= 0) return 0;
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return h <= 0 ? 0 : w * h;
}

function area(r: Rect): number {
  return (r.right - r.left) * (r.bottom - r.top);
}

/** The box of an arena centred at `(x, y)` px, with the room its arrows and labels need. */
export function arenaBox(x: number, y: number, slot: Pick<ArenaSlot, 'top' | 'bottom'>): Rect {
  return {
    left: x - PLATE.halfWidth,
    right: x + PLATE.halfWidth,
    top: y - PLATE.halfHeight - slot.top,
    bottom: y + PLATE.halfHeight + 2 + slot.bottom,
  };
}

function inflate(r: Rect, by: number): Rect {
  return { left: r.left - by, top: r.top - by, right: r.right + by, bottom: r.bottom + by };
}

/** The box a city takes on the screen: its ring and what hangs around it. */
export function cityBox(city: Obstacle, scale: number): Rect {
  const x = city.at.x * scale;
  const y = city.at.y * scale;
  const ring = city.ring * scale;
  return {
    left: x - ring - CITY_REACH.side,
    right: x + ring + CITY_REACH.side,
    top: y - ring - CITY_REACH.top,
    bottom: y + ring + CITY_REACH.bottom,
  };
}

/**
 * Places the arenas in order: the first one has the best spot, each next one takes the free spot
 * nearest to its usual one. `scale`: camera scale (CSS px per world unit). `view`: the canvas in
 * scaled-world px, `null` when it is not known (nothing is then kept on the screen). `cities`: the
 * cities that an arena should not cover.
 */
export function layoutArenas(
  slots: readonly ArenaSlot[],
  cities: readonly Obstacle[],
  scale: number,
  view: Rect | null,
): ArenaSpot[] {
  const k = scale > 0 ? scale : 1;
  const boxes = cities.map((city) => cityBox(city, k));
  const taken: { reach: Rect; plate: Rect }[] = [];
  const spots: ArenaSpot[] = [];
  for (const slot of slots) {
    const ringPx = slot.ring * k;
    const gap = slot.road ? ARENA_GAP_EDGE : ARENA_GAP_NODE;
    const ax = slot.at.x * k;
    const ay = slot.at.y * k;
    const usualY = ay - ringPx - gap;
    // Under the place the plate stands as far from it as it does over it.
    const belowY = ay + ringPx + gap;
    let best = { x: ax, y: usualY, moved: 0, cost: Infinity };
    const consider = (x: number, y: number): void => {
      const moved = Math.hypot(x - ax, y - usualY);
      if (moved * PRICE_MOVE >= best.cost) return;
      const box = arenaBox(x, y, slot);
      const padded = inflate(box, MARGIN / 2);
      let cost = moved * PRICE_MOVE;
      // A plate covered by a plate costs full, the arrows only meeting another arena less.
      const plate = inflate(arenaBox(x, y, NO_REACH), MARGIN / 2);
      for (const other of taken) {
        cost +=
          PRICE.reach * overlap(padded, other.reach) + PRICE.plate * overlap(plate, other.plate);
      }
      // A city is covered by the plate itself; the arrows of the arena may reach over it.
      for (const city of boxes) cost += PRICE.city * overlap(plate, city);
      if (view !== null) cost += PRICE.outside * (area(box) - overlap(box, view));
      if (cost < best.cost) best = { x, y, moved, cost };
    };
    for (const row of ROWS_ABOVE) {
      for (const column of COLUMNS) consider(ax + column * STEP_X, usualY - row * STEP_UP);
    }
    for (const row of ROWS_BELOW) {
      for (const column of COLUMNS) consider(ax + column * STEP_X, belowY + row * STEP_UP);
    }
    taken.push({
      reach: inflate(arenaBox(best.x, best.y, slot), MARGIN / 2),
      plate: inflate(arenaBox(best.x, best.y, NO_REACH), MARGIN / 2),
    });
    spots.push({ x: best.x / k, y: best.y / k, moved: best.moved });
  }
  return spots;
}
