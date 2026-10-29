import { describe, expect, it } from 'vitest';
import { expectDeclared, filledData, tracked } from '../net/eventFields.fixture.ts';
import type { EventMsg, FightView, MapFile } from '../protocol.gen.ts';
import type { RenderGroup } from '../net/interpolate.ts';
import {
  ARENA_GAP_EDGE,
  ARENA_GAP_NODE,
  ARENA_REACH,
  CAPTION_RISE,
  CHIP,
  PLATE,
  arenaCenter,
  arenaSides,
  changedChips,
  chipAt,
  chipHatch,
  chipHeight,
  chipPulse,
  chipsOf,
  exchangeAlpha,
  exchangeOf,
  fightFx,
  fightPlace,
  fightResult,
  lighten,
  roundEffect,
  roundProgress,
  type EndFx,
  type SideCount,
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
  it('knows the city of a fight in a city and the radius of its ring', () => {
    const place = fightPlace(map, 1, null, null, radius);
    expect(place?.at).toEqual({ x: 110, y: 120 });
    expect(place?.ring).toBe(ringRadius(14));
  });

  it('puts a fight on a road at its meeting point (DEC-24, C3): no ring', () => {
    // point = 1134: the mark at 1134 / 2000 of the road from `a`.
    const place = fightPlace(map, null, 0, 1134, radius);
    expect(place?.at.x).toBeCloseTo(66.7);
    expect(place?.ring).toBe(0);
  });

  it('is unknown for an unknown place', () => {
    expect(fightPlace(map, 9, null, null, radius)).toBeUndefined();
    expect(fightPlace(map, null, null, null, radius)).toBeUndefined();
  });

  it('floats the arena above the ring by a gap fixed in screen px, whatever the zoom', () => {
    const place = fightPlace(map, 1, null, null, radius);
    if (place === undefined) throw new Error('no place');
    expect(arenaCenter(place, 1)).toEqual({ x: 110, y: 120 - ringRadius(14) - ARENA_GAP_NODE });
    // At 60% the gap is 1 / 0.6 world units: the same number of px on screen.
    const small = arenaCenter(place, 0.6);
    expect((120 - ringRadius(14) - small.y) * 0.6).toBeCloseTo(ARENA_GAP_NODE);
    const road = fightPlace(map, null, 0, 1134, radius);
    if (road === undefined) throw new Error('no place');
    expect(arenaCenter(road, 1).y).toBe(120 - ARENA_GAP_EDGE);
    expect(ARENA_GAP_EDGE).toBeGreaterThan(ARENA_GAP_NODE);
  });

  it('leaves room for the ring of the city under the plate, and for the caption of a bonus shot over it', () => {
    expect(ARENA_GAP_NODE).toBeGreaterThan(PLATE.halfHeight + ARENA_REACH);
    // The caption (19 high) sits over the plate within the reach the arena makes room for.
    expect(CAPTION_RISE + 9.5).toBeLessThanOrEqual(ARENA_REACH);
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
    expect(fx).toMatchObject({
      kind: 'round',
      tick: 50,
      losses: [0, 1],
      shots: [1, 2],
      virtual: [0, 1],
    });
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

  it('gives a side that did not shoot nothing, and a fight without a round none at all', () => {
    expect(exchangeOf(round([0, 2], [0, 0]), 0).own).toBeNull();
    expect(exchangeOf(round([0, 2], [0, 0]), 0).enemy).toEqual({ real: 2, virtual: 0 });
    expect(exchangeOf(round([0, 0], [0, 0]), 0)).toEqual({ own: null, enemy: null });
    expect(exchangeOf(null, 0)).toEqual({ own: null, enemy: null });
  });

  it('never counts more virtual shots than shots', () => {
    expect(exchangeOf(round([1, 0], [4, 0]), 0).own).toEqual({ real: 0, virtual: 1 });
  });

  it('keeps the caption of a bonus shot until the next round is due, fades it if none comes', () => {
    for (const ticks of [10, 20]) {
      expect(exchangeAlpha(-1, ticks)).toBe(0);
      expect(exchangeAlpha(0, ticks)).toBe(1);
      expect(exchangeAlpha(ticks * 1.1, ticks)).toBe(1);
      expect(exchangeAlpha(ticks * 1.6, ticks)).toBeCloseTo(0.5);
      expect(exchangeAlpha(ticks * 2, ticks)).toBe(0);
    }
  });

  it('measures every duration in rounds: a round of 20 ticks lasts twice as long as one of 10', () => {
    expect(roundEffect(4, 0.8, 10)).toBeCloseTo(0.5);
    expect(roundEffect(4, 0.8, 20)).toBeCloseTo(0.25);
    expect(roundEffect(8, 0.8, 10)).toBeNull();
    expect(roundEffect(-1, 0.8, 20)).toBeNull();
    expect(roundEffect(16, 0.8, 20)).toBeNull();
  });
});

describe('chips of an arena', () => {
  const side = (units: number, charged: number, losses = 0, mute = 0): SideCount => ({
    units,
    charged,
    losses,
    bonus: 0,
    mute,
  });

  it('draws a chip per unit that was in the fight: charged, then discharged, then dead', () => {
    expect(chipsOf(side(4, 2, 1)).shown).toEqual([
      'charged',
      'charged',
      'empty',
      'empty',
      'killed',
    ]);
    expect(chipsOf(side(0, 0)).shown).toEqual([]);
    // A charged count above the units is the whole side.
    expect(chipsOf(side(2, 9)).shown).toEqual(['charged', 'charged']);
  });

  it('shows eight chips at most and the rest as a "+N" with the exact number', () => {
    const eight = chipsOf(side(8, 3));
    expect(eight.shown).toHaveLength(8);
    expect(eight.hidden).toBe(0);
    const eleven = chipsOf(side(11, 9));
    expect(eleven.shown).toHaveLength(CHIP.max);
    expect(eleven.hidden).toBe(3);
    // The dead count too: ten units and three dead are thirteen chips.
    expect(chipsOf(side(10, 0, 3)).hidden).toBe(5);
  });

  it('tells how many of the hidden chips are charged, so they do not read as discharged', () => {
    expect(chipsOf(side(11, 9)).hiddenCharged).toBe(1);
    expect(chipsOf(side(11, 11)).hiddenCharged).toBe(3);
    expect(chipsOf(side(11, 4)).hiddenCharged).toBe(0);
  });

  it('marks the silent charges as the last charged chips, never more than the charged ones', () => {
    expect(chipsOf(side(4, 3, 0, 1)).silent).toEqual([2]);
    expect(chipsOf(side(4, 3, 0, 2)).silent).toEqual([1, 2]);
    expect(chipsOf(side(4, 1, 0, 5)).silent).toEqual([0]);
    expect(chipsOf(side(4, 0, 0, 1)).silent).toEqual([]);
    // A silent charge among the hidden chips is not drawn.
    expect(chipsOf(side(10, 10, 0, 1)).silent).toEqual([]);
  });

  it('points at the chips that changed in the last round: out of charge, and dead', () => {
    // 4 units, 1 charged now, 1 dead; the round spent a charge and killed a unit.
    expect(changedChips(side(4, 1, 1), { spent: 1, losses: 1 })).toEqual([1, 4]);
    expect(changedChips(side(4, 1, 1), { spent: 0, losses: 0 })).toEqual([]);
    expect(changedChips(side(4, 1, 1), null)).toEqual([]);
    // The charges that went out cannot be more than the units.
    expect(changedChips(side(2, 0, 0), { spent: 5, losses: 0 })).toEqual([0, 1]);
  });

  it('lays the chips out in two rows of four columns, a single row when four fit', () => {
    const own = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => chipAt(i, 8, true));
    expect(own.every((p) => p.x < 0)).toBe(true);
    // Column-major: the pairs share a column, the next pair is a pitch further from the middle.
    expect(own[0]?.x).toBe(own[1]?.x);
    expect(own[1]?.y).toBeGreaterThan(own[0]?.y ?? 0);
    expect(Math.abs(own[2]?.x ?? 0) - Math.abs(own[0]?.x ?? 0)).toBe(CHIP.pitch);
    const enemy = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => chipAt(i, 8, false));
    expect(enemy.every((p, i) => p.x === -(own[i]?.x ?? 0))).toBe(true);
    // One row of up to four: all at the same height, in the middle of the two rows.
    const row = [0, 1, 2, 3].map((i) => chipAt(i, 4, true));
    expect(new Set(row.map((p) => p.y)).size).toBe(1);
    expect(row[0]?.y).toBeGreaterThan(own[0]?.y ?? 0);
    expect(row[0]?.y).toBeLessThan(own[1]?.y ?? 0);
    // Everything stays on the plate.
    for (const p of [...own, ...enemy]) {
      expect(Math.abs(p.x) + CHIP.side / 2).toBeLessThan(PLATE.halfWidth);
      expect(Math.abs(p.y) + chipHeight(CHIP.side) / 2).toBeLessThan(PLATE.halfHeight);
    }
  });

  it('hatches a chip with lines inside the triangle, narrowing towards the tip', () => {
    const lines = chipHatch(CHIP.side, 3.5);
    expect(lines.length).toBeGreaterThan(2);
    const widths = lines.map(([a, b]) => b.x - a.x);
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeLessThan(widths[i - 1] ?? Infinity);
    }
    for (const [a, b] of lines) {
      expect(a.y).toBe(b.y);
      expect(Math.abs(a.y)).toBeLessThanOrEqual(chipHeight(CHIP.side) / 2);
      expect(b.x).toBeLessThanOrEqual(CHIP.side / 2);
    }
  });

  it('pulses once over a share of the round, and not with reduced motion', () => {
    expect(chipPulse(0, 20, false)).toBe(1);
    const mid = chipPulse(4.5, 20, false);
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThanOrEqual(1.2);
    expect(chipPulse(9, 20, false)).toBe(1);
    expect(chipPulse(-1, 20, false)).toBe(1);
    expect(chipPulse(4.5, 20, true)).toBe(1);
    // The same swell lasts half as long in a round of 10 ticks.
    expect(chipPulse(4.5, 10, false)).toBe(1);
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
      own: { units: 3, charged: 2, losses: 0, bonus: 0, mute: 0 },
      enemy: { units: 3, charged: 2, losses: 0, bonus: 0, mute: 0 },
    });
  });

  it('adds the groups of the opponent when the frame shows both sides', () => {
    const both = { ...fight, enemy_units: 0, enemy_charged: 0 };
    expect(arenaSides(both, [group('a', 2, 0, 1), group('b', 4, 1, 3)], 0)).toEqual({
      own: { units: 2, charged: 1, losses: 0, bonus: 0, mute: 0 },
      enemy: { units: 4, charged: 3, losses: 0, bonus: 0, mute: 0 },
    });
  });

  it('takes losses, the bonus stock and the silent charges from the view, by player', () => {
    const rich: FightView = { ...fight, losses: [2, 1], virtual_left: [3, 0], mute: [0, 1] };
    const sides = arenaSides(rich, [group('a', 2, undefined, 2)], 0);
    expect(sides.own).toMatchObject({ losses: 2, bonus: 3, mute: 0 });
    expect(sides.enemy).toMatchObject({ losses: 1, bonus: 0, mute: 1 });
    // Seen from the other player the numbers swap sides: the view's pairs are by player id.
    const swapped = arenaSides(rich, [], 1);
    expect(swapped.own).toMatchObject({ losses: 1, bonus: 0, mute: 1 });
    expect(swapped.enemy).toMatchObject({ losses: 2, bonus: 3, mute: 0 });
  });

  it('the bar fills towards the next round', () => {
    expect(roundProgress(60, 50, 10)).toBe(0);
    expect(roundProgress(60, 55, 10)).toBeCloseTo(0.5);
    expect(roundProgress(60, 60, 10)).toBe(1);
    expect(roundProgress(60, 70, 10)).toBe(1);
  });
});

describe('the fields fightFx reads (ARC-02)', () => {
  it.each(['fight_round', 'fight_ended'])('%s: only fields the server sends', (kind) => {
    const place = { node: 0, edge: null, point: null };
    for (const winner of [0, 1, null]) {
      const overrides = kind === 'fight_ended' ? { ...place, winner } : place;
      const { data, reads } = tracked(kind, filledData(kind, overrides));
      const fx = fightFx({ type: 'event', tick: 10, kind, data }, map, radius);
      expect(fx, kind).not.toBeNull();
      expectDeclared(kind, reads);
    }
  });
});
