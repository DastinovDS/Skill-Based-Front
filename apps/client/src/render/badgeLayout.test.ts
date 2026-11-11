import { describe, expect, it } from 'vitest';
import {
  badgeCount,
  badgeFloor,
  badgeLabel,
  badgesBox,
  chevronCount,
  chevronStrokes,
  SHOULDER,
  shoulderBadge,
  shoulderWant,
  stackBadges,
  terrainBadges,
} from './badgeLayout.ts';
import { chevronBadgeSpec } from './bakedShapes.ts';
import { BADGE, PROVINCE } from './style.ts';
import { fitReach } from './cityLayout.ts';
import { keepClear } from './shapes.ts';
import { helmet } from '../units/helmet.ts';
import { helmetFit, helmetWidth } from './helmetFit.ts';

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

describe('chevrons on the helmet shoulder (C2 of #954, #956)', () => {
  /** The bound the map gives a token in a node of body `radius` (entityView.ts, `fitReach` + 2.2). */
  const BOUND_PAST_FIT = 2.2;
  const radii = [PROVINCE.radius, 11, 14, 17, 20];

  function place(radius: number, units: number, count: number, px: number) {
    const bound = fitReach(radius) + BOUND_PAST_FIT;
    const width = helmetFit('own', helmetWidth(36, true), fitReach(radius));
    const keep = keepClear(
      { counts: { units, charged: 1 }, range: null },
      helmet('own', width).middle,
      'own',
      width,
    );
    const box = badgesBox([{ dir: 'up', count }]);
    if (box === null) throw new Error('a mark has a box');
    const put = shoulderBadge(box, bound, keep, shoulderWant(px));
    const mine = {
      x0: put.at.x + box.x0 * put.scale,
      y0: put.at.y + box.y0 * put.scale,
      x1: put.at.x + box.x1 * put.scale,
      y1: put.at.y + box.y1 * put.scale,
    };
    return { put, mine, bound, keep };
  }

  it('stays inside the ring and clear of the number on every node size, count and zoom', () => {
    for (const radius of radii) {
      for (const units of [1, 9, 12]) {
        for (const count of [1, 3, 5, 9]) {
          for (const px of [0.4, 0.6, 1, 2]) {
            const { put, mine, bound, keep } = place(radius, units, count, px);
            for (const x of [mine.x0, mine.x1]) {
              for (const y of [mine.y0, mine.y1]) {
                // A count of 3 strokes or a number may take back up to 3.5 of the ring on the smallest nodes.
                expect(Math.hypot(x, y)).toBeLessThanOrEqual(bound + (count >= 3 ? 3.5 : 0) + 0.01);
              }
            }
            // The number (the first box) is never covered.
            const { number } = keep;
            expect(number).not.toBeNull();
            if (number === null) continue;
            const apart =
              mine.x1 <= number.x0 ||
              mine.x0 >= number.x1 ||
              mine.y1 <= number.y0 ||
              mine.y0 >= number.y1;
            const label = `${String(radius)} u${String(units)} n${String(count)} px${String(px)}`;
            expect(apart, label).toBe(true);
            expect(put.scale).toBeGreaterThanOrEqual(SHOULDER.min);
            expect(put.scale).toBeLessThanOrEqual(SHOULDER.max);
          }
        }
      }
    }
  });

  it('keeps about 0.78 of the size where the ring leaves room, and shrinks on the smallest nodes', () => {
    expect(place(20, 1, 1, 1).put.scale).toBeGreaterThanOrEqual(0.7);
    expect(place(PROVINCE.radius, 12, 5, 1).put.scale).toBeLessThan(SHOULDER.scale);
  });

  it('asks for more size at a far zoom, up to a cap, and the normal share at the normal one', () => {
    expect(shoulderWant(2)).toBe(SHOULDER.scale);
    expect(shoulderWant(0.6)).toBeGreaterThan(SHOULDER.scale);
    expect(shoulderWant(0.01)).toBe(SHOULDER.max);
    expect(shoulderWant(0)).toBe(SHOULDER.scale);
  });
});
