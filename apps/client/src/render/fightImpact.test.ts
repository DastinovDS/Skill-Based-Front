import { describe, expect, it } from 'vitest';
import type { MapFile } from '../protocol.gen.ts';
import { fightPlace, placeKey } from './fightFx.ts';
import {
  HIT_SHARE,
  NUMBER_SHARE,
  contactPoints,
  silentProgress,
  sinceShare,
} from './fightImpact.ts';
import { FIGHT_GAP } from './style.ts';

const map = {
  nodes: [
    { id: 0, x: 10, y: 120 },
    { id: 1, x: 110, y: 120 },
  ],
  edges: [{ id: 0, a: 0, b: 1 }],
} as unknown as MapFile;
const radius = (): number => 14;
const place = (): NonNullable<ReturnType<typeof fightPlace>> => {
  const result = fightPlace(map, 1, null, null, radius);
  if (result === undefined) throw new Error('no place');
  return result;
};

describe('timing: shares of the round', () => {
  it.each([10, 20])('keeps the "-N" for half a round after the hit (%i ticks)', (roundTicks) => {
    const hit = HIT_SHARE * roundTicks;
    expect(sinceShare(hit - 1, HIT_SHARE, NUMBER_SHARE, roundTicks)).toBeNull();
    expect(
      sinceShare(hit + NUMBER_SHARE * roundTicks - 0.1, HIT_SHARE, NUMBER_SHARE, roundTicks),
    ).toBeLessThan(1);
    expect(
      sinceShare(hit + NUMBER_SHARE * roundTicks, HIT_SHARE, NUMBER_SHARE, roundTicks),
    ).toBeNull();
  });

  it('times the silent ring', () => {
    expect(silentProgress(4.5, 20)).toBeCloseTo(0.5);
    expect(silentProgress(9, 20)).toBeNull();
  });
});

describe('where the two sides stand', () => {
  it('uses both tokens when both are known', () => {
    const contacts = contactPoints(map, place(), {
      own: { x: 100, y: 120 },
      enemy: { x: 130, y: 120 },
    });
    expect(contacts).toEqual({ own: { x: 100, y: 120 }, enemy: { x: 130, y: 120 } });
  });

  it('mirrors the unknown side across the place of the fight', () => {
    const contacts = contactPoints(map, place(), { own: { x: 90, y: 100 } });
    expect(contacts.enemy).toEqual({ x: 130, y: 140 });
  });

  it('puts the sides FIGHT_GAP apart along the road when no token is known', () => {
    const road = fightPlace(map, null, 0, 1000, radius);
    if (road === undefined) throw new Error('no place');
    const contacts = contactPoints(map, road, {});
    expect(contacts.enemy.x - contacts.own.x).toBeCloseTo(FIGHT_GAP);
    expect(contacts.own.y).toBe(contacts.enemy.y);
    expect((contacts.own.x + contacts.enemy.x) / 2).toBeCloseTo(road.at.x);
  });

  it('keeps two tokens on one spot apart', () => {
    const at = place().at;
    const contacts = contactPoints(map, place(), { own: at, enemy: at });
    expect(
      Math.hypot(contacts.enemy.x - contacts.own.x, contacts.enemy.y - contacts.own.y),
    ).toBeGreaterThanOrEqual(16);
  });

  it('has one key per place', () => {
    expect(placeKey(place())).toBe(placeKey(place()));
  });
});
