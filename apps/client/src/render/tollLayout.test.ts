import { describe, expect, it } from 'vitest';
import type { EventMsg } from '../protocol.gen.ts';
import {
  HIT_AT_MS,
  HIT_MS,
  STRIKE,
  STRIKE_MS,
  TOLL_HIT,
  TOLL_MS,
  hitCuts,
  hitPhase,
  strikeLines,
  tollInfo,
  tollMs,
  tollNumber,
  tollPop,
  tollSeed,
  victimOf,
} from './tollLayout.ts';

const event = (kind: string, data: EventMsg['data'], tick = 100): EventMsg => ({
  type: 'event',
  tick,
  kind,
  data,
});

describe('tollInfo: a toll event as an effect', () => {
  it('reads what an own group paid: the group, the line and the charges', () => {
    const info = tollInfo(
      event('toll_paid', { player: 0, group: 'abc', node: 4, edge: 7, charges: 2 }),
    );
    expect(info).toEqual({ tick: 100, node: 4, edge: 7, charges: 2, group: 'abc', paid: true });
  });

  it('reads what an own line took: no group, the enemy figure is found on the road', () => {
    const info = tollInfo(event('toll_taken', { player: 0, node: 4, edge: 7, charges: 1 }));
    expect(info).toEqual({ tick: 100, node: 4, edge: 7, charges: 1, group: null, paid: false });
  });

  it('is nothing for another kind, a toll that took nothing, or a malformed one', () => {
    expect(tollInfo(event('fight_ended', { node: 1 }))).toBeNull();
    expect(tollInfo(event('toll_taken', { node: 4, edge: 7, charges: 0 }))).toBeNull();
    expect(tollInfo(event('toll_taken', { node: 4, edge: 7 }))).toBeNull();
    expect(tollInfo(event('toll_paid', { node: '4', edge: 7, charges: 1 }))).toBeNull();
  });

  it('knows who lost: the viewer when it paid, the opponent when the own line took', () => {
    const paid = tollInfo(event('toll_paid', { group: 'g', node: 1, edge: 1, charges: 1 }));
    const taken = tollInfo(event('toll_taken', { node: 1, edge: 1, charges: 1 }));
    if (paid === null || taken === null) throw new Error('no info');
    expect(victimOf(paid, 0)).toBe(0);
    expect(victimOf(paid, 1)).toBe(1);
    expect(victimOf(taken, 0)).toBe(1);
    expect(victimOf(taken, 1)).toBe(0);
  });

  it('seeds a different hit for tolls on different roads', () => {
    const a = tollInfo(event('toll_taken', { node: 1, edge: 1, charges: 1 }));
    const b = tollInfo(event('toll_taken', { node: 1, edge: 2, charges: 1 }));
    if (a === null || b === null) throw new Error('no info');
    expect(tollSeed(a)).not.toBe(tollSeed(b));
  });
});

describe('tollMs: the age of a toll', () => {
  it('is the time since the event, nothing before it or from the end of the effect on', () => {
    expect(tollMs(-1, 10)).toBeNull();
    expect(tollMs(0, 10)).toBe(0);
    expect(tollMs(3, 10)).toBe(300);
    expect(tollMs(10, 10)).toBe(1000);
    expect(tollMs(11, 10)).toBeNull();
    expect(tollMs(1, 0)).toBeNull();
  });
  it('is over within 1.1 s of the event, as the mockup says: the strike, then the hit', () => {
    expect(TOLL_MS).toBe(1100);
    expect(STRIKE_MS).toBeLessThan(TOLL_MS);
    expect(HIT_AT_MS).toBe(STRIKE_MS);
    expect(HIT_AT_MS + HIT_MS).toBeLessThanOrEqual(TOLL_MS);
  });
});

describe('strikeLines: three hairlines from the gate to the group', () => {
  const from = { x: 0, y: 0 };
  const to = { x: 100, y: 0 };

  it('runs from the gate towards the group and has arrived when the hit lands', () => {
    const early = strikeLines(from, to, 30);
    const late = strikeLines(from, to, STRIKE_MS - 10);
    expect(early).toHaveLength(3);
    const head = (lines: ReturnType<typeof strikeLines>): number => lines?.[1]?.[1]?.x ?? 0;
    expect(head(early)).toBeGreaterThan(0);
    expect(head(late)).toBeGreaterThan(head(early));
    expect(head(late)).toBeLessThanOrEqual(100);
    expect(strikeLines(from, to, STRIKE_MS)).toBeNull();
    expect(strikeLines(from, to, -1)).toBeNull();
  });

  it('spreads the three apart at the gate, the core in the middle, and meets at the head', () => {
    const lines = strikeLines(from, to, 100, 2);
    expect(lines?.map((l) => l[0]?.y)).toEqual([-STRIKE.spread * 2, 0, STRIKE.spread * 2]);
    const heads = lines?.map((l) => l[1]);
    expect(heads?.[0]).toEqual(heads?.[2]);
  });

  it('draws nothing when the gate and the group are one point', () => {
    expect(strikeLines(from, from, 50)).toBeNull();
  });
});

describe('hitPhase and hitCuts: the engraved hit', () => {
  it('lasts from the landing of the strike for its time', () => {
    expect(hitPhase(HIT_AT_MS - 1)).toBeNull();
    expect(hitPhase(HIT_AT_MS + HIT_MS / 2)).toBeCloseTo(0.5);
    expect(hitPhase(HIT_AT_MS + HIT_MS)).toBeNull();
  });

  it('throws seven cuts out, every other one in ink, further as it goes', () => {
    const at = { x: 50, y: 50 };
    const early = hitCuts(at, 0.1, 1, 7);
    const late = hitCuts(at, 0.9, 1, 7);
    expect(early.cuts).toHaveLength(TOLL_HIT.cuts);
    expect(early.cuts.filter((c) => c.ink)).toHaveLength(Math.ceil(TOLL_HIT.cuts / 2));
    const reach = (h: typeof early): number =>
      Math.max(...h.cuts.map((c) => Math.hypot(c.to.x - at.x, c.to.y - at.y)));
    expect(reach(late)).toBeGreaterThan(reach(early));
    expect(late.ring).toBeGreaterThan(early.ring);
  });

  it('is the same for the same age and seed: a paused scene shows the same frame', () => {
    const at = { x: 0, y: 0 };
    expect(hitCuts(at, 0.4, 1, 3)).toEqual(hitCuts(at, 0.4, 1, 3));
    expect(hitCuts(at, 0.4, 1, 3)).not.toEqual(hitCuts(at, 0.4, 1, 4));
  });
});

describe('tollPop and tollNumber', () => {
  it('swells the token for a moment at the hit and is 1 outside it', () => {
    expect(tollPop(0)).toBe(1);
    expect(tollPop(HIT_AT_MS + 130)).toBeGreaterThan(1.2);
    expect(tollPop(HIT_AT_MS + 400)).toBe(1);
  });

  it('shows "-N" from the hit: it rises a little and fades in the last quarter', () => {
    expect(tollNumber(0, false, 6)).toBeNull();
    const early = tollNumber(HIT_AT_MS + 10, false, 6);
    const mid = tollNumber(HIT_AT_MS + 300, false, 6);
    const end = tollNumber(TOLL_MS - 5, false, 6);
    expect(early?.alpha).toBe(1);
    expect(mid?.lift ?? 0).toBeGreaterThan(early?.lift ?? 0);
    expect(mid?.lift ?? 0).toBeLessThanOrEqual(6);
    expect(end?.alpha ?? 1).toBeLessThan(0.1);
  });

  it('with less motion the number stands still from the first frame', () => {
    expect(tollNumber(0, true, 12)).toEqual({ alpha: 1, lift: 0 });
    expect(tollNumber(HIT_AT_MS + 300, true, 12)?.lift).toBe(0);
  });
});
