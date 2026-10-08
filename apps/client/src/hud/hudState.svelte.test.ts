import { flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { SnapshotMsg } from '../protocol.gen.ts';
import { DEV_RULES, devEvent, devSnapshot } from './devFeed.ts';
import { EVENT_LIMIT, HudState } from './hudState.svelte.ts';

const map = DEFAULT_MAP;

function newState(): HudState {
  return new HudState({ me: 0, nicks: ['Danya', 'Bot'], rules: DEV_RULES, map });
}

function snapshot(tick: number): SnapshotMsg {
  return devSnapshot(map, DEV_RULES, tick);
}

describe('HudState', () => {
  it('is empty until the first snapshot and after a reset', () => {
    const hud = newState();
    expect(hud.current).toBeNull();
    hud.onSnapshot(snapshot(5));
    expect(hud.current?.tick).toBe(5);
    hud.reset();
    expect(hud.current).toBeNull();
  });

  it('replaces `current` once per snapshot and not otherwise', () => {
    const hud = newState();
    const seen: unknown[] = [];
    const stop = $effect.root(() => {
      $effect(() => {
        seen.push(hud.current);
      });
    });
    flushSync();
    const before = seen.length;
    for (let tick = 1; tick <= 10; tick += 1) {
      hud.onSnapshot(snapshot(tick));
      flushSync();
    }
    // One recomputation per snapshot; reading the same object again never recomputes.
    expect(seen.length - before).toBe(10);
    const current = hud.current;
    flushSync();
    expect(hud.current).toBe(current);
    expect(seen.length - before).toBe(10);
    stop();
  });

  it('holds events back until the next snapshot', () => {
    const hud = newState();
    hud.onSnapshot(snapshot(1));
    const event = devEvent(map, 30);
    if (event === null) throw new Error('no event at tick 30');
    hud.onEvent(event);
    expect(hud.current?.events).toEqual([]);
    hud.onSnapshot(snapshot(2));
    expect(hud.current?.events.map((e) => e.kind)).toEqual([event.kind]);
  });

  it('keeps bookkeeping kinds out of the feed so they do not push the news out (#184)', () => {
    const hud = newState();
    hud.onEvent({ type: 'event', tick: 1, kind: 'charges_produced', data: { node: 0 } });
    hud.onEvent({ type: 'event', tick: 2, kind: 'attrition', data: { node: 0, player: 0 } });
    hud.onSnapshot(snapshot(3));
    expect(hud.current?.events.map((e) => e.kind)).toEqual(['attrition']);
  });

  it('keeps the newest events first and drops the oldest over the limit', () => {
    const hud = newState();
    for (let i = 0; i < EVENT_LIMIT + 5; i += 1) {
      hud.onEvent({ type: 'event', tick: i, kind: 'fight', data: { node: 0 } });
    }
    hud.onSnapshot(snapshot(1));
    const events = hud.current?.events ?? [];
    expect(events).toHaveLength(EVENT_LIMIT);
    expect(events[0]?.tick).toBe(EVENT_LIMIT + 4);
  });

  it('recomputes on a selection change, from the last snapshot', () => {
    const hud = newState();
    hud.onSnapshot(snapshot(1));
    const first = hud.current?.groups[0];
    if (first === undefined) throw new Error('the dev snapshot has no group');
    hud.select({ kind: 'group', id: first.id });
    expect(hud.current?.group?.id).toBe(first.id);
    hud.select(null);
    expect(hud.current?.group).toBeNull();
  });
});
