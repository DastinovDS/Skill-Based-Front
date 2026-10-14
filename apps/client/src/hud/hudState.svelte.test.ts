import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { SnapshotMsg } from '../protocol.gen.ts';
import { DEV_RULES, devEvent, devSnapshot } from './devFeed.ts';
import { EVENT_LIMIT, HudState, LAST_MINUTE_S, START_MS } from './hudState.svelte.ts';

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

describe('HudState: start banner, hover, toasts and the last minute', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens the start banner for three seconds on the first snapshot of a fresh match', () => {
    const hud = newState();
    expect(hud.banner).toBe(false);
    expect(hud.beacon).toBeNull();
    hud.onSnapshot(snapshot(2));
    expect(hud.banner).toBe(true);
    // The capital of the own side is ringed meanwhile (the map reads it every frame).
    expect(hud.beacon).toBe(map.nodes.find((n) => n.capital_of === 0)?.id);
    vi.advanceTimersByTime(START_MS - 1);
    expect(hud.banner).toBe(true);
    vi.advanceTimersByTime(1);
    expect(hud.banner).toBe(false);
    expect(hud.beacon).toBeNull();
  });

  it('does not open it again for later snapshots, nor on a rejoin in the middle of a match', () => {
    const hud = newState();
    hud.onSnapshot(snapshot(2));
    vi.advanceTimersByTime(START_MS);
    hud.onSnapshot(snapshot(3));
    expect(hud.banner).toBe(false);
    const rejoined = newState();
    rejoined.onSnapshot(snapshot(900));
    expect(rejoined.banner).toBe(false);
  });

  it('keeps the nicks of both sides for the top bar', () => {
    const hud = newState();
    hud.onSnapshot(snapshot(2));
    expect(hud.current?.nicks).toEqual({ mine: 'Danya', enemy: 'Bot' });
    const second = new HudState({ me: 1, nicks: ['Danya', 'Bot'], rules: DEV_RULES, map });
    second.onSnapshot(snapshot(2));
    expect(second.current?.nicks).toEqual({ mine: 'Bot', enemy: 'Danya' });
  });

  it('publishes the group under the pointer once per change', () => {
    const hud = newState();
    hud.onSnapshot(snapshot(2));
    expect(hud.current?.hovered).toBeNull();
    const id = hud.current?.groups[0]?.id;
    if (id === undefined) throw new Error('no group');
    hud.hoverGroup(id);
    const withTip = hud.current;
    expect(withTip?.hovered?.id).toBe(id);
    hud.hoverGroup(id);
    expect(hud.current).toBe(withTip); // the same group: no new object
    hud.hoverGroup(null);
    expect(hud.current?.hovered).toBeNull();
  });

  it('turns fights, captures and attrition into toasts, and VP awards into nothing', () => {
    const hud = newState();
    hud.onSnapshot(snapshot(2));
    hud.onEvent({ type: 'event', tick: 5, kind: 'vp_awarded', data: { player: 0, vp: 1 } });
    hud.onEvent({ type: 'event', tick: 6, kind: 'recruited', data: { node: 0, player: 0 } });
    expect(hud.toasts.current).toEqual([]);
    hud.onEvent({ type: 'event', tick: 7, kind: 'node_captured', data: { node: 1, player: 1 } });
    hud.onEvent({ type: 'event', tick: 8, kind: 'attrition', data: { node: 0, player: 0 } });
    expect(hud.toasts.current.map((t) => t.tone)).toEqual(['warn', 'enemy']);
    hud.onSnapshot(snapshot(3));
    // The journal keeps what the toasts leave out, but not the VP awards.
    expect(hud.current?.events.map((e) => e.kind)).toEqual([
      'attrition',
      'node_captured',
      'recruited',
    ]);
  });

  it('adds one toast when the last minute starts', () => {
    const hud = newState();
    const last = (seconds: number): SnapshotMsg =>
      snapshot(DEV_RULES.match_ticks - seconds * DEV_RULES.tick_hz);
    hud.onSnapshot(last(LAST_MINUTE_S + 5));
    expect(hud.toasts.current).toEqual([]);
    hud.onSnapshot(last(LAST_MINUTE_S));
    hud.onSnapshot(last(LAST_MINUTE_S - 10));
    expect(hud.toasts.current).toHaveLength(1);
    expect(hud.toasts.current[0]?.tone).toBe('warn');
  });

  it('drops the toasts and the timers on a reset and on destroy', () => {
    const hud = newState();
    hud.onSnapshot(snapshot(2));
    hud.onEvent({ type: 'event', tick: 8, kind: 'attrition', data: { node: 0, player: 0 } });
    hud.reset();
    expect(hud.toasts.current).toEqual([]);
    hud.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});
