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
});
