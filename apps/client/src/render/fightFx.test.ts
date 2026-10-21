import { describe, expect, it } from 'vitest';
import type { EventMsg, FightView, MapFile } from '../protocol.gen.ts';
import type { RenderGroup } from '../net/interpolate.ts';
import {
  ARENA_GAP_EDGE,
  ARENA_GAP_NODE,
  arenaSides,
  fightFx,
  fightPlace,
  fightResult,
  roundProgress,
  drawnShots,
  shotCount,
  shotLook,
  sparkLook,
  type EndFx,
} from './fightFx.ts';
import { ringRadius } from './cityLayout.ts';

const map = {
  nodes: [
    { id: 0, x: 10, y: 120 },
    { id: 1, x: 110, y: 120 },
  ],
  edges: [{ id: 0, a: 0, b: 1 }],
} as unknown as MapFile;
const radius = (): number => 14;

const event = (kind: string, data: EventMsg['data']): EventMsg => ({
  type: 'event',
  tick: 50,
  kind,
  data,
});

describe('fightPlace', () => {
  it('floats the arena of a fight in a city above its ring', () => {
    const place = fightPlace(map, 1, null, null, radius);
    expect(place?.at).toEqual({ x: 110, y: 120 });
    expect(place?.arena).toEqual({ x: 110, y: 120 - ringRadius(14) - ARENA_GAP_NODE });
  });

  it('puts a fight on a road at its meeting point (DEC-24, C3), the arena above it', () => {
    // point = 1134: the mark at 1134 / 2000 of the road from `a`.
    const place = fightPlace(map, null, 0, 1134, radius);
    expect(place?.at.x).toBeCloseTo(66.7);
    expect(place?.arena.y).toBe(120 - ARENA_GAP_EDGE);
  });

  it('is unknown for an unknown place', () => {
    expect(fightPlace(map, 9, null, null, radius)).toBeUndefined();
    expect(fightPlace(map, null, null, null, radius)).toBeUndefined();
  });
});

describe('fightFx', () => {
  it('reads a round: where, the shots of both sides with the virtual ones, the losses', () => {
    const fx = fightFx(
      event('fight_round', {
        node: 1,
        edge: null,
        shots_0: 1,
        shots_1: 2,
        virtual_0: 0,
        virtual_1: 1,
        losses_0: 0,
        losses_1: 1,
      }),
      map,
      radius,
    );
    expect(fx).toMatchObject({
      kind: 'round',
      tick: 50,
      shots: [1, 2],
      virtual: [0, 1],
      losses: [0, 1],
    });
  });

  it('reads an old round (before DEC-29): the enemy has no shots, no virtual ones', () => {
    const fx = fightFx(
      event('fight_round', { node: 1, edge: null, shots_0: 1, losses_0: 0, losses_1: 1 }),
      map,
      radius,
    );
    expect(fx).toMatchObject({ kind: 'round', shots: [1, null], virtual: [0, 0] });
  });

  it('reads the end: the winner, the capture and the losses of the whole fight', () => {
    const fx = fightFx(
      event('fight_ended', {
        node: 1,
        edge: null,
        winner: 1,
        captured: true,
        losses_0: 3,
        losses_1: 2,
      }),
      map,
      radius,
    );
    expect(fx).toMatchObject({
      kind: 'end',
      winner: 1,
      captured: true,
      losses: [3, 2],
      legacy: false,
    });
  });

  it('keeps the instant fight of old replays as a legacy end without a result', () => {
    const fx = fightFx(
      event('fight', { node: 1, edge: null, losses_0: 1, losses_1: 1 }),
      map,
      radius,
    );
    expect(fx).toMatchObject({ kind: 'end', winner: null, legacy: true });
  });

  it('ignores other events, unknown places and events without losses', () => {
    expect(fightFx(event('fight_started', { node: 1 }), map, radius)).toBeNull();
    expect(fightFx(event('node_captured', {}), map, radius)).toBeNull();
    expect(
      fightFx(event('fight_round', { node: 9, edge: null, losses_0: 1, losses_1: 1 }), map, radius),
    ).toBeNull();
    expect(fightFx(event('fight_round', { node: 0, edge: null }), map, radius)).toBeNull();
  });
});

describe('fightResult', () => {
  const end = (winner: 0 | 1 | null, captured: boolean): EndFx => {
    const place = fightPlace(map, 1, null, null, radius);
    if (place === undefined) throw new Error('no place');
    return { kind: 'end', tick: 1, place, winner, captured, losses: [0, 0], legacy: false };
  };

  it('tells captured, held and both bounced', () => {
    expect(fightResult(end(0, true))).toBe('captured');
    expect(fightResult(end(1, false))).toBe('held');
    expect(fightResult(end(null, false))).toBe('bounced');
  });
});

describe('shots of a round', () => {
  it('fly towards the middle one after another, land, and spark', () => {
    expect(shotLook(0, 0).flight).toBe(0);
    expect(shotLook(0.4, 0).flight).toBe(1);
    expect(shotLook(0.4, 0).spark).toBe(0);
    expect(shotLook(0.7, 0).spark).toBeGreaterThan(0);
    expect(shotLook(1, 0).alpha).toBe(0);
    // The second shot starts later.
    expect(shotLook(0.1, 1).flight).toBeLessThan(shotLook(0.1, 0).flight);
  });

  it('caps the shots drawn for a side; an unknown count draws none', () => {
    expect(shotCount(null)).toBe(0);
    expect(shotCount(0)).toBe(0);
    expect(shotCount(2)).toBe(2);
    expect(shotCount(40)).toBe(3);
  });

  const roundFx = (shots: [number | null, number | null], virtual: [number, number]) =>
    ({
      kind: 'round',
      tick: 1,
      place: { node: 1, edge: null, at: { x: 0, y: 0 }, arena: { x: 0, y: 0 } },
      shots,
      virtual,
      losses: [1, 2],
    }) as const;

  it('draws the shots of a side with the virtual ones first', () => {
    expect(drawnShots(roundFx([2, 1], [1, 0]), 0)).toEqual({ count: 2, virtual: 1 });
    expect(drawnShots(roundFx([2, 1], [1, 0]), 1)).toEqual({ count: 1, virtual: 0 });
    // The virtual ones never outnumber the shots drawn.
    expect(drawnShots(roundFx([40, 1], [9, 0]), 0)).toEqual({ count: 3, virtual: 3 });
  });

  it('draws the hits instead of the shots an old event lacks', () => {
    // Player 1's shots are unknown: it hit player 0 `losses[0]` = 1 times.
    expect(drawnShots(roundFx([1, null], [0, 0]), 1)).toEqual({ count: 1, virtual: 0 });
  });

  it('the spark grows and fades out', () => {
    expect(sparkLook(0).alpha).toBe(0);
    expect(sparkLook(0.5).scale).toBeGreaterThan(sparkLook(0.1).scale);
    expect(sparkLook(0.5).alpha).toBeCloseTo(0.5);
    expect(sparkLook(1).alpha).toBe(0);
  });
});

describe('arena', () => {
  const fight: FightView = {
    id: 'f',
    node: 1,
    edge: null,
    point: null,
    attacker: 1,
    start_tick: 10,
    next_round_tick: 60,
    groups: ['a', 'b'],
    enemy_units: 3,
    enemy_charged: 2,
    shots: [0, 0],
    losses: [0, 0],
    last_round: null,
  };
  const group = (id: string, units: number, owner?: 0 | 1): RenderGroup => ({
    group: {
      id,
      units,
      charged: 0,
      mode: 'attack',
      location: { kind: 'node', node: 1 },
      order: null,
    },
    location: { kind: 'node', node: 1 },
    ...(owner === undefined ? {} : { owner }),
  });

  it('counts the own groups of the fight and the exact enemy total', () => {
    expect(arenaSides(fight, [group('a', 2), group('b', 1), group('x', 9)], 0)).toEqual({
      own: 3,
      enemy: 3,
    });
  });

  it('adds the groups of the opponent when the frame shows both sides', () => {
    const both = { ...fight, enemy_units: 0 };
    expect(arenaSides(both, [group('a', 2, 0), group('b', 4, 1)], 0)).toEqual({ own: 2, enemy: 4 });
  });

  it('the arc fills towards the next round', () => {
    expect(roundProgress(60, 50, 10)).toBe(0);
    expect(roundProgress(60, 55, 10)).toBeCloseTo(0.5);
    expect(roundProgress(60, 60, 10)).toBe(1);
    expect(roundProgress(60, 70, 10)).toBe(1);
  });
});
