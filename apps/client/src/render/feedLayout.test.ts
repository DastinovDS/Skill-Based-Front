import { describe, expect, it } from 'vitest';
import type { Rect } from './arenaLayout.ts';
import { feedBox, layoutFeeds } from './feedLayout.ts';

const view: Rect = { left: 0, top: 0, right: 1000, bottom: 700 };
const overlaps = (a: Rect, b: Rect): boolean =>
  Math.min(a.right, b.right) > Math.max(a.left, b.left) &&
  Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);

describe('layoutFeeds (#812)', () => {
  it('puts a feed up and to the right of its node by default', () => {
    const [spot] = layoutFeeds([{ at: { x: 400, y: 400 }, ring: 30 }], [], [], 1, view);
    expect(spot?.left).toBe(false);
    expect(spot?.x).toBeGreaterThan(400 + 30 * 0.6);
    expect(spot?.y).toBeLessThan(400 - 30 * 0.75);
  });

  it('moves to the other side when the right edge of the screen is near', () => {
    const [spot] = layoutFeeds([{ at: { x: 960, y: 400 }, ring: 30 }], [], [], 1, view);
    expect(spot?.left).toBe(true);
  });

  it('keeps two feeds of nearby nodes apart', () => {
    const spots = layoutFeeds(
      [
        { at: { x: 400, y: 400 }, ring: 30 },
        { at: { x: 440, y: 410 }, ring: 30 },
      ],
      [],
      [],
      1,
      view,
    );
    const [a, b] = spots;
    if (a === undefined || b === undefined) throw new Error('no spot');
    expect(overlaps(feedBox(a.x, a.y), feedBox(b.x, b.y))).toBe(false);
  });

  it('keeps clear of the plate of a fight going on', () => {
    const plate: Rect = { left: 420, top: 280, right: 700, bottom: 380 };
    const [spot] = layoutFeeds([{ at: { x: 400, y: 400 }, ring: 30 }], [], [plate], 1, view);
    if (spot === undefined) throw new Error('no spot');
    expect(overlaps(feedBox(spot.x, spot.y), plate)).toBe(false);
  });
});
