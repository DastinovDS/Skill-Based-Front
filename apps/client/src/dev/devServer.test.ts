import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_RULES } from '../hud/devFeed.ts';
import { HudState } from '../hud/hudState.svelte.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { CommandResult } from '../match/orderBook.ts';
import { createDevMatch } from './devMatch.ts';
import { DEV_ACK_MS, devPath } from './devServer.ts';

const map = DEFAULT_MAP;

describe('devPath', () => {
  it('is the node itself for a zero-length trip and a chain of roads otherwise', () => {
    const edge = map.edges[0];
    if (edge === undefined) throw new Error('the default map has no roads');
    expect(devPath(map, edge.a, edge.a)).toEqual([edge.a]);
    expect(devPath(map, edge.a, edge.b)?.at(0)).toBe(edge.a);
    expect(devPath(map, edge.a, edge.b)?.at(-1)).toBe(edge.b);
    expect(devPath(map, edge.a, 9999)).toBeNull();
  });
});

describe('dev match', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the real connection against the dev server: snapshots, acks, rejects', () => {
    const hud = new HudState({ me: 0, rules: DEV_RULES, map });
    const match = createDevMatch(map, DEV_RULES, hud);
    const results: CommandResult[] = [];
    match.session.orders.onResult = (r) => results.push(r);
    match.start();
    vi.advanceTimersByTime(10_000);
    expect(match.session.status).toBe('ready');
    expect(hud.current?.tick).toBeGreaterThan(0);

    const home = match.session.frame()?.base.view.groups[0];
    if (home?.location.kind !== 'node') throw new Error('no group to order');
    const here = home.location.node;
    const far = map.nodes.find((n) => n.id !== here)?.id ?? 0;
    const move = (planned: boolean) =>
      ({ type: 'move', group: home.id, dest: far, planned }) as const;

    const seq = match.session.send(move(false));
    match.session.orders.track(seq, move(false), here);
    expect(match.session.orders.ghosts()).toHaveLength(1);
    vi.advanceTimersByTime(DEV_ACK_MS + 1);
    expect(results.at(-1)?.kind).toBe('accepted');

    // The accepted order stands in the next snapshots.
    vi.advanceTimersByTime(500);
    expect(match.session.frame()?.base.view.groups.find((g) => g.id === home.id)?.order?.dest).toBe(
      far,
    );

    // A cancel without a planned order is refused by the server, with its code.
    const cancel = { type: 'cancel_order', group: home.id } as const;
    match.session.orders.track(match.session.send(cancel), cancel);
    vi.advanceTimersByTime(DEV_ACK_MS + 1);
    expect(results.at(-1)).toMatchObject({ kind: 'rejected', code: 'NOTHING_TO_CANCEL' });
    match.stop();
  });

  it('refuses a move with NOT_ENOUGH_CP while CP is still zero', () => {
    const hud = new HudState({ me: 0, rules: DEV_RULES, map });
    const match = createDevMatch(map, DEV_RULES, hud);
    const results: CommandResult[] = [];
    match.session.orders.onResult = (r) => results.push(r);
    match.start();
    vi.advanceTimersByTime(1);
    const home = match.session.frame()?.base.view.groups[0];
    if (home?.location.kind !== 'node') throw new Error('no group to order');
    const cmd = { type: 'move', group: home.id, dest: home.location.node, planned: false } as const;
    match.session.orders.track(match.session.send(cmd), cmd, home.location.node);
    vi.advanceTimersByTime(DEV_ACK_MS + 1);
    expect(results.at(-1)).toMatchObject({ kind: 'rejected', code: 'NOT_ENOUGH_CP' });
    expect(match.session.orders.ghosts()).toEqual([]);
    match.stop();
  });
});
