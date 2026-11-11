import { describe, expect, it } from 'vitest';
import type { EventMsg } from '../protocol.gen.ts';
import { PaymentLog, payShow, paymentOf, paymentSpan, type Payment } from './buildPay.ts';
import { BUILD_PAY } from './style.ts';

const HZ = 10;
const { run, ...pay } = BUILD_PAY;

function paid(tick: number, data: EventMsg['data']): EventMsg {
  return { type: 'event', tick, kind: 'build_paid', data };
}

const payment = (p: Partial<Payment>): Payment => ({
  tick: 100,
  node: 4,
  kind: 'factory',
  warehouse: 1,
  units: 0,
  owed: 3,
  ...p,
});

/** The render tick `ms` after tick 100. */
const at = (ms: number): number => 100 + (ms * HZ) / 1000;

describe('paymentOf: the build_paid events of an own build', () => {
  it('reads the charges taken and what is still owed', () => {
    const event = paid(7, {
      player: 0,
      node: 4,
      kind: 'barracks',
      warehouse: 2,
      units: 1,
      owed: 0,
    });
    expect(paymentOf(event, 0)).toEqual({
      tick: 7,
      node: 4,
      kind: 'barracks',
      warehouse: 2,
      units: 1,
      owed: 0,
    });
  });

  it('skips the other player, a bunker or warehouse build, an empty payment and other events', () => {
    const base = { player: 0, node: 4, kind: 'factory', warehouse: 1, units: 0, owed: 3 };
    expect(paymentOf(paid(7, { ...base, player: 1 }), 0)).toBeNull();
    expect(paymentOf(paid(7, { ...base, kind: 'fort' }), 0)).toBeNull();
    expect(paymentOf(paid(7, { ...base, kind: 'warehouse' }), 0)).toBeNull();
    expect(paymentOf(paid(7, { ...base, warehouse: 0 }), 0)).toBeNull();
    expect(paymentOf({ ...paid(7, base), kind: 'build_started' }, 0)).toBeNull();
  });
});

describe('payShow: the flights, the pops and the run into the icon', () => {
  it('flies one charge per payment and keeps its lozenge owed until it lands', () => {
    // A factory of 4: one paid before, this one takes the second (index 1).
    const p = payment({ owed: 2 });
    const mid = payShow([p], 4, at(pay.flightMs / 2), 100, HZ);
    expect(mid.flights).toHaveLength(1);
    expect(mid.flights[0]).toMatchObject({ from: 'warehouse', j: 1, k: 0 });
    expect(mid.flights[0]?.q).toBeCloseTo(0.5, 5);
    expect(mid.hidden).toBe(1);
    const landed = payShow([p], 4, at(pay.flightMs + pay.popMs / 2), 100, HZ);
    expect(landed.flights).toHaveLength(0);
    expect(landed.hidden).toBe(0);
    expect(landed.pops.get(1)).toBeCloseTo(1 + pay.pop, 5);
  });

  it('takes the warehouse first, then the group, one charge after another', () => {
    const p = payment({ warehouse: 2, units: 1, owed: 1 });
    const show = payShow([p], 4, at(pay.staggerMs * 2), 100, HZ);
    expect(show.flights.map((f) => [f.from, f.j, f.behind])).toEqual([
      ['warehouse', 0, 1],
      ['warehouse', 1, 0],
      ['group', 2, 0],
    ]);
    expect(show.hidden).toBe(3);
  });

  it('runs the lozenges into the icon after the last one of the full payment lands', () => {
    const p = payment({ warehouse: 1, units: 1, owed: 0 });
    const landed = pay.flightMs + pay.staggerMs;
    expect(payShow([p], 4, at(landed - 1), 100, HZ).run).toBeNull();
    const into = payShow([p], 4, at(landed + run.ms / 2), 100, HZ);
    expect(into.hidden).toBe(0);
    expect(into.run).toHaveLength(4);
    const q = into.run ?? [];
    // Staggered: the first lozenge leads.
    expect(q[0]).toBeGreaterThan(q[3] ?? 1);
    expect(payShow([p], 4, at(paymentSpan(p, 4) + 1), 100, HZ).run).toBeNull();
  });

  it('does not move a payment the snapshot drawn does not hold yet, nor before or after its time', () => {
    const p = payment({});
    expect(payShow([p], 4, at(100), 99, HZ).flights).toHaveLength(0);
    expect(payShow([p], 4, at(100), 99, HZ).hidden).toBe(0);
    expect(payShow([p], 4, 99, 100, HZ).hidden).toBe(0);
    const late = payShow([p], 4, at(10_000), 100, HZ);
    expect(late.flights).toHaveLength(0);
    expect(late.pops.size).toBe(0);
  });
});

describe('PaymentLog', () => {
  it('reads the tail of a growing list and gives the recent payments newest first', () => {
    const log = new PaymentLog(0);
    const events: EventMsg[] = [
      paid(10, { player: 0, node: 1, kind: 'barracks', warehouse: 1, units: 0, owed: 2 }),
    ];
    log.read(events);
    events.push(
      paid(50, { player: 0, node: 1, kind: 'barracks', warehouse: 1, units: 0, owed: 1 }),
      paid(52, { player: 0, node: 1, kind: 'barracks', warehouse: 1, units: 0, owed: 0 }),
    );
    log.read(events);
    expect(log.recent(53, HZ, 1000).map((p) => p.tick)).toEqual([52, 50]);
    // A payment after the render tick is not given yet.
    expect(log.recent(51, HZ, 1000).map((p) => p.tick)).toEqual([50]);
    // A new list (a replay restarted) is read anew.
    log.read([events[0] as EventMsg]);
    expect(log.recent(11, HZ, 1000).map((p) => p.tick)).toEqual([10]);
  });
});
