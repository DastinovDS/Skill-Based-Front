import { describe, expect, it } from 'vitest';
import type { EventMsg, MapFile } from '../protocol.gen.ts';
import {
  BAR,
  FIGHT_MARK_TICKS,
  MAX_PIPS,
  PIP_SPACING,
  arrowGeometry,
  countLabel,
  dashSegments,
  edgePoint,
  fightInfo,
  fightMarkAlpha,
  nodeSlots,
  pipLayout,
  roadPosition,
  sideways,
  warehouseBar,
} from './layout.ts';

const A = { x: 0, y: 0 };
const B = { x: 100, y: 0 };

describe('pipLayout', () => {
  it('draws one dot per unit, filled for charged ones, in one row up to 5', () => {
    const { pips, scaled } = pipLayout(3, 2);
    expect(scaled).toBe(false);
    expect(pips.map((p) => p.filled)).toEqual([true, true, false]);
    expect(pips.map((p) => p.x)).toEqual([-PIP_SPACING, 0, PIP_SPACING]);
    expect(new Set(pips.map((p) => p.y)).size).toBe(1);
  });

  it('starts a second row after 5 dots and centres each row', () => {
    const { pips } = pipLayout(7, 0);
    expect(pips).toHaveLength(7);
    const rows = [pips.slice(0, 5), pips.slice(5)];
    expect(rows[0]?.map((p) => p.x)).toEqual([-14, -7, 0, 7, 14]);
    expect(rows[1]?.map((p) => p.x)).toEqual([-3.5, 3.5]);
    expect(rows[1]?.[0]?.y).toBeGreaterThan(rows[0]?.[0]?.y ?? 0);
  });

  it('keeps the share of charged units for a group bigger than the dot limit', () => {
    const { pips, scaled } = pipLayout(20, 10);
    expect(scaled).toBe(true);
    expect(pips).toHaveLength(MAX_PIPS);
    expect(pips.filter((p) => p.filled)).toHaveLength(5);
  });

  it('never hides the only charged unit of a big group, never invents one', () => {
    expect(pipLayout(40, 1).pips.filter((p) => p.filled)).toHaveLength(1);
    expect(pipLayout(40, 0).pips.filter((p) => p.filled)).toHaveLength(0);
  });

  it('clamps charged to units and handles an empty group', () => {
    expect(pipLayout(2, 9).pips.filter((p) => p.filled)).toHaveLength(2);
    expect(pipLayout(0, 0).pips).toEqual([]);
  });

  it('writes the numbers as charged over units', () => {
    expect(countLabel(12, 5)).toBe('5/12');
  });
});

describe('nodeSlots', () => {
  it('centres a lone token under the city', () => {
    const [slot] = nodeSlots(1, 16);
    expect(slot?.x).toBe(0);
    expect(slot?.y).toBeGreaterThan(16);
  });

  it('puts two tokens side by side and the third in a new row', () => {
    const slots = nodeSlots(3, 16);
    expect(slots[0]?.x).toBeLessThan(0);
    expect(slots[1]?.x).toBeGreaterThan(0);
    expect(slots[0]?.y).toBe(slots[1]?.y);
    expect(slots[2]?.x).toBe(0);
    expect(slots[2]?.y).toBeGreaterThan(slots[0]?.y ?? 0);
  });

  it('gives no two tokens the same place', () => {
    const slots = nodeSlots(6, 21).map((s) => `${String(s.x)},${String(s.y)}`);
    expect(new Set(slots).size).toBe(6);
  });
});

describe('position on a road', () => {
  it('moves from the start end by thousandths of the edge', () => {
    expect(edgePoint(A, B, true, 250)).toEqual({ x: 25, y: 0 });
    expect(edgePoint(A, B, false, 250)).toEqual({ x: 75, y: 0 });
  });

  it('clamps progress to the edge', () => {
    expect(edgePoint(A, B, true, -50)).toEqual(A);
    expect(edgePoint(A, B, true, 5000)).toEqual(B);
  });

  it('sends opposite directions along opposite lanes', () => {
    const forward = roadPosition(A, B, true, 500, 10);
    const back = roadPosition(A, B, false, 500, 10);
    // Right of "to the right" is down on screen (y grows down); right of "to the left" is up.
    expect(forward).toEqual({ x: 50, y: 10 });
    expect(back).toEqual({ x: 50, y: -10 });
  });

  it('does not move a point on a zero-length road', () => {
    expect(sideways(A, A, A, 5)).toEqual(A);
  });
});

describe('warehouseBar', () => {
  it('is the share of the capacity', () => {
    expect(warehouseBar(2, 4).ratio).toBe(0.5);
    expect(warehouseBar(0, 4).ratio).toBe(0);
  });

  it('never leaves the bar, also for capacity 0', () => {
    expect(warehouseBar(9, 4).ratio).toBe(1);
    expect(warehouseBar(3, 0).ratio).toBe(0);
  });

  it('marks the capacity units on a bar of up to 10', () => {
    expect(warehouseBar(0, 4).marks).toEqual([BAR.width / 4, BAR.width / 2, (BAR.width * 3) / 4]);
    expect(warehouseBar(0, 1).marks).toEqual([]);
    expect(warehouseBar(0, 11).marks).toEqual([]);
  });
});

describe('arrows of intents', () => {
  it('starts and ends short of the cities and ends the shaft where the head starts', () => {
    const arrow = arrowGeometry(A, B, 20, 20, 10, 8);
    expect(arrow?.start).toEqual({ x: 20, y: 0 });
    expect(arrow?.end).toEqual({ x: 70, y: 0 });
    expect(arrow?.head[0]).toEqual({ x: 80, y: 0 });
    // The two back corners are a head width apart, on both sides of the shaft.
    expect(arrow?.head[1]).toEqual({ x: 70, y: 4 });
    expect(arrow?.head[2]).toEqual({ x: 70, y: -4 });
  });

  it('draws nothing between cities too close for an arrow', () => {
    expect(arrowGeometry(A, { x: 40, y: 0 }, 20, 20, 10, 8)).toBeNull();
  });

  it('cuts a line into dashes, the last one shortened', () => {
    const dashes = dashSegments(A, { x: 25, y: 0 }, 10, 5);
    expect(dashes.map(([a, b]) => [a.x, b.x])).toEqual([
      [0, 10],
      [15, 25],
    ]);
    expect(dashSegments(A, A, 10, 5)).toEqual([]);
  });
});

describe('fight marks', () => {
  const map = {
    nodes: [
      { id: 0, x: 10, y: 20 },
      { id: 1, x: 110, y: 20 },
    ],
    edges: [{ id: 0, a: 0, b: 1 }],
  } as unknown as MapFile;

  function fightEvent(data: EventMsg['data']): EventMsg {
    return { type: 'event', tick: 50, kind: 'fight', data };
  }

  it('puts a fight in a city at the city and reads both sides losses', () => {
    const info = fightInfo(fightEvent({ node: 1, edge: null, losses_0: 2, losses_1: 3 }), map);
    expect(info?.at).toEqual({ x: 110, y: 20 });
    expect(info?.losses).toEqual([2, 3]);
  });

  it('puts a fight on a road in the middle of the road', () => {
    const info = fightInfo(fightEvent({ node: null, edge: 0, losses_0: 0, losses_1: 1 }), map);
    expect(info?.at).toEqual({ x: 60, y: 20 });
  });

  it('ignores other events, unknown places and events without losses', () => {
    expect(fightInfo({ type: 'event', tick: 1, kind: 'node_captured', data: {} }, map)).toBeNull();
    expect(
      fightInfo(fightEvent({ node: 9, edge: null, losses_0: 1, losses_1: 1 }), map),
    ).toBeNull();
    expect(fightInfo(fightEvent({ node: 0, edge: null }), map)).toBeNull();
  });

  it('shows for a while, then fades out, and not before the event', () => {
    expect(fightMarkAlpha(50, 49)).toBeNull();
    expect(fightMarkAlpha(50, 50)).toBe(1);
    expect(fightMarkAlpha(50, 50 + FIGHT_MARK_TICKS * 0.7)).toBe(1);
    const fading = fightMarkAlpha(50, 50 + FIGHT_MARK_TICKS * 0.85);
    expect(fading).toBeGreaterThan(0);
    expect(fading).toBeLessThan(1);
    expect(fightMarkAlpha(50, 50 + FIGHT_MARK_TICKS)).toBeNull();
  });
});
