import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { SnapshotMsg } from '../protocol.gen.ts';
import { DEV_RULES, DEV_RULES_STANCES, devSnapshot } from './devFeed.ts';
import { HudState, LAST_MINUTE_S, START_MS } from './hudState.svelte.ts';
import { TOAST_HOLD_MS } from './toastState.svelte.ts';

const map = DEFAULT_MAP;

function newState(): HudState {
  return new HudState({ me: 0, nicks: ['Ember', 'Bot'], rules: DEV_RULES, map });
}

function snapshot(tick: number): SnapshotMsg {
  return devSnapshot(map, DEV_RULES, tick);
}

/** A capture the group could not pay for (DEC-38): a warning toast. */
const CAPTURE_FAILED = { node: 0, player: 0, group: 'g', result: 'bounce' };
describe('HudState', () => {
  it('is empty until the first snapshot and after a reset', () => {
    const hud = newState();
    expect(hud.current).toBeNull();
    hud.onSnapshot(snapshot(5));
    expect(hud.current?.tick).toBe(5);
    hud.reset();
    expect(hud.current).toBeNull();
  });

  it('holds the last picture across a reset for the top bar, until the next snapshot (#1069)', () => {
    const hud = newState();
    expect(hud.held).toBeNull();
    hud.onSnapshot(snapshot(5));
    const last = hud.current;
    hud.reset();
    expect(hud.current).toBeNull();
    expect(hud.held).toBe(last);
    // A second reset before a snapshot keeps the picture too.
    hud.reset();
    expect(hud.held).toBe(last);
    hud.onSnapshot(snapshot(9));
    expect(hud.held).toBeNull();
    expect(hud.current?.tick).toBe(9);
  });

  it('gives the result screen the nicks of our side (#596)', () => {
    const hud = newState();
    expect(hud.summary()).toEqual({ nicks: { mine: 'Ember', enemy: 'Bot' } });
    hud.onSnapshot(snapshot(5));
    expect(hud.summary()).toEqual({ nicks: { mine: 'Ember', enemy: 'Bot' } });
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
    expect(hud.current?.nicks).toEqual({ mine: 'Ember', enemy: 'Bot' });
    const second = new HudState({ me: 1, nicks: ['Ember', 'Bot'], rules: DEV_RULES, map });
    second.onSnapshot(snapshot(2));
    expect(second.current?.nicks).toEqual({ mine: 'Bot', enemy: 'Ember' });
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

  it('turns an enemy capture and an unpaid capture into toasts, the rest into nothing (#765)', () => {
    const hud = newState();
    hud.onSnapshot(snapshot(2));
    hud.onEvent({ type: 'event', tick: 5, kind: 'vp_awarded', data: { player: 0, vp: 1 } });
    hud.onEvent({ type: 'event', tick: 6, kind: 'recruited', data: { node: 0, player: 0 } });
    hud.onEvent({ type: 'event', tick: 6, kind: 'attrition', data: { node: 0, player: 0 } });
    hud.onEvent({ type: 'event', tick: 6, kind: 'node_captured', data: { node: 2, player: 0 } });
    hud.onEvent({ type: 'event', tick: 6, kind: 'fight_ended', data: { node: 2 } });
    hud.onRender(6);
    expect(hud.toasts.current).toEqual([]);
    hud.onEvent({ type: 'event', tick: 7, kind: 'node_captured', data: { node: 1, player: 1 } });
    hud.onEvent({ type: 'event', tick: 8, kind: 'capture_failed', data: CAPTURE_FAILED });
    hud.onRender(8);
    expect(hud.toasts.current.map((t) => t.tone)).toEqual(['warn', 'enemy']);
  });

  it('shows the toast of an event only when the map has drawn its tick (#561)', () => {
    const hud = newState();
    hud.onSnapshot(snapshot(10));
    hud.onEvent({ type: 'event', tick: 9, kind: 'capture_failed', data: CAPTURE_FAILED });
    hud.onEvent({ type: 'event', tick: 10, kind: 'node_captured', data: { node: 1, player: 1 } });
    // The snapshot is here, the map is two ticks behind it.
    hud.onRender(8);
    expect(hud.toasts.current).toEqual([]);
    hud.onRender(9.5);
    expect(hud.toasts.current.map((t) => t.tone)).toEqual(['warn']);
    hud.onRender(10);
    expect(hud.toasts.current.map((t) => t.tone)).toEqual(['enemy', 'warn']);
    // Shown once.
    hud.onRender(11);
    expect(hud.toasts.current).toHaveLength(2);
  });

  it('shows a held toast anyway when the map never reaches its tick (pause, end of the match)', () => {
    const hud = newState();
    hud.onSnapshot(snapshot(10));
    hud.onEvent({ type: 'event', tick: 10, kind: 'capture_failed', data: CAPTURE_FAILED });
    hud.onRender(8);
    expect(hud.toasts.current).toEqual([]);
    vi.advanceTimersByTime(TOAST_HOLD_MS);
    expect(hud.toasts.current).toHaveLength(1);
  });

  it('adds one toast when the last minute starts', () => {
    const hud = newState();
    const last = (seconds: number): SnapshotMsg =>
      snapshot(DEV_RULES.match_ticks - seconds * DEV_RULES.tick_hz);
    hud.onSnapshot(last(LAST_MINUTE_S + 5));
    expect(hud.toasts.current).toEqual([]);
    hud.onSnapshot(last(LAST_MINUTE_S));
    hud.onSnapshot(last(LAST_MINUTE_S - 10));
    hud.onRender(Number.POSITIVE_INFINITY);
    expect(hud.toasts.current).toHaveLength(1);
    expect(hud.toasts.current[0]?.tone).toBe('warn');
  });

  it('drops the toasts and the timers on a reset and on destroy', () => {
    const hud = newState();
    hud.onSnapshot(snapshot(2));
    hud.onEvent({ type: 'event', tick: 8, kind: 'capture_failed', data: CAPTURE_FAILED });
    hud.onRender(8);
    hud.onEvent({ type: 'event', tick: 9, kind: 'capture_failed', data: CAPTURE_FAILED });
    hud.reset();
    expect(hud.toasts.current).toEqual([]);
    hud.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('HudState: the supply rail (#1067)', () => {
  const capital = map.nodes.find((n) => n.capital_of === 0)?.id ?? -1;
  const factory = map.nodes.find((n) => n.start_owner === 0 && n.capital_of === null)?.id ?? -1;
  const stancesHud = (): HudState =>
    new HudState({ me: 0, nicks: ['Ember', 'Bot'], rules: DEV_RULES_STANCES, map });
  const at = (tick: number, stance: 'war' | 'economy', capitalTicks: number): SnapshotMsg => {
    const base = devSnapshot(map, DEV_RULES_STANCES, tick);
    return {
      ...base,
      view: {
        ...base.view,
        me: { ...base.view.me, stance, cp_ticks: 0, capital_ticks: capitalTicks },
      },
    };
  };
  const produced = (tick: number, node: number, player = 0) => ({
    type: 'event' as const,
    tick,
    kind: 'charges_produced',
    data: { player, node, charges: 1, spill: 0 },
  });

  it('starts a new fill when the period runs out, not on a stance change', () => {
    const hud = stancesHud();
    hud.onSnapshot(at(10, 'war', 390));
    expect(hud.current?.supply).toMatchObject({ cycle: 0, ready: true });
    hud.onSnapshot(at(20, 'war', 0));
    expect(hud.current?.supply?.cycle).toBe(1);
    hud.onSnapshot(at(30, 'war', 100));
    // War 100 of 400 carried to Economy 25 of 100 (DEC-44, item 4): the same fill goes on.
    hud.onSnapshot(at(31, 'economy', 25));
    expect(hud.current?.supply).toMatchObject({ cycle: 1, share: 0.25 });
  });

  it('keeps the charges of the capital and of the other factories apart', () => {
    const hud = stancesHud();
    hud.onEvent(produced(20, capital));
    hud.onEvent(produced(20, factory));
    // Two factories in one tick are one moment; the enemy's charges are never seen.
    hud.onEvent(produced(20, factory));
    hud.onEvent(produced(21, factory, 1));
    hud.onSnapshot(at(20, 'war', 0));
    const supply = hud.current?.supply;
    expect(supply?.capital?.tick).toBe(20);
    expect(supply?.factory?.tick).toBe(20);
    const seq = supply?.factory?.seq;
    hud.onEvent(produced(40, factory));
    hud.onSnapshot(at(40, 'war', 20));
    expect(hud.current?.supply?.factory?.seq).toBeGreaterThan(seq ?? 0);
    expect(hud.current?.supply?.capital?.tick).toBe(20);
  });
});
