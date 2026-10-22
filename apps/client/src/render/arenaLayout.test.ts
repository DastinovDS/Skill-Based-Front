import { describe, expect, it } from 'vitest';
import {
  arenaBox,
  cityBox,
  layoutArenas,
  type ArenaSlot,
  type Obstacle,
  type Rect,
} from './arenaLayout.ts';
import { arenaCenter } from './fightFx.ts';

const SCALE = 0.5;
const slot = (x: number, y: number, extra: Partial<ArenaSlot> = {}): ArenaSlot => ({
  at: { x, y },
  ring: 30,
  road: false,
  top: 30,
  bottom: 28,
  ...extra,
});

const boxOf = (_s: ArenaSlot, spot: { x: number; y: number }): Rect =>
  arenaBox(spot.x * SCALE, spot.y * SCALE, { top: 0, bottom: 0 });

const overlaps = (a: Rect, b: Rect): boolean =>
  Math.min(a.right, b.right) > Math.max(a.left, b.left) &&
  Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);

describe('layoutArenas', () => {
  it('leaves a lone arena over its place, where arenaCenter puts it', () => {
    const s = slot(800, 900);
    const [spot] = layoutArenas([s], [], SCALE, null);
    const usual = arenaCenter({ node: 1, edge: null, at: s.at, ring: s.ring }, SCALE);
    expect(spot?.x).toBeCloseTo(usual.x);
    expect(spot?.y).toBeCloseTo(usual.y);
    expect(spot?.moved).toBe(0);
  });

  it('keeps the arena of a road over its meeting point at the usual gap', () => {
    const s = slot(800, 900, { ring: 0, road: true });
    const [spot] = layoutArenas([s], [], SCALE, null);
    const usual = arenaCenter({ node: null, edge: 2, at: s.at, ring: 0 }, SCALE);
    expect(spot?.y).toBeCloseTo(usual.y);
    expect(spot?.moved).toBe(0);
  });

  it('moves the plates of fights that would cover each other, so that no two overlap', () => {
    // Four fights in one corner of the map (the scene `fights`), a few px apart.
    const slots = [slot(600, 700), slot(640, 740), slot(700, 760), slot(660, 700)];
    const spots = layoutArenas(slots, [], SCALE, null);
    const boxes = spots.map((spot, i) => boxOf(slots[i] as ArenaSlot, spot));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(overlaps(boxes[i] as Rect, boxes[j] as Rect)).toBe(false);
      }
    }
    // The first fight has the best place: it did not move.
    expect(spots[0]?.moved).toBe(0);
    expect(spots.slice(1).some((spot) => spot.moved > 0)).toBe(true);
  });

  it('is a function of its input: the same fights give the same places', () => {
    const slots = [slot(600, 700), slot(640, 740), slot(700, 760)];
    expect(layoutArenas(slots, [], SCALE, null)).toEqual(layoutArenas(slots, [], SCALE, null));
  });

  it('does not put a plate over a city when a free spot is near', () => {
    const own = slot(800, 900);
    // A city right where the plate floats.
    const usual = arenaCenter({ node: 1, edge: null, at: own.at, ring: own.ring }, SCALE);
    const city: Obstacle = { at: { x: usual.x, y: usual.y }, ring: 30 };
    const [spot] = layoutArenas([own], [city], SCALE, null);
    const plate = arenaBox((spot?.x ?? 0) * SCALE, (spot?.y ?? 0) * SCALE, { top: 0, bottom: 0 });
    expect(overlaps(plate, cityBox(city, SCALE))).toBe(false);
    expect(spot?.moved).toBeGreaterThan(0);
  });

  it('keeps a plate on the screen when its place is at the top edge', () => {
    // The city is 60 px from the top of the screen: the usual spot is above the edge.
    const top = slot(500, 120);
    const view: Rect = { left: 0, top: 0, right: 640, bottom: 400 };
    const [spot] = layoutArenas([top], [], SCALE, view);
    const box = arenaBox((spot?.x ?? 0) * SCALE, (spot?.y ?? 0) * SCALE, top);
    expect(box.top).toBeGreaterThanOrEqual(view.top);
    expect(box.bottom).toBeLessThanOrEqual(view.bottom);
    // The plate moved under the city, not over it: the city stays uncovered.
    const city: Obstacle = { at: top.at, ring: top.ring };
    const plate = arenaBox((spot?.x ?? 0) * SCALE, (spot?.y ?? 0) * SCALE, { top: 0, bottom: 0 });
    expect(overlaps(plate, cityBox(city, SCALE))).toBe(false);
  });

  it('works with a camera of any scale: a plate is the same size on every screen', () => {
    for (const scale of [0.3, 1, 2.5]) {
      const slots = [slot(600, 700), slot(620, 710)];
      const spots = layoutArenas(slots, [], scale, null);
      const boxes = spots.map((spot, i) =>
        arenaBox(spot.x * scale, spot.y * scale, slots[i] as ArenaSlot),
      );
      expect(overlaps(boxes[0] as Rect, boxes[1] as Rect)).toBe(false);
    }
  });
});
