import { describe, expect, it } from 'vitest';
import {
  badgeCount,
  badgeFloor,
  badgeLabel,
  chevronCount,
  chevronStrokes,
  stackBadges,
  terrainBadges,
} from './badgeLayout.ts';
import { chevronBadgeSpec } from './bakedShapes.ts';
import { BADGE } from './style.ts';

describe('chevron badges (#791)', () => {
  it('counts by strokes up to three, then one chevron and a number, "9+" above nine', () => {
    expect([1, 2, 3, 4, 9, 10, 25].map(chevronCount)).toEqual([1, 2, 3, 1, 1, 1, 1]);
    expect([1, 3, 4, 9, 10, 25].map(badgeLabel)).toEqual(['', '', '4', '9', '9+', '9+']);
    expect(badgeCount(0)).toBe(1);
  });

  it('points the tip up for an advantage and down for a disadvantage', () => {
    const [up] = chevronStrokes('up', 10, 1);
    const [down] = chevronStrokes('down', 10, 1);
    expect(up?.[1]?.y).toBeLessThan(up?.[0]?.y ?? 0);
    expect(down?.[1]?.y).toBeGreaterThan(down?.[0]?.y ?? 0);
    // Symmetric about the middle: a v, not a tick.
    expect(up?.[0]?.x).toBe(-(up?.[2]?.x ?? 0));
  });

  it('bakes a bounded set of looks: 2 directions x 10 counts x 2 sizes', () => {
    const keys = new Set<string>();
    for (const dir of ['up', 'down'] as const) {
      for (let n = 1; n <= 40; n++) {
        for (const size of [BADGE.size, BADGE.chipSize]) {
          keys.add(chevronBadgeSpec(dir, n, size).key);
        }
      }
    }
    expect(keys.size).toBe(40);
  });

  it('reads the terrain mark of the server as it is (no rule in the client)', () => {
    expect(terrainBadges(1)).toEqual([{ dir: 'up', count: 1 }]);
    expect(terrainBadges(-1)).toEqual([{ dir: 'down', count: 1 }]);
    expect(terrainBadges(null)).toEqual([]);
    expect(terrainBadges(0)).toEqual([]);
  });

  it('stacks the badges of one corner downwards and keeps them at least 8 px on screen', () => {
    const at = stackBadges(
      { x: 5, y: -10 },
      [
        { dir: 'up', count: 1 },
        { dir: 'down', count: 1 },
      ],
      10,
    );
    expect(at[0]).toEqual({ x: 5, y: -10 });
    expect(at[1]?.y).toBeGreaterThan(-10);
    expect(BADGE.size * 0.4 * badgeFloor(0.4)).toBeCloseTo(BADGE.minPx);
    expect(badgeFloor(2)).toBe(1);
  });
});
