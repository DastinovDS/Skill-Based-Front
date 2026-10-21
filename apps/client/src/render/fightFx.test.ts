import { describe, expect, it } from 'vitest';
import type { EventMsg, FightView, MapFile } from '../protocol.gen.ts';
import type { RenderGroup } from '../net/interpolate.ts';
import {
  ARENA_GAP_EDGE,
  ARENA_GAP_NODE,
  ARENA_REACH,
  EXCHANGE_GROW_TICKS,
  arenaSides,
  chargeLine,
  exchangeArrow,
  exchangeLook,
  exchangeOf,
  fightFx,
  fightPlace,
  fightResult,
  halfSlice,
  hatchLines,
  lighten,
  roundProgress,
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
  it('reads a round: where and the losses of both sides', () => {
    const fx = fightFx(
      event('fight_round', {
        node: 1,
        edge: null,
        shots_0: 1,
        shots_1: 2,
        virtual_1: 1,
        losses_0: 0,
        losses_1: 1,
      }),
      map,
      radius,
    );
    expect(fx).toMatchObject({ kind: 'round', tick: 50, losses: [0, 1] });
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

describe('exchange of the last round', () => {
  const round = (shots: [number, number], virtual: [number, number]) => ({
    tick: 40,
    shots,
    virtual,
    spent: [0, 0] as [number, number],
    losses: [0, 0] as [number, number],
  });

  it('splits the shots of each side into real and virtual ones, the virtual among them', () => {
    expect(exchangeOf(round([3, 2], [1, 2]), 0)).toEqual({
      own: { real: 2, virtual: 1 },
      enemy: { real: 0, virtual: 2 },
    });
  });

  it('is read for the viewing player: the other side when the viewer is player 1', () => {
    expect(exchangeOf(round([3, 2], [1, 0]), 1)).toEqual({
      own: { real: 2, virtual: 0 },
      enemy: { real: 2, virtual: 1 },
    });
  });

  it('gives a side that did not shoot no arrow, and a fight without a round none at all', () => {
    expect(exchangeOf(round([0, 2], [0, 0]), 0).own).toBeNull();
    expect(exchangeOf(round([0, 2], [0, 0]), 0).enemy).toEqual({ real: 2, virtual: 0 });
    expect(exchangeOf(round([0, 0], [0, 0]), 0)).toEqual({ own: null, enemy: null });
    expect(exchangeOf(null, 0)).toEqual({ own: null, enemy: null });
  });

  it('never counts more virtual shots than shots', () => {
    expect(exchangeOf(round([1, 0], [4, 0]), 0).own).toEqual({ real: 0, virtual: 1 });
  });

  it('grows over a few ticks, holds until the next round, fades if none comes', () => {
    expect(exchangeLook(0, 10, false)).toEqual({ grow: 0, alpha: 1 });
    expect(exchangeLook(EXCHANGE_GROW_TICKS / 2, 10, false).grow).toBeCloseTo(0.5);
    expect(exchangeLook(EXCHANGE_GROW_TICKS, 10, false).grow).toBe(1);
    expect(exchangeLook(9.9, 10, false).alpha).toBe(1);
    expect(exchangeLook(16, 10, false).alpha).toBeCloseTo(0.5);
    expect(exchangeLook(20, 10, false).alpha).toBe(0);
  });

  it('with less motion is whole from the first tick', () => {
    expect(exchangeLook(0, 10, true).grow).toBe(1);
  });
});

describe('exchange arrows', () => {
  const R = 24;

  it('the own arrow rises from the own half over the top into the enemy half', () => {
    const arrow = exchangeArrow(true, R, 1);
    const first = arrow.line[0];
    const last = arrow.line[arrow.line.length - 1];
    expect(first?.x).toBeLessThan(0);
    expect(last?.x).toBeGreaterThan(0);
    // The arc clears the circle at the top: its label sits above the arena.
    expect(arrow.label.y).toBeLessThan(-R);
    expect(Math.min(...arrow.line.map((p) => p.y))).toBeLessThan(-R);
  });

  it('the enemy arrow falls from its half under the bottom into the own one', () => {
    const arrow = exchangeArrow(false, R, 1);
    expect(arrow.line[0]?.x).toBeGreaterThan(0);
    expect(arrow.line[arrow.line.length - 1]?.x).toBeLessThan(0);
    expect(arrow.label.y).toBeGreaterThan(R);
    // The two arrows are point reflections of each other: they never overlap.
    const own = exchangeArrow(true, R, 1);
    expect(arrow.label.x).toBeCloseTo(-own.label.x);
    expect(arrow.label.y).toBeCloseTo(-own.label.y);
  });

  it('stays within the reach the arena makes room for', () => {
    for (const own of [true, false]) {
      for (const p of exchangeArrow(own, R, 1).line) {
        expect(Math.abs(p.y)).toBeLessThanOrEqual(ARENA_REACH);
      }
      // The label is a pill 14 high: its far edge is within the reach too.
      expect(Math.abs(exchangeArrow(own, R, 1).label.y) + 7).toBeLessThanOrEqual(ARENA_REACH);
    }
    expect(ARENA_GAP_NODE).toBeGreaterThan(ARENA_REACH);
    expect(ARENA_GAP_EDGE).toBeGreaterThan(ARENA_REACH);
  });

  it('grows from the shooter: a part of the curve, the head only once it is long enough', () => {
    const full = exchangeArrow(true, R, 1);
    const half = exchangeArrow(true, R, 0.5);
    expect(half.line.length).toBeLessThan(full.line.length);
    expect(half.line[0]).toEqual(full.line[0]);
    expect(exchangeArrow(true, R, 0.1).head).toBeNull();
    expect(half.head).not.toBeNull();
    // The head points where the curve goes: its tip is the front of the line.
    expect(half.head?.[0]).toEqual(half.line[half.line.length - 1]);
  });
});

describe('halves of the arena', () => {
  const R = 24;
  const count = (units: number, charged: number) => ({ units, charged });

  it('puts the line between the charged (below) and the discharged (above) by their share', () => {
    expect(chargeLine(count(4, 0), R)).toBe(R);
    expect(chargeLine(count(4, 4), R)).toBe(-R);
    expect(chargeLine(count(4, 2), R)).toBe(0);
    expect(chargeLine(count(4, 1), R)).toBe(R / 2);
    // A side with no unit has nothing to cut; a charged count above the units is the whole half.
    expect(chargeLine(count(0, 0), R)).toBe(-R);
    expect(chargeLine(count(2, 9), R)).toBe(-R);
  });

  it('cuts a slice of the half-disc inside it, on the side of the half', () => {
    const own = halfSlice(R, true, -R, R);
    const enemy = halfSlice(R, false, -R, R);
    expect(own.every((p) => p.x <= 1e-9)).toBe(true);
    expect(enemy.every((p) => p.x >= -1e-9)).toBe(true);
    for (const p of [...own, ...enemy]) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(R + 1e-9);
    const slice = halfSlice(R, true, 0, R);
    expect(Math.min(...slice.map((p) => p.y))).toBeCloseTo(0);
    expect(Math.max(...slice.map((p) => p.y))).toBeCloseTo(R);
  });

  it('is empty when the slice has no height, whichever way it is given', () => {
    expect(halfSlice(R, true, 5, 5)).toEqual([]);
    expect(halfSlice(R, true, R, R)).toEqual([]);
    expect(halfSlice(R, true, 5, -5)).toEqual(halfSlice(R, true, -5, 5));
  });

  it('hatches only the discharged part: lines on a fixed grid between the top and the line', () => {
    const lines = hatchLines(R, true, -R, 0, 4);
    expect(lines.length).toBeGreaterThan(0);
    for (const [from, to] of lines) {
      expect(from.y).toBe(to.y);
      expect(from.y).toBeLessThan(0);
      expect(to.x).toBeLessThanOrEqual(0);
    }
    // Nothing to hatch with no discharged unit; the whole half when all are discharged.
    expect(hatchLines(R, true, -R, -R, 4)).toEqual([]);
    expect(hatchLines(R, false, -R, R, 4).length).toBeGreaterThan(lines.length);
    // The grid does not slide when the line moves: a shared line has the same place.
    const shorter = hatchLines(R, true, -R, -8, 4);
    expect(shorter.every(([a]) => lines.some(([b]) => b.y === a.y))).toBe(true);
  });

  it('lightens a colour towards white without touching white or changing the order of tones', () => {
    expect(lighten(0x000000, 0.5)).toBe(0x808080);
    expect(lighten(0xffffff, 0.7)).toBe(0xffffff);
    expect(lighten(0x5b9bff, 0)).toBe(0x5b9bff);
    const lighter = lighten(0x5b9bff, 0.6);
    expect((lighter >> 16) & 0xff).toBeGreaterThan(0x5b);
    expect(lighter & 0xff).toBe(0xff);
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
    virtual_left: [0, 0],
    mute: [0, 0],
    last_round: null,
  };
  const group = (id: string, units: number, owner?: 0 | 1, charged = 0): RenderGroup => ({
    group: {
      id,
      units,
      charged,
      mode: 'attack',
      location: { kind: 'node', node: 1 },
      order: null,
      defense_bonus: null,
      defense_cap: null,
    },
    location: { kind: 'node', node: 1 },
    ...(owner === undefined ? {} : { owner }),
  });

  it('counts the units and the charged ones: the own groups of the fight, the exact enemy total', () => {
    expect(
      arenaSides(
        fight,
        [group('a', 2, undefined, 2), group('b', 1, undefined, 0), group('x', 9)],
        0,
      ),
    ).toEqual({
      own: { units: 3, charged: 2 },
      enemy: { units: 3, charged: 2 },
    });
  });

  it('adds the groups of the opponent when the frame shows both sides', () => {
    const both = { ...fight, enemy_units: 0, enemy_charged: 0 };
    expect(arenaSides(both, [group('a', 2, 0, 1), group('b', 4, 1, 3)], 0)).toEqual({
      own: { units: 2, charged: 1 },
      enemy: { units: 4, charged: 3 },
    });
  });

  it('the arc fills towards the next round', () => {
    expect(roundProgress(60, 50, 10)).toBe(0);
    expect(roundProgress(60, 55, 10)).toBeCloseTo(0.5);
    expect(roundProgress(60, 60, 10)).toBe(1);
    expect(roundProgress(60, 70, 10)).toBe(1);
  });
});
