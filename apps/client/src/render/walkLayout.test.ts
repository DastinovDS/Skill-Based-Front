import { describe, expect, it } from 'vitest';
import type { EventMsg, MapFile } from '../protocol.gen.ts';
import { DURATION } from '../theme/tokens.ts';
import { PARRY } from './parryLayout.ts';
import {
  WALK,
  arrivalRoad,
  captureWalks,
  floodDelayMs,
  gatePoint,
  walkPoint,
  walkShare,
  walking,
} from './walkLayout.ts';

// Three nodes in a row: 0 — 1 — 2, and a side road 1 — 3.
const map = {
  nodes: [
    { id: 0, x: 0, y: 0 },
    { id: 1, x: 100, y: 0 },
    { id: 2, x: 200, y: 0 },
    { id: 3, x: 100, y: 100 },
  ],
  edges: [
    { id: 0, a: 0, b: 1 },
    { id: 1, a: 1, b: 2 },
    { id: 2, a: 1, b: 3 },
  ],
} as unknown as MapFile;

const event = (tick: number, kind: string, data: EventMsg['data']): EventMsg => ({
  type: 'event',
  tick,
  kind,
  data,
});
const at = { node: 1, edge: null, point: null };
const hit = event(400, 'fight_round', {
  ...at,
  shots_0: 1,
  shots_1: 0,
  virtual_0: 0,
  virtual_1: 0,
  losses_0: 0,
  losses_1: 1,
  burned_0: 0,
  burned_1: 0,
});
const end = (captured: boolean): EventMsg =>
  event(400, 'fight_ended', { ...at, attacker: 0, winner: 0, captured, losses_0: 0, losses_1: 1 });

describe('captureWalks: the winner of a captured node walks in (#856)', () => {
  it('makes a walk of every fight that ended with a capture, none of one that was held', () => {
    expect(captureWalks([hit, end(false)], map, 0, 20, 10)).toEqual([]);
    const [walk] = captureWalks([hit, end(true)], map, 0, 20, 10);
    expect(walk).toBeDefined();
    if (walk === undefined) return;
    expect(walk.node).toBe(1);
    expect(walk.owner).toBe(0);
    expect(walk.end).toBe(400);
    // It leaves when the last shot has landed (a hit: PARRY.hit of a round) and 0.1 s more.
    expect(walk.start).toBeCloseTo(400 + PARRY.hit * 20 + WALK.after * 10);
    expect(walk.ticks).toBeCloseTo((DURATION.captureWalk / 1000) * 10);
  });

  it('leaves 0.1 s after the end when the round is not among the events', () => {
    const [walk] = captureWalks([end(true)], map, 1, 20, 10);
    expect(walk?.start).toBeCloseTo(401);
  });

  it('waits at the gate, walks eased, and is in the middle at the end', () => {
    const [walk] = captureWalks([hit, end(true)], map, 0, 20, 10);
    if (walk === undefined) throw new Error('no walk');
    expect(walkShare(walk, walk.start - 1)).toBe(0);
    expect(walkShare(walk, walk.start + walk.ticks / 2)).toBeCloseTo(0.5);
    expect(walkShare(walk, walk.start + walk.ticks)).toBe(1);
    expect(walking(walk, 399)).toBe(false);
    expect(walking(walk, 402)).toBe(true);
    expect(walking(walk, walk.start + walk.ticks)).toBe(false);
  });

  it('starts the flood as the walker crosses the ring', () => {
    const [walk] = captureWalks([hit, end(true)], map, 0, 20, 10);
    if (walk === undefined) throw new Error('no walk');
    const leave = (walk.start - walk.end) * 100;
    expect(floodDelayMs(walk, 10)).toBeCloseTo(leave + WALK.cross * DURATION.captureWalk);
  });
});

describe('the gate of a node', () => {
  it('stands on the road just outside the ring, towards its other end', () => {
    expect(gatePoint(map, 1, 0, 20, 8)).toEqual({ x: 100 - (20 + 8 + WALK.gap), y: 0 });
    expect(gatePoint(map, 1, 2, 20, 8)).toEqual({ x: 100, y: 20 + 8 + WALK.gap });
    // A road that does not touch the node has no gate.
    expect(gatePoint(map, 0, 1, 20, 8)).toBeNull();
  });

  it('is the road the side was seen coming by, else the road to its own neighbour', () => {
    const owners = [0, 1, 1, 0] as const;
    expect(arrivalRoad(map, 1, 0, 1, owners)).toBe(1);
    // Never seen: the own neighbour with the lowest road id (node 0 by road 0).
    expect(arrivalRoad(map, 1, 0, undefined, owners)).toBe(0);
    // A remembered road that does not lead to the node is not used: the neighbour's road instead.
    expect(arrivalRoad(map, 2, 1, 0, owners)).toBe(1);
    // No road known and no neighbour of the side's: none.
    expect(arrivalRoad(map, 2, 0, undefined, owners)).toBeNull();
  });

  it('walks in a straight line from the gate to the middle', () => {
    expect(walkPoint({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.5)).toEqual({ x: 5, y: 10 });
  });
});
