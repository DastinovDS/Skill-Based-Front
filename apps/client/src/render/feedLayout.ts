/**
 * Where the kill feeds of finished fights stand (#812): a block of two rows beside the node, up and to the
 * right of it by default. When that spot is taken by another feed, a plate of a fight going on, another city or
 * the edge of the screen, it moves to the free spot nearest to it (the other side of the node, or a block higher
 * or lower). Pure functions, no PixiJS and no DOM; nothing here decides what happened in a fight.
 *
 * The work is done in "scaled world" px (world units times the camera scale), like `arenaLayout.ts`, which it
 * borrows the rectangles of cities from.
 */
import type { Point } from './camera.ts';
import { cityBox, type Obstacle, type Rect } from './arenaLayout.ts';
import { FEED } from './style.ts';

/** One feed to place: the node (or the point on a road) and the ring of its city. */
export interface FeedSlot {
  readonly at: Point;
  /** Radius of the capacity ring of the city in world units; 0 on a road. */
  readonly ring: number;
}

/** Where a feed stands: the middle of its block in world units. */
export interface FeedSpot {
  readonly x: number;
  readonly y: number;
  /** The block stands to the left of its node (the rows slide in from the left). */
  readonly left: boolean;
}

/** The size of the block of two rows (px, from its middle). */
const FEED_BLOCK = {
  halfWidth: FEED.halfWidth,
  halfHeight: FEED.rowHeight + FEED.rowGap / 2,
} as const;

/** Air kept between two blocks (px). */
const MARGIN = 3;
/** Air between a block and the ring of its node (px). */
const NODE_GAP = 8;
/** Prices of a px²: covering another feed, a plate or a city, leaving the screen; and of each step down the candidate list. */
const PRICE = { feed: 6, plate: 5, city: 3, outside: 2 } as const;
const PRICE_ORDER = 40;
/** Candidate blocks: the side of the node and how many blocks up (negative: down) from the default height. */
const SIDES = [1, -1] as const;
const LIFTS = [0, 1, -1, 2, -2] as const;

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  if (w <= 0) return 0;
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return h <= 0 ? 0 : w * h;
}

function area(r: Rect): number {
  return (r.right - r.left) * (r.bottom - r.top);
}

/** The box of a feed block centred at `(x, y)` px. */
export function feedBox(x: number, y: number): Rect {
  return {
    left: x - FEED_BLOCK.halfWidth - MARGIN / 2,
    right: x + FEED_BLOCK.halfWidth + MARGIN / 2,
    top: y - FEED_BLOCK.halfHeight - MARGIN / 2,
    bottom: y + FEED_BLOCK.halfHeight + MARGIN / 2,
  };
}

/**
 * Places the feeds in order (the first has the best spot). `scale`: camera scale (CSS px per world unit).
 * `view`: the canvas in scaled-world px, `null` when unknown. `cities`: what a block should not cover (the
 * node of a feed itself is skipped). `plates`: boxes (scaled-world px) of the arenas of fights going on.
 */
export function layoutFeeds(
  slots: readonly FeedSlot[],
  cities: readonly Obstacle[],
  plates: readonly Rect[],
  scale: number,
  view: Rect | null,
): FeedSpot[] {
  const k = scale > 0 ? scale : 1;
  const taken: Rect[] = [];
  const spots: FeedSpot[] = [];
  for (const slot of slots) {
    const ax = slot.at.x * k;
    const ay = slot.at.y * k;
    const ring = slot.ring * k;
    const boxes = cities
      .filter((city) => city.at.x !== slot.at.x || city.at.y !== slot.at.y)
      .map((city) => cityBox(city, k));
    // Up and to the right of the node: the low corner of the block at three quarters of the ring's height.
    const baseY = ay - ring * 0.75 - FEED_BLOCK.halfHeight;
    let best = { x: ax, y: baseY, left: false, cost: Infinity };
    let order = 0;
    for (const lift of LIFTS) {
      for (const side of SIDES) {
        const x = ax + side * (ring * 0.6 + NODE_GAP + FEED_BLOCK.halfWidth);
        const y = baseY - lift * (2 * FEED_BLOCK.halfHeight + MARGIN);
        const box = feedBox(x, y);
        let cost = order++ * PRICE_ORDER;
        for (const other of taken) cost += PRICE.feed * overlap(box, other);
        for (const plate of plates) cost += PRICE.plate * overlap(box, plate);
        for (const city of boxes) cost += PRICE.city * overlap(box, city);
        if (view !== null) cost += PRICE.outside * (area(box) - overlap(box, view));
        if (cost < best.cost) best = { x, y, left: side < 0, cost };
      }
    }
    taken.push(feedBox(best.x, best.y));
    spots.push({ x: best.x / k, y: best.y / k, left: best.left });
  }
  return spots;
}
