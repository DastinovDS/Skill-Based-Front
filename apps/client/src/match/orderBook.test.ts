import { describe, expect, it } from 'vitest';
import type { AckMsg, Command } from '../protocol.gen.ts';
import { GHOST_REJECT_MS } from '../render/style.ts';
import { OrderBook, type CommandResult } from './orderBook.ts';

const move = (group: string, dest: number, planned = false): Command => ({
  type: 'move',
  group,
  dest,
  planned,
});

const ack = (seq: number, extra: Partial<AckMsg> = {}): AckMsg => ({
  type: 'ack',
  seq,
  applied_tick: 10,
  path: null,
  arrive_tick: null,
  reject_code: null,
  ...extra,
});

function setup() {
  const clock = { now: 1000 };
  const book = new OrderBook(() => clock.now);
  const results: CommandResult[] = [];
  book.onResult = (r) => results.push(r);
  return { book, results, clock };
}

describe('OrderBook', () => {
  it('shows a move at once as a ghost straight to the destination', () => {
    const { book } = setup();
    book.track(1, move('g', 5, true), 2);
    expect(book.ghosts()).toEqual([
      {
        seq: 1,
        group: 'g',
        from: 2,
        dest: 5,
        planned: true,
        path: null,
        status: 'pending',
        rejectedAt: null,
      },
    ]);
  });

  it('draws the path of the ack and keeps the ghost until that tick is on screen', () => {
    const { book, results } = setup();
    book.track(1, move('g', 5), 2);
    book.onAck(ack(1, { applied_tick: 12, path: [2, 3, 5] }));
    expect(book.ghosts()[0]?.path).toEqual([2, 3, 5]);
    // The ack makes the ghost solid.
    expect(book.ghosts()[0]?.status).toBe('accepted');
    expect(results).toEqual([{ kind: 'accepted', seq: 1, arriveTick: null, cmd: move('g', 5) }]);

    book.onRendered(11);
    expect(book.ghosts()).toHaveLength(1);
    book.onRendered(12);
    expect(book.ghosts()).toEqual([]);
  });

  it('keeps a rejected ghost for the shake and the fade, then removes it, and reports the code', () => {
    const { book, results, clock } = setup();
    book.track(1, move('g', 5), 2);
    book.onAck(ack(1, { reject_code: 'NOT_ENOUGH_CP' }));
    expect(book.ghosts().map((g) => [g.status, g.rejectedAt])).toEqual([['rejected', 1000]]);
    clock.now += GHOST_REJECT_MS - 1;
    expect(book.ghosts()).toHaveLength(1);
    clock.now += 1;
    expect(book.ghosts()).toEqual([]);
    expect(results).toEqual([
      { kind: 'rejected', seq: 1, cmd: move('g', 5), code: 'NOT_ENOUGH_CP' },
    ]);
  });

  it('keeps one ghost per group: a newer order replaces the older', () => {
    const { book } = setup();
    book.track(1, move('g', 5), 2);
    book.track(2, move('g', 7), 2);
    book.track(3, move('h', 4), 1);
    expect(book.ghosts().map((g) => g.dest)).toEqual([7, 4]);
    // The older one being rejected later must not remove the newer ghost.
    book.onAck(ack(1, { reject_code: 'GROUP_BUSY' }));
    expect(book.ghosts().map((g) => g.dest)).toEqual([7, 4]);
    expect(book.ghosts().map((g) => g.status)).toEqual(['pending', 'pending']);
  });

  it('gives commands without a ghost a result too, and ignores unknown acks', () => {
    const { book, results } = setup();
    book.track(1, { type: 'forfeit' });
    book.track(2, move('g', 5), null);
    expect(book.ghosts()).toEqual([]);
    book.onAck(ack(1, { reject_code: 'NO_CHANGE' }));
    book.onAck(ack(99));
    expect(results.map((r) => r.kind)).toEqual(['rejected']);
  });

  it('drops the ghost of a command whose ack was lost in a reconnect', () => {
    const { book, results } = setup();
    book.track(1, move('g', 5), 2);
    book.onAckLost(1);
    expect(book.ghosts()).toEqual([]);
    expect(results[0]?.kind).toBe('lost');
  });

  it('keeps the same array while nothing changes', () => {
    const { book } = setup();
    book.track(1, move('g', 5), 2);
    const before = book.ghosts();
    book.onRendered(100);
    book.onAck(ack(9));
    expect(book.ghosts()).toBe(before);
  });
});
