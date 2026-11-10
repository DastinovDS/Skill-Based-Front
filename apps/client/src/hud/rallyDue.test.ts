import { describe, expect, it } from 'vitest';
import { rallyDueSnapshot } from '../dev/groupScene.ts';
import { BUNDLED_MAPS } from '../map/bundledMaps.ts';
import type { MapFile, NodeView } from '../protocol.gen.ts';
import { cityDues, rallyDues } from './rallyDue.ts';

const artery = BUNDLED_MAPS.find((m) => m.meta.name === 'artery') as MapFile;

// The rally scene (#930): Stonegate (0) has 3 queued at 22 of 30 ticks, Ford (13) 1 at 6 of 30, both
// send their recruits to Watchhouse (12); the walk costs 50 (DEC-48, H3: `recruit.rally_cost`).
const UNIT = 30;
const COST = 50;
const nodes = rallyDueSnapshot(artery).view.nodes;

describe('rallyDues (#930, W10: every queued walker is earmarked, owner answer 1)', () => {
  it('lists every queued recruit of a city with a rally point, the nearest first', () => {
    const dues = rallyDues(nodes, 0, 1000, UNIT, COST);
    // The first unit leaves the tick after it is made (DEC-48, H3): 30 - 22 + 1 = 9 ticks; each next
    // one a full production later. Ford: 30 - 6 + 1 = 25.
    expect(dues.map((d) => [d.node, d.slot, d.ticks])).toEqual([
      [0, 0, 9],
      [13, 0, 25],
      [0, 1, 39],
      [0, 2, 69],
    ]);
  });

  it('fills the first of each city by its production, the others wait at 0', () => {
    const dues = rallyDues(nodes, 0, 1000, UNIT, COST);
    expect(dues.map((d) => [d.share, d.running])).toEqual([
      [22 / 30, true],
      [6 / 30, true],
      [0, false],
      [0, false],
    ]);
  });

  it('marks the walks the CP now do not pay with the nearer ones', () => {
    // 1.25 CP: 0.5 and 1.0 are paid, 1.5 and 2.0 are not.
    expect(rallyDues(nodes, 0, 125, UNIT, COST).map((d) => d.short)).toEqual([
      false,
      false,
      true,
      true,
    ]);
    // Exactly enough pays (`cp >= cost`, the server's test).
    expect(rallyDues(nodes, 0, 200, UNIT, COST).every((d) => !d.short)).toBe(true);
  });

  it('puts a recruit already made and still in its city first, made in full', () => {
    const dues = rallyDues(nodes, 0, 1000, UNIT, COST, [{ node: 13 }]);
    expect(dues[0]).toEqual({
      node: 13,
      slot: -1,
      ticks: 1,
      share: 1,
      running: true,
      short: false,
    });
    expect(dues).toHaveLength(5);
  });

  it('a unit ready and waiting for a place leaves next', () => {
    const waiting = nodes.map((n): NodeView => (n.id === 13 ? { ...n, recruit_waiting: true } : n));
    const ford = rallyDues(waiting, 0, 1000, UNIT, COST).find((d) => d.node === 13);
    expect(ford).toMatchObject({ ticks: 1, share: 1 });
  });

  it('has none without a rally point, without a price, or for the other player', () => {
    const none = nodes.map((n): NodeView => ({ ...n, rally_point: null }));
    expect(rallyDues(none, 0, 1000, UNIT, COST)).toEqual([]);
    expect(rallyDues(nodes, 0, 1000, UNIT, 0)).toEqual([]);
    expect(rallyDues(nodes, 1, 1000, UNIT, COST)).toEqual([]);
  });

  it('gives the walks of one city by slot', () => {
    const dues = rallyDues(nodes, 0, 125, UNIT, COST, [{ node: 0 }]);
    expect(cityDues(dues, 0).map((d) => [d.slot, d.short])).toEqual([
      [-1, false],
      [0, false],
      [1, true],
      [2, true],
    ]);
  });
});
