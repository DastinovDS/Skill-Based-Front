import { describe, expect, it } from 'vitest';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { THREAT_MS, ThreatLog, incomingNodes, threatOfEvent } from './threats.ts';

const snapshot = devSnapshot(DEFAULT_MAP, DEV_RULES, 30);
const mine = snapshot.view.nodes.find((n) => n.owner === 0);
const theirs = snapshot.view.nodes.find((n) => n.owner === 1);
if (mine === undefined || theirs === undefined) throw new Error('the dev snapshot lacks nodes');
const owner = (node: number) => snapshot.view.nodes[node]?.owner;

describe('threatOfEvent', () => {
  it('an enemy capture of a city that was mine is a threat; the other captures are not', () => {
    expect(
      threatOfEvent({ kind: 'node_captured', data: { node: mine.id, player: 1 } }, 0, owner),
    ).toEqual({ node: mine.id, kind: 'captured' });
    expect(
      threatOfEvent({ kind: 'node_captured', data: { node: mine.id, player: 0 } }, 0, owner),
    ).toBeNull(); // my own capture
    expect(
      threatOfEvent({ kind: 'node_captured', data: { node: theirs.id, player: 1 } }, 0, owner),
    ).toBeNull(); // a city that was not mine
  });

  it('a fight in a city of mine is a threat, a fight on a road or elsewhere is not', () => {
    expect(threatOfEvent({ kind: 'fight', data: { node: mine.id } }, 0, owner)).toEqual({
      node: mine.id,
      kind: 'attack',
    });
    expect(threatOfEvent({ kind: 'fight', data: { node: theirs.id } }, 0, owner)).toBeNull();
    expect(threatOfEvent({ kind: 'fight', data: { edge: 2 } }, 0, owner)).toBeNull();
    expect(threatOfEvent({ kind: 'recruited', data: { node: mine.id } }, 0, owner)).toBeNull();
  });
});

describe('incomingNodes', () => {
  it('lists my cities that an enemy planned order aims at', () => {
    const intent = {
      id: 'i1',
      owner: 1 as const,
      kind: 'planned_move' as const,
      origin: theirs.id,
      target: mine.id,
      created_tick: 20,
    };
    const aimed = { ...snapshot, view: { ...snapshot.view, intents: [intent] } };
    expect(incomingNodes(aimed, 0)).toEqual([mine.id]);
    expect(incomingNodes(aimed, 1)).toEqual([]); // my own intents are no threat to me
  });
});

describe('ThreatLog', () => {
  it('keeps an event for THREAT_MS, and the incoming orders while they stand', () => {
    const clock = { now: 1000 };
    const log = new ThreatLog(0, () => clock.now);
    log.onEvent({ kind: 'node_captured', data: { node: mine.id, player: 1 } }, owner);
    expect(log.active()).toEqual([
      { threat: { node: mine.id, kind: 'captured' }, left: THREAT_MS },
    ]);
    clock.now += THREAT_MS - 1;
    expect(log.active()).toHaveLength(1);
    clock.now += 1;
    expect(log.active()).toEqual([]);
    const intent = {
      id: 'i1',
      owner: 1 as const,
      kind: 'planned_move' as const,
      origin: theirs.id,
      target: mine.id,
      created_tick: 20,
    };
    log.onSnapshot({ ...snapshot, view: { ...snapshot.view, intents: [intent] } });
    expect(log.active()).toEqual([{ threat: { node: mine.id, kind: 'incoming' }, left: null }]);
    log.onSnapshot(snapshot);
    expect(log.active()).toEqual([]);
  });
});
