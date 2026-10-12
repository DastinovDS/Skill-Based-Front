import { describe, expect, it } from 'vitest';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { IntentView, SnapshotMsg } from '../protocol.gen.ts';
import { AlertState } from './alerts.svelte.ts';
import { incomingAlerts } from './incoming.ts';

const map = DEFAULT_MAP;
const DELAY = DEV_RULES.orders.planned_delay_ticks;
const base = devSnapshot(map, DEV_RULES, 100);
const mine = base.view.nodes.filter((n) => n.owner === 0).map((n) => n.id);
const theirs = base.view.nodes.filter((n) => n.owner === 1).map((n) => n.id);
const [home, other] = mine;
const [far] = theirs;
if (home === undefined || other === undefined || far === undefined) throw new Error('small map');

function withIntents(intents: IntentView[], tick = 100): SnapshotMsg {
  return { ...base, tick, view: { ...base.view, intents } };
}
const intent = (id: string, over: Partial<IntentView>): IntentView => ({
  id,
  owner: 1,
  kind: 'planned_move',
  origin: far,
  target: home,
  created_tick: 100,
  ...over,
});

describe('incomingAlerts', () => {
  it('lists enemy planned moves aimed at my city, with the ticks until they leave', () => {
    const snap = withIntents([intent('a', { created_tick: 90 })], 100);
    expect(incomingAlerts(snap, 0, DELAY)).toEqual([
      { kind: 'incoming', node: home, count: 1, ticksLeft: DELAY - 10 },
    ]);
  });

  it('counts several intents on one city and takes the soonest', () => {
    const snap = withIntents([
      intent('a', { created_tick: 95 }),
      intent('b', { created_tick: 100 }),
    ]);
    expect(incomingAlerts(snap, 0, DELAY)).toEqual([
      { kind: 'incoming', node: home, count: 2, ticksLeft: DELAY - 5 },
    ]);
  });

  it('has no countdown once every order has left', () => {
    const snap = withIntents([intent('a', { created_tick: 10 })]);
    expect(incomingAlerts(snap, 0, DELAY)[0]).toMatchObject({ count: 1, ticksLeft: null });
  });

  it('ignores my own intents, the enemy aiming at his own city, and modes without a target', () => {
    const snap = withIntents([
      intent('own', { owner: 0, origin: home, target: other }),
      intent('theirs', { origin: far, target: far }),
      intent('defense', { kind: 'defense', target: null }),
      intent('neutral-aim', { target: far }),
    ]);
    expect(incomingAlerts(snap, 0, DELAY)).toEqual([]);
  });

  it('serves the other player the same way', () => {
    const snap = withIntents([intent('a', { owner: 0, origin: home, target: far })]);
    expect(incomingAlerts(snap, 1, DELAY)).toHaveLength(1);
    expect(incomingAlerts(snap, 0, DELAY)).toEqual([]);
  });

  it('puts the soonest first, ties by city id', () => {
    const snap = withIntents([
      intent('a', { target: other, created_tick: 100 }),
      intent('b', { target: home, created_tick: 100 }),
      intent('c', { target: other, created_tick: 99 }),
    ]);
    expect(incomingAlerts(snap, 0, DELAY).map((a) => a.node)).toEqual([other, home]);
  });
});

describe('AlertState', () => {
  it('follows the snapshots and cycles through the alerts on Space', () => {
    const state = new AlertState(0, DEV_RULES);
    expect(state.nextNode()).toBeNull();
    state.onSnapshot(
      withIntents([
        intent('a', { target: other, created_tick: 99 }),
        intent('b', { target: home }),
      ]),
    );
    expect(state.nextNode()).toBe(other);
    expect(state.nextNode()).toBe(home);
    expect(state.nextNode()).toBe(other);
    state.onSnapshot(withIntents([]));
    expect(state.current).toEqual([]);
    expect(state.nextNode()).toBeNull();
  });
});
