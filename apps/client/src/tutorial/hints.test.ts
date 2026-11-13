import { describe, expect, it } from 'vitest';
import { arterySnapshot } from '../dev/arteryScene.ts';
import { BUNDLED_MAPS } from '../map/bundledMaps.ts';
import type { EventMsg, FightView, MapFile, SnapshotMsg } from '../protocol.gen.ts';
import { HINT_GAP_MS, HINT_SHOW_MS, HintCoach, type HintClock } from './hintCoach.svelte.ts';
import { HintWatcher } from './hints.ts';
import { hintMarks } from './hintSource.ts';
import { EMPTY_PROGRESS, type HintId, type TutorialProgress } from './progress.ts';

// The hints of the first match (#806, docs/design/tutorial.md section 5) on a recorded view: the
// artery scene of the dev screen (player 0, the capital Stonegate is node 0, own cities 1, 2, 3, 6,
// 9). The expected hints and places are the triggers of section 5.
const MAP = BUNDLED_MAPS.find((m) => m.meta.name === 'artery') as MapFile;
const BASE = arterySnapshot(MAP);
const TICK_HZ = 10;

function at(tick: number, change: (view: SnapshotMsg['view']) => void = () => undefined) {
  const view = structuredClone(BASE.view);
  change(view);
  return { type: 'snapshot', tick, view } as const satisfies SnapshotMsg;
}

function event(kind: string, data: EventMsg['data'], tick = 100): EventMsg {
  return { type: 'event', tick, kind, data };
}

function fight(groups: string[], rounded: boolean): FightView {
  return {
    id: 'f1',
    node: 4,
    edge: null,
    point: null,
    attacker: 0,
    start_tick: 90,
    next_round_tick: 110,
    groups,
    enemy_units: 3,
    enemy_charged: 2,
    shots: [0, 0],
    losses: [0, 0],
    virtual_left: [0, 0],
    mute: [0, 0],
    last_round: rounded
      ? {
          tick: 100,
          shots: [1, 1],
          virtual: [0, 0],
          spent: [1, 1],
          losses: [0, 0],
          burned: [0, 0],
        }
      : null,
  };
}

function ids(watcher: HintWatcher): HintId[] {
  return watcher.ready().map((hint) => hint.id);
}

describe('the triggers of the first-match hints', () => {
  it('H1: 5 s into the match, at the own capital', () => {
    const watcher = new HintWatcher(MAP, 0, TICK_HZ);
    watcher.onSnapshot(at(49));
    expect(ids(watcher)).toEqual([]);
    watcher.onSnapshot(at(50));
    expect(watcher.ready()).toEqual([{ id: 'H1', variant: null, node: 0, road: null, hud: null }]);
  });

  it('H2: the first own node over its capacity, while it is', () => {
    const watcher = new HintWatcher(MAP, 0, TICK_HZ);
    watcher.onSnapshot(at(10));
    expect(ids(watcher)).toEqual([]);
    watcher.onSnapshot(
      at(11, (view) => {
        (view.nodes[3] as { attrition_in: number | null }).attrition_in = 20;
      }),
    );
    expect(watcher.ready()).toMatchObject([{ id: 'H2', node: 3 }]);
    // The garrison moved out before the hint could show: nothing to say.
    watcher.onSnapshot(at(12));
    expect(ids(watcher)).toEqual([]);
  });

  it('H3: the first own charge_burned (the stance chip) or cp_burned (the CP gauge)', () => {
    const watcher = new HintWatcher(MAP, 0, TICK_HZ);
    watcher.onEvent(event('charge_burned', { player: 1, node: 21, charges: 1 }));
    expect(ids(watcher)).toEqual([]);
    watcher.onEvent(event('charge_burned', { player: 0, node: 0, charges: 1 }));
    watcher.onEvent(event('cp_burned', { player: 0, cp: 50 }));
    expect(watcher.ready()).toEqual([
      { id: 'H3', variant: 'charges', node: null, road: null, hud: 'stance' },
    ]);
    const cp = new HintWatcher(MAP, 0, TICK_HZ);
    cp.onEvent(event('cp_burned', { player: 0, cp: 50 }));
    expect(cp.ready()).toMatchObject([{ id: 'H3', variant: 'cp', hud: 'cp' }]);
  });

  it('H4: an own group joins a fight after its first round', () => {
    const watcher = new HintWatcher(MAP, 0, TICK_HZ);
    // The fight is first seen with two groups, before any round: they came together.
    watcher.onSnapshot(at(25, (view) => (view.fights = [fight(['g1', 'g2'], false)])));
    watcher.onSnapshot(at(26, (view) => (view.fights = [fight(['g1', 'g2', 'g3'], false)])));
    expect(ids(watcher)).toEqual([]);
    watcher.onSnapshot(at(30, (view) => (view.fights = [fight(['g1', 'g2', 'g3'], true)])));
    expect(ids(watcher)).toEqual([]);
    watcher.onSnapshot(at(34, (view) => (view.fights = [fight(['g1', 'g2', 'g3', 'g4'], true)])));
    expect(watcher.ready()).toMatchObject([{ id: 'H4', node: 4, road: null }]);
  });

  it('H4 on a road points at the road', () => {
    const watcher = new HintWatcher(MAP, 0, TICK_HZ);
    const edge = MAP.edges[2];
    const onRoad = (groups: string[]): FightView => ({
      ...fight(groups, true),
      node: null,
      edge: 2,
    });
    watcher.onSnapshot(at(30, (view) => (view.fights = [onRoad(['g1'])])));
    watcher.onSnapshot(at(31, (view) => (view.fights = [onRoad(['g1', 'g2'])])));
    expect(watcher.ready()).toMatchObject([{ id: 'H4', node: null, road: [edge?.a, edge?.b] }]);
  });

  it('H5: the third own recruit in a city without a rally point', () => {
    const watcher = new HintWatcher(MAP, 0, TICK_HZ);
    watcher.onSnapshot(
      at(10, (view) => {
        (view.nodes[6] as { rally_point: number | null }).rally_point = 9;
      }),
    );
    const recruited = (node: number, player = 0) =>
      event('recruited', { player, node, group: `r${String(node)}` });
    watcher.onEvent(recruited(0));
    watcher.onEvent(recruited(6)); // its recruits walk to the rally point: not counted
    watcher.onEvent(recruited(21, 1));
    watcher.onEvent(recruited(9));
    expect(ids(watcher)).toEqual([]);
    watcher.onEvent(recruited(0));
    expect(watcher.ready()).toMatchObject([{ id: 'H5', node: 0 }]);
  });
});

/** A clock the test moves by hand. */
function fakeClock() {
  let now = 0;
  let timers: { at: number; run: () => void; id: number }[] = [];
  let next = 0;
  const clock: HintClock = {
    now: () => now,
    setTimeout: (run, ms) => {
      next += 1;
      timers.push({ at: now + ms, run, id: next });
      return next;
    },
    clearTimeout: (handle) => {
      timers = timers.filter((t) => t.id !== handle);
    },
  };
  const advance = (ms: number): void => {
    now += ms;
    const due = timers.filter((t) => t.at <= now);
    timers = timers.filter((t) => t.at > now);
    for (const t of due) t.run();
  };
  return { clock, advance };
}

/** The progress of the browser, kept in memory as `TutorialProgressState` keeps it. */
function memoryProgress(start: Partial<TutorialProgress> = {}) {
  const progress = {
    current: { ...EMPTY_PROGRESS, ...start } as TutorialProgress,
    hintShown(id: HintId): void {
      if (!this.current.hints.includes(id)) {
        this.current = { ...this.current, hints: [...this.current.hints, id] };
      }
    },
    turnHintsOff(): void {
      this.current = { ...this.current, hintsOff: true };
    },
  };
  return progress;
}

function coachWith(progress = memoryProgress()) {
  const { clock, advance } = fakeClock();
  const coach = new HintCoach(new HintWatcher(MAP, 0, TICK_HZ), progress, clock);
  return { coach, progress, advance };
}

describe('the hint coach', () => {
  it('shows a hint once, closes it after 12 s, and keeps it shown in the progress', () => {
    const { coach, progress, advance } = coachWith();
    coach.onMessage(at(50));
    expect(coach.current?.id).toBe('H1');
    expect(progress.current.hints).toEqual(['H1']);
    advance(HINT_SHOW_MS - 1);
    expect(coach.current?.id).toBe('H1');
    advance(1);
    expect(coach.current).toBeNull();
    advance(HINT_GAP_MS);
    coach.onMessage(at(60));
    expect(coach.current).toBeNull();
    // A reload: a new coach on the same progress never shows it again.
    const again = coachWith(progress);
    again.coach.onMessage(at(70));
    expect(again.coach.current).toBeNull();
  });

  it('the time stands still while the card is held, then runs on', () => {
    const { coach, advance } = coachWith();
    coach.onMessage(at(50));
    advance(10_000);
    coach.hold(true);
    advance(60_000);
    expect(coach.current?.id).toBe('H1');
    coach.hold(false);
    advance(HINT_SHOW_MS - 10_000 - 1);
    expect(coach.current?.id).toBe('H1');
    advance(1);
    expect(coach.current).toBeNull();
  });

  it('one hint at a time: the next waits for the close and a short gap', () => {
    const { coach, advance } = coachWith();
    coach.onMessage(at(50));
    coach.onMessage(event('cp_burned', { player: 0, cp: 50 }));
    expect(coach.current?.id).toBe('H1');
    coach.close();
    coach.onMessage(at(51));
    expect(coach.current).toBeNull();
    advance(HINT_GAP_MS);
    coach.onMessage(at(52));
    expect(coach.current).toMatchObject({ id: 'H3', variant: 'cp' });
  });

  it('"Turn off hints" closes the hint and no other shows', () => {
    const { coach, progress, advance } = coachWith();
    coach.onMessage(at(50));
    coach.turnOff();
    expect(coach.current).toBeNull();
    expect(progress.current.hintsOff).toBe(true);
    advance(HINT_GAP_MS);
    coach.onMessage(event('cp_burned', { player: 0, cp: 50 }));
    expect(coach.current).toBeNull();
  });

  it('respects hints turned off before the match', () => {
    const { coach } = coachWith(memoryProgress({ hintsOff: true }));
    coach.onMessage(at(50));
    expect(coach.current).toBeNull();
  });

  it('H4 and H5 never show once their Advanced chapter is done', () => {
    const recruits = (coach: HintCoach): void => {
      for (let i = 0; i < 3; i += 1) {
        coach.onMessage(event('recruited', { player: 0, node: 0, group: `r${String(i)}` }));
      }
    };
    const grow = (coach: HintCoach): void => {
      coach.onMessage(at(100, (view) => (view.fights = [fight(['g1'], true)])));
      coach.onMessage(at(101, (view) => (view.fights = [fight(['g1', 'g2'], true)])));
    };
    const taught = coachWith(
      memoryProgress({ hints: ['H1'], done: ['group-orders', 'rally-points'] }),
    );
    grow(taught.coach);
    recruits(taught.coach);
    expect(taught.coach.current).toBeNull();

    const fresh = coachWith(memoryProgress({ hints: ['H1'] }));
    grow(fresh.coach);
    expect(fresh.coach.current?.id).toBe('H4');
    fresh.coach.close();
    fresh.advance(HINT_GAP_MS);
    recruits(fresh.coach);
    expect(fresh.coach.current?.id).toBe('H5');
  });

  it('the map rings the place of a hint, wide for capacity and fights', () => {
    const h2 = { id: 'H2', variant: null, node: 3, road: null, hud: null } as const;
    expect(hintMarks(h2, 1, 0).nodes).toEqual([{ id: 3, ring: true }]);
    const h1 = { ...h2, id: 'H1', node: 0 } as const;
    expect(hintMarks(h1, 2, 0).nodes).toEqual([{ id: 0, ring: false }]);
    const h3 = { id: 'H3', variant: 'cp', node: null, road: null, hud: 'cp' } as const;
    expect(hintMarks(h3, 3, 0)).toMatchObject({ nodes: [], roads: [] });
  });
});
