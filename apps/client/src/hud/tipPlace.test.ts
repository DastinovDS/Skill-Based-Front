import { describe, expect, it } from 'vitest';
import { TIP, tipPlacement } from './tipPlace.ts';

const VIEW = { width: 1280, height: 800 };
const SIZE = { width: 120, height: 40 };

describe('tipPlacement (Leader)', () => {
  it('stands up and to the right of the object, the leader leaving its lower left', () => {
    const spot = tipPlacement({ x: 400, y: 300 }, SIZE, VIEW);
    expect(spot.left).toBe(400 + TIP.dx);
    expect(spot.top).toBe(300 - TIP.dy - SIZE.height);
    expect(spot.foot).toEqual({ x: TIP.inset, y: SIZE.height });
  });

  it('turns to the left at the right edge, the leader leaving its lower right', () => {
    const spot = tipPlacement({ x: 1250, y: 300 }, SIZE, VIEW);
    expect(spot.left).toBe(1250 - TIP.dx - SIZE.width);
    expect(spot.foot).toEqual({ x: SIZE.width - TIP.inset, y: SIZE.height });
  });

  it('goes below near the top, the leader leaving its top', () => {
    const spot = tipPlacement({ x: 400, y: 30 }, SIZE, VIEW);
    expect(spot.top).toBe(30 + TIP.dy);
    expect(spot.foot.y).toBe(0);
  });

  it('never leaves the window', () => {
    const spot = tipPlacement({ x: 5, y: 795 }, { width: 2000, height: 900 }, VIEW);
    expect(spot.left).toBeGreaterThanOrEqual(TIP.margin);
    expect(spot.top).toBeGreaterThanOrEqual(TIP.margin);
  });

  it('keeps clear of the circle of its subject: the tag stands outside the helmet, not on it', () => {
    const helmet = { x: 400, y: 300, r: 40 };
    // The pointer rests on the helmet's middle; the tag's nearest corner is outside the circle.
    const spot = tipPlacement({ x: 400, y: 300 }, SIZE, VIEW, helmet);
    const nearestX = Math.max(spot.left, Math.min(helmet.x, spot.left + SIZE.width));
    const nearestY = Math.max(spot.top, Math.min(helmet.y, spot.top + SIZE.height));
    expect(Math.hypot(nearestX - helmet.x, nearestY - helmet.y)).toBeGreaterThan(helmet.r);
    // Up and to the right, like the tag without a circle.
    expect(spot.left).toBeGreaterThan(helmet.x);
    expect(spot.top + SIZE.height).toBeLessThan(helmet.y);
  });

  it('turns away from the circle the same way as from the pointer at an edge', () => {
    const helmet = { x: 1250, y: 300, r: 40 };
    const spot = tipPlacement({ x: 1250, y: 300 }, SIZE, VIEW, helmet);
    expect(spot.left + SIZE.width).toBeLessThan(helmet.x);
  });
});
