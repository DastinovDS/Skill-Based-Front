import { describe, expect, it } from 'vitest';
import type { EventMsg } from '../protocol.gen.ts';
import { capacityRing } from './cityLayout.ts';
import { RECRUIT_SPAN_MS, RecruitLog, dropShape, recruitShow, ringCell } from './recruitDrop.ts';
import { FOUNDATION, RING_ENGRAVED } from './style.ts';

const ev = (tick: number, kind: string, data: EventMsg['data']): EventMsg => ({
  type: 'event',
  tick,
  kind,
  data,
});

describe('RecruitLog: the units made, from the events', () => {
  it('gives the recruits still moving at the render tick, newest first, and only those the snapshot shows', () => {
    const log = new RecruitLog();
    const events = [
      ev(100, 'recruited', { player: 0, node: 3, group: 'a' }),
      ev(104, 'recruited', { player: 0, node: 5, group: 'b' }),
      ev(104, 'build_paid', { player: 0, node: 5 }),
    ];
    log.read(events);
    expect(log.recent(105, 105, 10).map((r) => r.node)).toEqual([5, 3]);
    // A recruit newer than the snapshot drawn is not in the picture yet.
    expect(log.recent(105, 103, 10).map((r) => r.node)).toEqual([3]);
    // Past its span it is over.
    const later = 100 + (RECRUIT_SPAN_MS / 1000) * 10 + 1;
    expect(log.recent(later, later, 10).map((r) => r.node)).toEqual([5]);
  });

  it('marks a recruit that walks to the rally point by its paid walk', () => {
    const log = new RecruitLog();
    log.read([
      ev(100, 'recruited', { player: 0, node: 3, group: 'a' }),
      ev(100, 'rally_walk_paid', { player: 0, node: 3, group: 'a', target: 1, cost: 50 }),
      ev(101, 'recruited', { player: 0, node: 4, group: 'c' }),
    ]);
    const shown = log.recent(101, 101, 10);
    expect(shown.find((r) => r.node === 3)?.walks).toBe(true);
    expect(shown.find((r) => r.node === 4)?.walks).toBe(false);
  });

  it('reads only the tail of a list that grew, all of a new one', () => {
    const log = new RecruitLog();
    const events = [ev(100, 'recruited', { player: 0, node: 3, group: 'a' })];
    log.read(events);
    events.push(ev(101, 'recruited', { player: 0, node: 4, group: 'b' }));
    log.read(events);
    expect(log.recent(101, 101, 10)).toHaveLength(2);
    log.read([ev(101, 'recruited', { player: 0, node: 4, group: 'b' })]);
    expect(log.recent(101, 101, 10)).toHaveLength(1);
  });
});

describe('recruitShow: the motion of a unit made', () => {
  it('drops, then flashes the cell, while the queue slides one socket on', () => {
    const start = recruitShow(0, false);
    expect(start.drop).toBe(0);
    expect(start.slide).toBe(1);
    expect(start.flash).toBeNull();
    const landed = recruitShow(FOUNDATION.drop.ms + 10, false);
    expect(landed.drop).toBeNull();
    expect(landed.flash).toBeGreaterThan(0);
    expect(landed.slide).toBe(0);
    const over = recruitShow(FOUNDATION.drop.ms + FOUNDATION.drop.flashMs, false);
    expect(over.drop).toBeNull();
    expect(over.flash).toBeNull();
  });

  it('a walker leaves its socket and never drops into the ring', () => {
    const walk = recruitShow(50, true);
    expect(walk.drop).toBeNull();
    expect(walk.flash).toBeNull();
    expect(walk.leave).toBeGreaterThan(0);
    expect(recruitShow(FOUNDATION.drop.walkMs, true).leave).toBe(0);
  });
});

describe('dropShape: from the socket into the ring', () => {
  const socket = { x: -40, y: -10, width: 4.1, height: 4.1 };
  const cell = ringCell(4, 1);

  it('starts at the socket as long as it, ends on the ring as long as the cell, a unit of the ring wide', () => {
    const start = dropShape(0, socket, 21, cell, 1);
    expect(start.r).toBeCloseTo(Math.hypot(socket.x, socket.y), 9);
    expect((start.to - start.from) * start.r).toBeCloseTo(socket.width, 9);
    expect(start.alpha).toBe(0);
    const end = dropShape(1, socket, 21, cell, 1);
    expect(end.r).toBeCloseTo(21, 9);
    const turn = (end.from + end.to) / 2 - (cell.from + cell.to) / 2;
    expect(Math.cos(turn)).toBeCloseTo(1, 9);
    expect(end.to - end.from).toBeCloseTo(cell.to - cell.from, 9);
    expect(end.width).toBeCloseTo(RING_ENGRAVED.filled + 0.6, 9);
    expect(end.lift).toBe(0);
  });

  it('goes round the short way', () => {
    // From the left of the city to a cell at the upper left: it turns clockwise, not all round.
    const mid = dropShape(0.6, socket, 21, ringCell(4, 3), 1);
    expect(Math.abs((mid.from + mid.to) / 2)).toBeLessThan(Math.PI * 1.5);
  });
});

describe('ringCell', () => {
  it('is the cell of the capacity ring, solid rings split evenly', () => {
    const ring = capacityRing(4, 0);
    expect(ringCell(4, 2)).toEqual({ from: ring.arcs[2]?.from, to: ring.arcs[2]?.to });
    const solid = ringCell(20, 5);
    expect(solid.to - solid.from).toBeCloseTo((2 * Math.PI) / 20, 9);
    // Past the ring: its last cell.
    expect(ringCell(4, 9)).toEqual(ringCell(4, 3));
  });
});
