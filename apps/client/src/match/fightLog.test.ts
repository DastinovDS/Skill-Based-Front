import { describe, expect, it } from 'vitest';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { EventMsg, FightView, SnapshotMsg } from '../protocol.gen.ts';
import { FightLog, MAX_ROUNDS, fightCards, isComplete, roundOfEvent } from './fightLog.ts';

type Pair = [number, number];

const round = (
  tick: number,
  r: { shots?: Pair; virtual?: Pair; spent?: Pair; losses?: Pair } = {},
  fight = 'f1',
): EventMsg => {
  const shots = r.shots ?? [1, 1];
  const virtual = r.virtual ?? [0, 0];
  const spent = r.spent ?? [1, 1];
  const losses = r.losses ?? [0, 0];
  return {
    type: 'event',
    tick,
    kind: 'fight_round',
    data: {
      fight,
      node: 1,
      edge: null,
      point: null,
      shots_0: shots[0],
      shots_1: shots[1],
      virtual_0: virtual[0],
      virtual_1: virtual[1],
      spent_0: spent[0],
      spent_1: spent[1],
      losses_0: losses[0],
      losses_1: losses[1],
    },
  };
};

const started = (tick: number, fight = 'f1'): EventMsg => ({
  type: 'event',
  tick,
  kind: 'fight_started',
  data: { fight, node: 1, edge: null, point: null, attacker: 1 },
});

function fight(over: Partial<FightView> = {}): FightView {
  return {
    id: 'f1',
    node: 1,
    edge: null,
    point: null,
    attacker: 1,
    start_tick: 100,
    next_round_tick: 130,
    groups: [],
    enemy_units: 2,
    enemy_charged: 1,
    shots: [0, 0],
    losses: [0, 0],
    last_round: null,
    ...over,
  };
}

function snapshot(tick: number, fights: FightView[]): SnapshotMsg {
  const base = devSnapshot(DEFAULT_MAP, DEV_RULES, tick);
  return { ...base, tick, view: { ...base.view, fights } };
}

describe('FightLog', () => {
  it('collects the rounds of the events, both sides, the virtual shots apart', () => {
    const log = new FightLog();
    log.onEvent(started(100));
    log.onEvent(round(110, { shots: [1, 1], virtual: [1, 0], spent: [0, 1] }));
    log.onEvent(round(120, { shots: [1, 0], losses: [0, 1] }));
    const [history] = log.histories();
    expect(history?.rounds).toEqual([
      { tick: 110, shots: [1, 1], virtual: [1, 0], spent: [0, 1], losses: [0, 0] },
      { tick: 120, shots: [1, 0], virtual: [0, 0], spent: [1, 1], losses: [0, 1] },
    ]);
  });

  it('does not count a round twice: once from its event, once as the last round of the view', () => {
    const log = new FightLog();
    log.onEvent(round(110));
    log.onSnapshot(
      snapshot(110, [
        fight({
          shots: [1, 1],
          last_round: {
            tick: 110,
            shots: [1, 1],
            virtual: [0, 0],
            spent: [1, 1],
            losses: [0, 0],
          },
        }),
      ]),
    );
    expect(log.histories()[0]?.rounds).toHaveLength(1);
  });

  it('after a reconnect the history starts at the last round of the view, and says it is cut', () => {
    const log = new FightLog();
    log.onEvent(round(110));
    log.clear();
    // The fight has had four rounds meanwhile; the view holds the totals and the last round.
    log.onSnapshot(
      snapshot(145, [
        fight({
          shots: [4, 4],
          losses: [1, 0],
          last_round: {
            tick: 140,
            shots: [1, 1],
            virtual: [0, 0],
            spent: [1, 1],
            losses: [1, 0],
          },
        }),
      ]),
    );
    const [history] = log.histories();
    expect(history?.rounds.map((r) => r.tick)).toEqual([140]);
    expect(history !== undefined && isComplete(history)).toBe(false);
    // The totals are the view's, not a sum of what the client holds.
    expect(history?.totals).toEqual({ shots: [4, 4], losses: [1, 0] });
  });

  it('is complete when the rounds held add up to the totals of the view', () => {
    const log = new FightLog();
    log.onEvent(round(110, { losses: [0, 1] }));
    log.onEvent(round(120, { losses: [1, 0] }));
    log.onSnapshot(snapshot(121, [fight({ shots: [2, 2], losses: [1, 1] })]));
    const [history] = log.histories();
    expect(history !== undefined && isComplete(history)).toBe(true);
  });

  it('forgets a fight the view no longer lists, but not one an event has just opened', () => {
    const log = new FightLog();
    log.onSnapshot(snapshot(110, [fight()]));
    expect(log.histories()).toHaveLength(1);
    log.onSnapshot(snapshot(120, []));
    expect(log.histories()).toHaveLength(0);
    // An event newer than the snapshot (the fight starts in the next tick) stays.
    log.onEvent(started(121, 'f2'));
    log.onSnapshot(snapshot(120, []));
    expect(log.histories().map((h) => h.id)).toEqual(['f2']);
  });

  it('ignores a round without every number (an old server) and other events', () => {
    const log = new FightLog();
    const old = round(110);
    delete old.data['shots_1'];
    expect(roundOfEvent(old)).toBeNull();
    log.onEvent(old);
    log.onEvent({ type: 'event', tick: 1, kind: 'node_captured', data: { node: 1, player: 0 } });
    expect(log.histories().flatMap((h) => h.rounds)).toEqual([]);
  });

  it('keeps at most MAX_ROUNDS rounds, the newest', () => {
    const log = new FightLog();
    for (let i = 1; i <= MAX_ROUNDS + 5; i += 1) log.onEvent(round(i * 10));
    const [history] = log.histories();
    expect(history?.rounds).toHaveLength(MAX_ROUNDS);
    expect(history?.rounds[0]?.tick).toBe(60);
  });
});

describe('fightCards', () => {
  const fed = (): FightLog => {
    const log = new FightLog();
    log.onEvent(round(110, { shots: [1, 1], virtual: [1, 0], spent: [0, 1], losses: [0, 0] }));
    log.onEvent(round(120, { shots: [0, 2], virtual: [0, 1], spent: [0, 1], losses: [1, 0] }));
    log.onSnapshot(snapshot(121, [fight({ shots: [1, 3], losses: [1, 0] })]));
    return log;
  };

  it('puts the player first and the newest round on top', () => {
    const [card] = fightCards(fed().histories(), 0);
    expect(card?.rows.map((r) => r.tick)).toEqual([120, 110]);
    expect(card?.rows[1]?.own).toEqual({ shots: 1, virtual: 1, spent: 0, losses: 0 });
    expect(card?.rows[0]?.enemy).toEqual({ shots: 2, virtual: 1, spent: 1, losses: 0 });
    expect(card?.totals).toEqual({
      own: { shots: 1, losses: 1 },
      enemy: { shots: 3, losses: 0 },
    });
    expect(card?.complete).toBe(true);
  });

  it('is the same fight turned around for player 1', () => {
    const [card] = fightCards(fed().histories(), 1);
    expect(card?.rows[0]?.own).toEqual({ shots: 2, virtual: 1, spent: 1, losses: 0 });
    expect(card?.rows[0]?.enemy).toEqual({ shots: 0, virtual: 0, spent: 0, losses: 1 });
    expect(card?.totals?.own).toEqual({ shots: 3, losses: 0 });
  });

  it('has no card for a fight no snapshot lists yet', () => {
    const log = new FightLog();
    log.onEvent(round(110));
    expect(fightCards(log.histories(), 0)).toEqual([]);
  });
});
