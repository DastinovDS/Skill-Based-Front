import { describe, expect, it } from 'vitest';
import type { FightPlace, RoundFx } from './fightFx.ts';
import { placeKey } from './fightFx.ts';
import { HIT_SHARE } from './fightImpact.ts';
import { LEAVER_ALPHA, leaverAlpha, leaversOf, type PlaceMemory } from './leaverLayout.ts';
import { TRACER_END_SHARE } from './shotLayout.ts';

const ROUND = 20;
const place: FightPlace = { node: 3, edge: null, at: { x: 100, y: 50 }, ring: 20 };
const key = placeKey(place);
const round = (tick: number): RoundFx => ({
  kind: 'round',
  tick,
  place,
  losses: [0, 2],
  shots: [2, 1],
  virtual: [0, 0],
});
const memory: PlaceMemory = {
  points: { own: { x: 90, y: 50 }, enemy: { x: 110, y: 50 } },
  seen: { own: true, enemy: true },
};
const never = (): boolean => false;

describe('the ghost of a side that left a fight (#811)', () => {
  it('holds until the last shot lands, then fades with the afterglow, then lets go', () => {
    expect(leaverAlpha(-1, ROUND)).toBeNull();
    expect(leaverAlpha(0, ROUND)).toBe(LEAVER_ALPHA);
    expect(leaverAlpha(HIT_SHARE * ROUND - 0.01, ROUND)).toBe(LEAVER_ALPHA);
    const mid = leaverAlpha((HIT_SHARE + (TRACER_END_SHARE - HIT_SHARE) / 2) * ROUND, ROUND);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(LEAVER_ALPHA);
    expect(leaverAlpha(TRACER_END_SHARE * ROUND, ROUND)).toBeNull();
  });

  it('keeps a ghost where a side stood while the shots of its ended fight are in the air', () => {
    const ghosts = leaversOf([round(100)], 102, ROUND, new Set(), () => memory, never);
    expect(ghosts.map((g) => g.side).sort()).toEqual(['enemy', 'own']);
    expect(ghosts.find((g) => g.side === 'enemy')?.at).toEqual({ x: 110, y: 50 });
  });

  it('has none once the shots are done, or while the fight is still in sight', () => {
    const late = 100 + TRACER_END_SHARE * ROUND;
    expect(leaversOf([round(100)], late, ROUND, new Set(), () => memory, never)).toEqual([]);
    expect(leaversOf([round(100)], 102, ROUND, new Set([key]), () => memory, never)).toEqual([]);
  });

  it('has none for a side that is still standing, or was never seen there', () => {
    const standing = (side: 'own' | 'enemy'): boolean => side === 'own';
    const ghosts = leaversOf([round(100)], 102, ROUND, new Set(), () => memory, standing);
    expect(ghosts.map((g) => g.side)).toEqual(['enemy']);
    const unseen: PlaceMemory = { ...memory, seen: { own: false, enemy: false } };
    expect(leaversOf([round(100)], 102, ROUND, new Set(), () => unseen, never)).toEqual([]);
    expect(leaversOf([round(100)], 102, ROUND, new Set(), () => undefined, never)).toEqual([]);
  });

  it('draws one ghost for a side when two rounds of the place are in the window', () => {
    const ghosts = leaversOf([round(98), round(100)], 102, ROUND, new Set(), () => memory, never);
    expect(ghosts).toHaveLength(2);
  });
});
