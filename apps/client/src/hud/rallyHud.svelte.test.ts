import { afterEach, describe, expect, it, vi } from 'vitest';
import { RALLY_TICK, rallyDueSnapshot } from '../dev/groupScene.ts';
import { STAY_MS } from '../match/alerts.svelte.ts';
import { BUNDLED_MAPS } from '../map/bundledMaps.ts';
import type { EventMsg, GroupView, MapFile, SnapshotMsg } from '../protocol.gen.ts';
import { DEV_RULES_GROUP } from './devFeed.ts';
import { HudState } from './hudState.svelte.ts';

const map = BUNDLED_MAPS.find((m) => m.meta.name === 'artery') as MapFile;

function newState(): HudState {
  return new HudState({ me: 0, nicks: ['Ember', 'Bot'], rules: DEV_RULES_GROUP, map });
}

const event = (tick: number, kind: string, data: EventMsg['data']): EventMsg => ({
  type: 'event',
  tick,
  kind,
  data,
});

/** The rally scene at `tick`, with `extra` own groups and `cp` hundredths. */
function scene(tick: number, cp: number, extra: GroupView[] = []): SnapshotMsg {
  const base = rallyDueSnapshot(map);
  return {
    ...base,
    tick,
    view: {
      ...base.view,
      me: { ...base.view.me, cp },
      groups: [...base.view.groups, ...extra],
    },
  };
}

/** A recruit of Ford standing in it with its order to Watchhouse (it leaves next tick). */
const walker: GroupView = {
  id: 'recruit-1',
  units: 1,
  charged: 0,
  mode: 'attack',
  location: { kind: 'node', node: 13 },
  order: {
    dest: 12,
    path: [12],
    planned: false,
    bonus: 0,
    gathering: false,
    plan: 0,
    next_charge_tick: null,
    depart_tick: RALLY_TICK + 1,
    group_order: null,
    arrive_tick: RALLY_TICK + 40,
  },
};

describe('HudState: the rally walks (#930, W10)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('earmarks every queued walker, and a recruit made but not gone first', () => {
    const hud = newState();
    hud.onSnapshot(scene(RALLY_TICK - 1, 125));
    expect(hud.current?.rally.dues).toHaveLength(4);
    expect(hud.current?.rally.cost).toBe(50);
    hud.onEvent(event(RALLY_TICK, 'recruited', { player: 0, node: 13, group: 'recruit-1' }));
    hud.onSnapshot(scene(RALLY_TICK, 125, [walker]));
    const dues = hud.current?.rally.dues ?? [];
    expect(dues).toHaveLength(5);
    expect(dues[0]).toMatchObject({ node: 13, slot: -1, share: 1, short: false });
    expect(hud.current?.rally.nextSeconds).toBe(1);
  });

  it('drops the earmark and starts a flight at the charge (`rally_walk_paid`)', () => {
    const hud = newState();
    hud.onSnapshot(scene(RALLY_TICK - 1, 125));
    hud.onEvent(event(RALLY_TICK, 'recruited', { player: 0, node: 13, group: 'recruit-1' }));
    hud.onSnapshot(scene(RALLY_TICK, 125, [walker]));
    hud.onEvent(
      event(RALLY_TICK + 1, 'rally_walk_paid', {
        player: 0,
        group: 'recruit-1',
        node: 13,
        target: 12,
        cost: 50,
      }),
    );
    // The walker is on the road now: no earmark for it, one paid walk to fly.
    const gone: GroupView = {
      ...walker,
      location: { kind: 'edge', edge: 0, from_node: 13, progress: 10 },
    };
    hud.onSnapshot(scene(RALLY_TICK + 1, 75, [gone]));
    expect(hud.current?.rally.dues).toHaveLength(4);
    expect(hud.current?.rally.paid).toEqual([{ seq: 1, node: 13, target: 12 }]);
    // 0.75 CP pay one of the four walks still due.
    expect(hud.current?.rally.dues.map((d) => d.short)).toEqual([false, true, true, true]);
  });

  it('hangs the strip of a walk without CP (`rally_walk_no_cp`) for 3.5 s, no flight', () => {
    vi.useFakeTimers();
    const hud = newState();
    hud.onSnapshot(scene(RALLY_TICK, 0, [walker]));
    hud.onEvent(event(RALLY_TICK, 'recruited', { player: 0, node: 13, group: 'recruit-1' }));
    hud.onEvent(
      event(RALLY_TICK + 1, 'rally_walk_no_cp', {
        player: 0,
        group: 'recruit-1',
        node: 13,
        target: 12,
      }),
    );
    expect(hud.alerts.stays).toEqual([{ seq: 1, node: 13, target: 12 }]);
    hud.onSnapshot(scene(RALLY_TICK + 1, 0, [{ ...walker, order: null }]));
    expect(hud.current?.rally.paid).toEqual([]);
    // Every walk due is short with no CP at all: the empty red earmarks.
    expect(hud.current?.rally.dues.every((d) => d.short)).toBe(true);
    expect(hud.current?.rally.dues.some((d) => d.slot === -1)).toBe(false);
    vi.advanceTimersByTime(STAY_MS);
    expect(hud.alerts.stays).toEqual([]);
  });

  it('ignores the walks of the other player', () => {
    const hud = newState();
    hud.onSnapshot(scene(RALLY_TICK, 125));
    hud.onEvent(event(RALLY_TICK, 'rally_walk_paid', { player: 1, node: 3, target: 4, cost: 50 }));
    hud.onEvent(event(RALLY_TICK, 'rally_walk_no_cp', { player: 1, node: 3, target: 4 }));
    hud.onSnapshot(scene(RALLY_TICK + 1, 125));
    expect(hud.current?.rally.paid).toEqual([]);
    expect(hud.alerts.stays).toEqual([]);
  });
});

describe('HudState: the VP credit (#930, P1)', () => {
  it('reads the next credit from the period and the gains of both sides', () => {
    const hud = newState();
    hud.onSnapshot(scene(RALLY_TICK, 125));
    const next = hud.current?.vpNext;
    expect(next?.countdown).toEqual({ ticks: 120, share: 0.6, round: 8 });
    expect(next?.gain).toEqual({ mine: 5, enemy: 7 });
    expect(next?.credit).toBeNull();
  });

  it('makes one credit of the `vp_awarded` of one tick, a new one at the next', () => {
    const hud = newState();
    hud.onSnapshot(scene(2700, 125));
    hud.onEvent(event(2700, 'vp_awarded', { player: 0, vp: 5 }));
    hud.onEvent(event(2700, 'vp_awarded', { player: 1, vp: 7 }));
    hud.onSnapshot(scene(2701, 125));
    expect(hud.current?.vpNext.credit).toEqual({ seq: 1, tick: 2700, mine: 5, enemy: 7 });
    hud.onEvent(event(3000, 'vp_awarded', { player: 1, vp: 9 }));
    hud.onSnapshot(scene(3000, 125));
    expect(hud.current?.vpNext.credit).toEqual({ seq: 2, tick: 3000, mine: 0, enemy: 9 });
  });
});
