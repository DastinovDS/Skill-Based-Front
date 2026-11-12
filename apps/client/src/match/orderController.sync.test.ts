/**
 * ARC-C01: the order controller's state machine steps on input, on snapshots and on its own
 * timers, never because the map drew a frame. `overlay()` is a pure read: no test here calls it to
 * move anything, and calling it changes nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_RULES_GROUP, devSnapshot } from '../hud/devFeed.ts';
import { HudState } from '../hud/hudState.svelte.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { Command, RulesetPublic, SnapshotMsg } from '../protocol.gen.ts';
import { OrderBook } from './orderBook.ts';
import { OrderController, REACH_REFRESH_TICKS } from './orderController.ts';

const map = DEFAULT_MAP;
// The group order and the rally point on (DEC-48), as `mvp-7` has them.
const RULES: RulesetPublic = DEV_RULES_GROUP;
const snapshot = devSnapshot(map, RULES, 30);
const group = snapshot.view.groups[0];
if (group?.location.kind !== 'node') throw new Error('the dev snapshot has no group in a node');
const home = group.location.node;
const enemy = snapshot.view.nodes.find((n) => n.owner === 1 && n.detail === 'exact');
if (enemy === undefined) throw new Error('the dev snapshot lacks an enemy node');

function setup(queryReach: (id: string) => void = () => undefined) {
  const hud = new HudState({ me: 0, nicks: ['Ember', 'Bot'], rules: RULES, map });
  hud.onSnapshot(snapshot);
  const book = new OrderBook();
  const sent: Command[] = [];
  const queried: string[] = [];
  const controller = new OrderController({
    hud,
    map,
    rules: RULES,
    book,
    send: (cmd) => sent.push(cmd),
    now: () => 0,
    queryReach: (id) => {
      queried.push(id);
      queryReach(id);
    },
  });
  return { hud, book, sent, controller, queried };
}

/** The dev snapshot `ticks` later, with the own node `node` lost to the enemy if given. */
function later(ticks: number, lost: number | null = null): SnapshotMsg {
  return {
    ...snapshot,
    tick: snapshot.tick + ticks,
    view: {
      ...snapshot.view,
      nodes: snapshot.view.nodes.map((n) => (n.id === lost ? { ...n, owner: 1 } : n)),
    },
  };
}

describe('the order controller steps without frames (ARC-C01)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('overlay() is a pure read: no query, no HUD or UI write, the same object each time', () => {
    const { controller, hud, queried } = setup();
    controller.click({ kind: 'group', id: group.id }, false);
    controller.hover({ kind: 'node', id: enemy.id });
    const select = vi.spyOn(hud, 'select');
    const patch = vi.spyOn(controller.ui, 'patch');
    const asked = queried.length;
    const first = controller.overlay();
    for (let i = 0; i < 5; i += 1) expect(controller.overlay()).toBe(first);
    expect(queried).toHaveLength(asked);
    expect(select).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it('asks for the reach on the selection and again after the refresh ticks, on snapshots alone', () => {
    const { controller, hud, queried } = setup();
    controller.click({ kind: 'group', id: group.id }, false);
    expect(queried).toEqual([group.id]);
    hud.onSnapshot(later(REACH_REFRESH_TICKS - 1));
    expect(queried).toEqual([group.id]);
    hud.onSnapshot(later(REACH_REFRESH_TICKS));
    expect(queried).toEqual([group.id, group.id]);
  });

  it('a group gone from a snapshot leaves the groups selected together', () => {
    const second = { ...group, id: '9002' };
    const both: SnapshotMsg = {
      ...snapshot,
      view: { ...snapshot.view, groups: [...snapshot.view.groups, second] },
    };
    const { controller, hud } = setup();
    hud.onSnapshot(both);
    controller.selectBox([group.id, second.id]);
    expect(controller.picks).toEqual([group.id, second.id]);
    hud.onSnapshot({ ...both, tick: both.tick + 1, view: { ...both.view, groups: [group] } });
    expect(controller.picks).toEqual([]);
    expect(hud.selection).toEqual({ kind: 'group', id: group.id });
  });

  it('a selected city lost in a snapshot is let go with its menu', () => {
    const { controller, hud } = setup();
    controller.click({ kind: 'node', id: home }, false);
    expect(controller.cityMenu.current.open).toBe(true);
    hud.onSnapshot(later(1, home));
    expect(hud.selection).toBeNull();
    expect(controller.cityMenu.current.open).toBe(false);
  });

  it('the road pick and the rally pick end when their city is lost in a snapshot', () => {
    const { controller, hud } = setup();
    controller.click({ kind: 'node', id: home }, false);
    controller.startFortify();
    expect(controller.ui.current.fortFrom).toBe(home);
    hud.onSnapshot(later(1, home));
    expect(controller.ui.current.fortFrom).toBeNull();

    const rally = setup();
    rally.controller.click({ kind: 'node', id: home }, false);
    rally.controller.startRally();
    expect(rally.controller.ui.current.rallyFrom).toBe(home);
    rally.hud.onSnapshot(later(1, home));
    expect(rally.controller.ui.current.rallyFrom).toBeNull();
  });

  it('a failed step after a snapshot is logged once and leaves the HUD going', () => {
    let fail = false;
    const { controller, hud } = setup(() => {
      if (fail) throw new Error('boom');
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    controller.click({ kind: 'group', id: group.id }, false);
    fail = true;
    expect(() => {
      hud.onSnapshot(later(REACH_REFRESH_TICKS));
    }).not.toThrow();
    expect(() => {
      hud.onSnapshot(later(2 * REACH_REFRESH_TICKS));
    }).not.toThrow();
    expect(hud.current?.tick).toBe(snapshot.tick + 2 * REACH_REFRESH_TICKS);
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it('stops listening to the HUD once destroyed', () => {
    const { controller, hud, queried } = setup();
    controller.click({ kind: 'group', id: group.id }, false);
    controller.destroy();
    hud.onSnapshot(later(REACH_REFRESH_TICKS));
    expect(queried).toEqual([group.id]);
  });
});
