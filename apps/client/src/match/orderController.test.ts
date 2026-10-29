import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { HudState } from '../hud/hudState.svelte.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { Command, RulesetPublic, SnapshotMsg } from '../protocol.gen.ts';
import { RADIAL } from '../hud/radial.ts';
import { OrderBook } from './orderBook.ts';
import {
  FOLLOW_SPLIT_TICKS,
  NOTICE_MS,
  OrderController,
  REACH_REFRESH_TICKS,
} from './orderController.ts';

const map = DEFAULT_MAP;
// Roads are paid with CP (DEC-28, item 7): the ruleset gives the build time only.
const RULES: RulesetPublic = { ...DEV_RULES, build: { ticks_per_level: 150 } };
const snapshot = devSnapshot(map, RULES, 30);
const group = snapshot.view.groups[0];
if (group?.location.kind !== 'node') throw new Error('the dev snapshot has no group in a node');
const home = group.location.node;
const enemy = snapshot.view.nodes.find((n) => n.owner === 1 && n.detail === 'exact');
const other = snapshot.view.nodes.find((n) => n.id !== home && n.owner === 0);
if (enemy === undefined || other === undefined) throw new Error('the dev snapshot lacks nodes');

function setup(withSend = true) {
  const hud = new HudState({ me: 0, nicks: ['Danya', 'Bot'], rules: RULES, map });
  hud.onSnapshot(snapshot);
  const book = new OrderBook();
  const sent: Command[] = [];
  const clock = { now: 0 };
  const focused: number[] = [];
  const queried: string[] = [];
  const controller = new OrderController({
    hud,
    map,
    rules: RULES,
    book,
    send: withSend ? (cmd) => sent.push(cmd) : null,
    now: () => clock.now,
    alerts: hud.alerts,
    focusNode: (node) => focused.push(node),
    queryReach: (id) => queried.push(id),
  });
  return { hud, book, sent, controller, clock, focused, queried };
}

const down = (code: string, repeat = false) =>
  ({ type: 'keydown', code, shiftKey: false, repeat }) as const;
const up = (code: string) => ({ type: 'keyup', code, shiftKey: false }) as const;

const ack = (seq: number, reject_code: string | null = null) =>
  ({ type: 'ack', seq, applied_tick: 31, path: null, arrive_tick: null, reject_code }) as const;

describe('OrderController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('selects a group, then a node, by clicks; an empty click deselects', () => {
    const { hud, controller } = setup();
    controller.click({ kind: 'group', id: group.id }, false);
    expect(hud.selection).toEqual({ kind: 'group', id: group.id });
    expect(hud.current?.group?.id).toBe(group.id);
    controller.click(null, false);
    expect(hud.selection).toBeNull();
    controller.click({ kind: 'node', id: other.id }, false);
    expect(hud.selection).toEqual({ kind: 'node', id: other.id });
  });

  it('orders the selected group to a clicked node: normal, then planned by Shift', () => {
    const { controller, sent, book } = setup();
    controller.click({ kind: 'group', id: group.id }, false);
    controller.click({ kind: 'node', id: enemy.id }, false);
    controller.click({ kind: 'group', id: group.id }, false); // the order let the group go
    controller.click({ kind: 'node', id: other.id }, true);
    expect(sent).toEqual([
      { type: 'move', group: group.id, dest: enemy.id, planned: false },
      { type: 'move', group: group.id, dest: other.id, planned: true },
    ]);
    // Shown at once as a ghost, the last order replacing the first.
    expect(book.ghosts().map((g) => [g.from, g.dest, g.planned])).toEqual([[home, other.id, true]]);
  });

  it('lets the selection go after an order is given and after one is cancelled', () => {
    const { controller, hud } = setup();
    controller.click({ kind: 'group', id: group.id }, false);
    controller.click({ kind: 'node', id: enemy.id }, false);
    expect(hud.selection).toBeNull();
    controller.click({ kind: 'group', id: group.id }, false);
    controller.cancelSelected();
    expect(hud.selection).toBeNull();
  });

  it('makes every order planned while the switch is on', () => {
    const { controller, sent } = setup();
    controller.click({ kind: 'group', id: group.id }, false);
    controller.setPlanned(true);
    controller.click({ kind: 'node', id: enemy.id }, false);
    expect(sent[0]).toMatchObject({ planned: true });
    controller.setPlanned(false);
    expect(controller.ui.current.planned).toBe(false);
  });

  it('key P does nothing: Shift+click is the way to a planned order (#213)', () => {
    const { controller, sent } = setup();
    controller.click({ kind: 'group', id: group.id }, false);
    expect(controller.key({ type: 'keydown', code: 'KeyP', shiftKey: false })).toBe(false);
    expect(controller.ui.current.planned).toBe(false);
    controller.click({ kind: 'node', id: enemy.id }, false);
    expect(sent[0]).toMatchObject({ planned: false });
  });

  it('does not order the group to its own node: that click only deselects, no city menu', () => {
    const { controller, sent, hud } = setup();
    controller.click({ kind: 'group', id: group.id }, false);
    controller.click({ kind: 'node', id: home }, false);
    expect(sent).toEqual([]);
    expect(hud.selection).toBeNull();
    expect(controller.cityMenu.current.open).toBe(false);
    // The area of the city (a click on a road inside its cell) is the same click.
    controller.click({ kind: 'group', id: group.id }, false);
    controller.click({ kind: 'edge', id: 0, cell: home }, false);
    expect(hud.selection).toBeNull();
    expect(controller.cityMenu.current.open).toBe(false);
  });

  it('only selects when there is no match to send to', () => {
    const { controller, hud } = setup(false);
    controller.click({ kind: 'group', id: group.id }, false);
    controller.click({ kind: 'node', id: enemy.id }, false);
    expect(hud.selection).toEqual({ kind: 'node', id: enemy.id });
  });

  it('previews the target with the dotted line, and the combat estimate is gone', () => {
    const { controller } = setup();
    controller.click({ kind: 'group', id: group.id }, false);
    controller.hover({ kind: 'node', id: enemy.id });
    expect(controller.overlay().preview).toEqual({ from: home, to: enemy.id, planned: false });
    controller.key({ type: 'keydown', code: 'ShiftLeft', shiftKey: true });
    expect(controller.overlay().preview).toEqual({ from: home, to: enemy.id, planned: true });
    controller.hover(null);
    expect(controller.overlay().preview).toBeNull();
  });

  it('returns the same overlay object until something changes', () => {
    const { controller } = setup();
    controller.click({ kind: 'group', id: group.id }, false);
    const first = controller.overlay();
    expect(controller.overlay()).toBe(first);
    controller.hover({ kind: 'node', id: enemy.id });
    expect(controller.overlay()).not.toBe(first);
  });

  it('reports every answer to the feedback listeners, an accepted move too', () => {
    const { controller, book } = setup();
    const seen: string[] = [];
    const stop = controller.ui.onFeedback((f) => seen.push(f.kind));
    controller.click({ kind: 'group', id: group.id }, false);
    controller.click({ kind: 'node', id: enemy.id }, false);
    book.onAck(ack(1, null));
    controller.click({ kind: 'group', id: group.id }, false);
    controller.click({ kind: 'node', id: enemy.id }, false);
    book.onAck(ack(2, 'NOT_ENOUGH_CP'));
    expect(seen).toEqual(['accepted', 'rejected']);
    stop();
    controller.click({ kind: 'group', id: group.id }, false);
    controller.click({ kind: 'node', id: enemy.id }, false);
    book.onAck(ack(3, null));
    expect(seen).toHaveLength(2);
  });

  it('shows a rejection as a notice that fades, and rolls the ghost back', () => {
    const { controller, book } = setup();
    controller.click({ kind: 'group', id: group.id }, false);
    controller.click({ kind: 'node', id: enemy.id }, false);
    book.onAck(ack(1, 'NOT_ENOUGH_CP'));
    // The ghost stays to shake and fade (U6).
    expect(book.ghosts().map((g) => g.status)).toEqual(['rejected']);
    expect(controller.ui.current.notice).toMatchObject({ kind: 'rejected', code: 'NOT_ENOUGH_CP' });
    vi.advanceTimersByTime(NOTICE_MS);
    expect(controller.ui.current.notice).toBeNull();
  });

  it('cancels the order of the selected group with X, and drops the selection with Esc', () => {
    const { controller, sent, hud } = setup();
    controller.click({ kind: 'group', id: group.id }, false);
    expect(controller.key({ type: 'keydown', code: 'KeyX', shiftKey: false })).toBe(true);
    expect(sent).toEqual([{ type: 'cancel_order', group: group.id }]);
    expect(controller.key({ type: 'keydown', code: 'Escape', shiftKey: false })).toBe(true);
    expect(hud.selection).toBeNull();
    controller.key({ type: 'keydown', code: 'KeyX', shiftKey: false });
    expect(sent).toHaveLength(1); // nothing selected: nothing to cancel
    expect(controller.key({ type: 'keydown', code: 'KeyZ', shiftKey: false })).toBe(false);
  });

  it('X cancels the last recruit of the selected own city, not of an enemy one', () => {
    const { controller, sent } = setup();
    controller.click({ kind: 'node', id: home }, false);
    expect(controller.key(down('KeyX'))).toBe(true);
    expect(sent).toEqual([{ type: 'cancel_recruit', node: home }]);
    controller.deselect();
    controller.click({ kind: 'node', id: enemy.id }, false);
    expect(controller.key(down('KeyX'))).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it('sends the other commands as intents', () => {
    const { controller, sent } = setup();
    controller.click({ kind: 'group', id: group.id }, false);
    controller.setMode('defense');
    controller.split(1);
    controller.upgradeRoad(3);
    controller.recruit();
    controller.setStance('economy');
    controller.forfeit();
    expect(sent).toEqual([
      { type: 'set_mode', group: group.id, mode: 'defense' },
      { type: 'split', group: group.id, n: 1 },
      // A road for CP, no city in the command (DEC-28, item 7).
      { type: 'upgrade_road', edge: 3 },
      { type: 'recruit', node: home },
      { type: 'set_stance', stance: 'economy' },
      { type: 'forfeit' },
    ]);
  });

  it('asks the server where the selected group can go and shows the answer (DEC-20)', () => {
    const { controller, queried, hud } = setup();
    controller.overlay();
    expect(queried).toEqual([]); // nothing selected: nothing to ask
    controller.click({ kind: 'group', id: group.id }, false);
    controller.overlay();
    controller.overlay();
    expect(queried).toEqual([group.id]); // once per group, node and size
    controller.onReach({ type: 'reach', group: 'another', tick: 30, nodes: [], split: [] });
    expect(controller.ui.current.reach).toBeNull(); // an answer about another group is dropped
    controller.onReach({
      type: 'reach',
      group: group.id,
      tick: 30,
      nodes: [{ node: enemy.id, ticks: 25, path: [home, enemy.id] }],
      split: [other.id],
    });
    const overlay = controller.overlay();
    expect([overlay.reach, overlay.split]).toEqual([[enemy.id], [other.id]]);
    // The hovered reachable target shows the server's travel time as one number, nothing else.
    expect(controller.overlay().eta).toBeNull();
    controller.hover({ kind: 'node', id: enemy.id });
    expect(controller.overlay().eta).toEqual({ from: home, node: enemy.id, ticks: 25 });
    // Shift (a planned order): the delay before the group sets off comes on top.
    controller.key({ type: 'keydown', code: 'ShiftLeft', shiftKey: true });
    expect(controller.overlay().eta).toEqual({
      from: home,
      node: enemy.id,
      ticks: 25 + DEV_RULES.orders.planned_delay_ticks,
    });
    controller.key({ type: 'keyup', code: 'ShiftLeft', shiftKey: false });
    expect(controller.overlay().eta?.ticks).toBe(25);
    // A node the group must split for has no number (its ring is dashed).
    controller.hover({ kind: 'node', id: other.id });
    expect(controller.overlay().eta).toBeNull();
    controller.hover({ kind: 'node', id: enemy.id });
    // The answer is asked again after a while (ownership on the way changes).
    hud.onSnapshot({ ...snapshot, tick: snapshot.tick + REACH_REFRESH_TICKS });
    controller.overlay();
    expect(queried).toEqual([group.id, group.id]);
    // Deselected: the rings go.
    controller.deselect();
    expect(controller.overlay().reach).toEqual([]);
    expect(controller.overlay().eta).toBeNull();
    expect(controller.ui.current.reach).toBeNull();
  });

  it('splits with the menu on S: arrows set the amount, Enter splits, S closes (DEC-20)', () => {
    const { controller, sent, hud } = setup();
    const big = { ...group, units: 5, charged: 3 };
    hud.onSnapshot({ ...snapshot, view: { ...snapshot.view, groups: [big] } });
    controller.click({ kind: 'group', id: group.id }, false);
    expect(controller.key(down('KeyS'))).toBe(true);
    expect(controller.splitMenu.current).toMatchObject({ open: true, units: 5, n: 2 });
    controller.key(down('ArrowRight'));
    controller.key(down('ArrowRight'));
    controller.key(down('ArrowRight')); // at most units - 1
    expect(controller.splitMenu.current.n).toBe(4);
    controller.key(down('ArrowLeft'));
    expect(controller.key(down('KeyX'))).toBe(false); // a stray key does not order the group
    controller.key(down('Enter'));
    expect(sent).toEqual([{ type: 'split', group: group.id, n: 3 }]);
    expect(controller.splitMenu.current.open).toBe(false);
    controller.key(down('KeyS'));
    expect(controller.splitMenu.current.open).toBe(true);
    controller.key(down('KeyS')); // the same key closes it
    expect(controller.splitMenu.current.open).toBe(false);
    expect(sent).toHaveLength(1);
  });

  describe('after a split the split-off group is selected (#315)', () => {
    // The server names the new group only in the `group_split` event (the `ack` has no ids).
    const split = (from: string, created: string) =>
      ({
        type: 'event',
        tick: 31,
        kind: 'group_split',
        data: { player: 0, group: from, new_group: created, units: 3 },
      }) as const;
    const big = { ...group, units: 5, charged: 3 };
    const before: SnapshotMsg = { ...snapshot, view: { ...snapshot.view, groups: [big] } };
    // The same group and the new one beside it, as the snapshot after the split shows them.
    const after: SnapshotMsg = {
      ...snapshot,
      tick: 31,
      view: {
        ...snapshot.view,
        groups: [
          { ...big, units: 2, charged: 0 },
          { ...big, id: '9001', units: 3, charged: 3 },
        ],
      },
    };

    const splitSetup = () => {
      const env = setup();
      env.hud.onSnapshot(before);
      env.controller.click({ kind: 'group', id: group.id }, false);
      env.controller.toggleSplit();
      env.controller.confirmSplit();
      return env;
    };

    it('moves the selection to the new group once a snapshot shows it', () => {
      const { controller, hud, book } = splitSetup();
      book.onAck(ack(1));
      book.onEvent(split(group.id, '9001'));
      // The id is on no snapshot yet: nothing changes on screen.
      controller.overlay();
      expect(hud.selection).toEqual({ kind: 'group', id: group.id });
      hud.onSnapshot(after);
      controller.overlay();
      expect(hud.selection).toEqual({ kind: 'group', id: '9001' });
      expect(hud.current?.group).toMatchObject({ id: '9001', units: 3 });
    });

    it('takes the new group at once when the snapshot with it is already there', () => {
      const { controller, hud, book } = splitSetup();
      hud.onSnapshot(after);
      book.onEvent(split(group.id, '9001'));
      expect(hud.selection).toEqual({ kind: 'group', id: '9001' });
      expect(controller.groupMenu.current.open).toBe(false);
    });

    it('works when the event comes before the ack', () => {
      const { hud, book } = splitSetup();
      hud.onSnapshot(after);
      book.onEvent(split(group.id, '9001'));
      book.onAck(ack(1));
      expect(hud.selection).toEqual({ kind: 'group', id: '9001' });
    });

    it('a refused split selects nothing new', () => {
      const { hud, book } = splitSetup();
      book.onAck(ack(1, 'GROUP_BUSY'));
      hud.onSnapshot(after);
      book.onEvent(split(group.id, '9001'));
      expect(hud.selection).toEqual({ kind: 'group', id: group.id });
    });

    it('a player who selected something else meanwhile keeps their selection', () => {
      const { controller, hud, book } = splitSetup();
      book.onEvent(split(group.id, '9001'));
      hud.select({ kind: 'node', id: other.id });
      hud.onSnapshot(after);
      controller.overlay();
      expect(hud.selection).toEqual({ kind: 'node', id: other.id });
    });

    it('gives up when the new group never shows up', () => {
      const { controller, hud, book } = splitSetup();
      book.onEvent(split(group.id, '9001'));
      hud.onSnapshot({ ...before, tick: before.tick + FOLLOW_SPLIT_TICKS + 1 });
      controller.overlay();
      hud.onSnapshot({ ...after, tick: before.tick + FOLLOW_SPLIT_TICKS + 2 });
      controller.overlay();
      expect(hud.selection).toEqual({ kind: 'group', id: group.id });
    });

    it('the event of a group this player did not split changes nothing', () => {
      const { hud, book } = setup();
      hud.onSnapshot(after);
      hud.select({ kind: 'group', id: group.id });
      book.onEvent(split(group.id, '9001'));
      expect(hud.selection).toEqual({ kind: 'group', id: group.id });
    });
  });

  it('does not open the split menu for a single unit', () => {
    const { controller, hud } = setup();
    hud.onSnapshot({ ...snapshot, view: { ...snapshot.view, groups: [{ ...group, units: 1 }] } });
    controller.click({ kind: 'group', id: group.id }, false);
    controller.key(down('KeyS'));
    expect(controller.splitMenu.current.open).toBe(false);
  });

  it('merges the groups of the node on G (DEC-20)', () => {
    const { controller, sent, hud } = setup();
    const twin = { ...group, id: 'twin' };
    hud.onSnapshot({ ...snapshot, view: { ...snapshot.view, groups: [group, twin] } });
    controller.click({ kind: 'group', id: group.id }, false);
    expect(controller.key(down('KeyG'))).toBe(true);
    expect(sent).toEqual([{ type: 'merge', groups: [group.id, 'twin'] }]);
  });

  it('merges the selected group with the own groups in its node', () => {
    const { controller, sent, hud } = setup();
    const twin = { ...group, id: 'twin' };
    hud.onSnapshot({ ...snapshot, view: { ...snapshot.view, groups: [group, twin] } });
    controller.click({ kind: 'group', id: group.id }, false);
    expect(controller.mergeCandidates()).toEqual([group.id, 'twin']);
    controller.merge();
    expect(sent).toEqual([{ type: 'merge', groups: [group.id, 'twin'] }]);
  });

  it('merges from a selected node too: the groups standing in it (#212)', () => {
    const { controller, sent, hud } = setup();
    const twin = { ...group, id: 'twin' };
    hud.onSnapshot({ ...snapshot, view: { ...snapshot.view, groups: [group, twin] } });
    controller.click({ kind: 'node', id: home }, false);
    expect(controller.mergeCandidates()).toEqual([group.id, 'twin']);
    controller.merge();
    expect(sent).toEqual([{ type: 'merge', groups: [group.id, 'twin'] }]);
  });

  it('leaves out a group waiting on a planned order: the server rejects the whole merge (#212)', () => {
    const { controller, sent, hud } = setup();
    const twin = { ...group, id: 'twin' };
    const waiting = {
      ...group,
      id: 'waiting',
      order: { dest: enemy.id, path: [enemy.id], planned: true, bonus: 1 },
    } satisfies typeof group;
    hud.onSnapshot({ ...snapshot, view: { ...snapshot.view, groups: [group, twin, waiting] } });
    controller.click({ kind: 'group', id: group.id }, false);
    expect(controller.mergeCandidates()).toEqual([group.id, 'twin']);
    controller.merge();
    expect(sent).toEqual([{ type: 'merge', groups: [group.id, 'twin'] }]);
    controller.click({ kind: 'group', id: 'waiting' }, false);
    expect(controller.mergeCandidates()).toEqual([]);
  });

  it('keys 1 and 2 set the mode, R recruits, 3 does nothing (no "build" mode since DEC-16)', () => {
    const { controller, sent } = setup();
    controller.click({ kind: 'group', id: group.id }, false);
    for (const code of ['Digit1', 'Digit2', 'KeyR']) {
      expect(controller.key({ type: 'keydown', code, shiftKey: false })).toBe(true);
    }
    expect(controller.key({ type: 'keydown', code: 'Digit3', shiftKey: false })).toBe(false);
    expect(sent).toEqual([
      { type: 'set_mode', group: group.id, mode: 'attack' },
      { type: 'set_mode', group: group.id, mode: 'defense' },
      { type: 'recruit', node: home },
    ]);
  });

  describe('the road mode on U: a click on an own road raises it for CP (DEC-28, item 7; #315)', () => {
    // Roads of the home city, and one road elsewhere; two of the home roads can be upgraded.
    const homeRoads = map.edges.filter((e) => e.a === home || e.b === home).map((e) => e.id);
    const away = map.edges.find((e) => e.a !== home && e.b !== home)?.id;
    const [up1, up2] = homeRoads;
    if (up1 === undefined || up2 === undefined || away === undefined) {
      throw new Error('the map lacks roads around the home city');
    }
    // What a level gives (DEC-28, item 7): packet and unit speed, one more charge per period.
    const gain = { speed_pct: 50, unit_speed_pct: 15, amount: 1 };
    const build = { kind: 'road', width: 2, done_tick: 180 } as const;

    /** `up1`, `up2` carry the upgrade hint of the server (own internal, below the top level). */
    function withRoads(base: SnapshotMsg, building: readonly number[] = []) {
      return {
        ...base,
        view: {
          ...base.view,
          edges: base.view.edges.map((e) =>
            e.id === up1 || e.id === up2
              ? { ...e, upgrade_gain: gain, build: building.includes(e.id) ? build : null }
              : { ...e, upgrade_gain: null },
          ),
        },
      };
    }

    /** The road mode is on unless `mode` is false. */
    function roadSetup(building: readonly number[] = [], mode = true) {
      const env = setup();
      env.hud.onSnapshot(withRoads(snapshot, building));
      if (mode) env.controller.key(down('KeyU'));
      return env;
    }

    it('U turns the mode on and off; Esc leaves it before anything is deselected', () => {
      const { controller, hud } = roadSetup([], false);
      expect(controller.roadMode).toBe(false);
      expect(controller.key(down('KeyU'))).toBe(true);
      expect(controller.roadMode).toBe(true);
      // A held key does not flicker it.
      controller.key(down('KeyU', true));
      expect(controller.roadMode).toBe(true);
      controller.key(down('KeyU'));
      expect(controller.roadMode).toBe(false);
      controller.click({ kind: 'group', id: group.id }, false);
      controller.key(down('KeyU'));
      expect(controller.isIdle()).toBe(false);
      controller.key(down('Escape'));
      expect(controller.roadMode).toBe(false);
      expect(hud.selection).toEqual({ kind: 'group', id: group.id });
      controller.key(down('Escape'));
      expect(hud.selection).toBeNull();
    });

    it('works on the ordinary map and in the «Supply» mode alike, and Tab keeps the mode', () => {
      const { controller, sent } = roadSetup();
      controller.click({ kind: 'edge', id: up1, cell: home }, false);
      controller.key(down('Tab'));
      expect(controller.roadMode).toBe(true);
      controller.click({ kind: 'edge', id: up2, cell: home }, false);
      expect(sent).toEqual([
        { type: 'upgrade_road', edge: up1 },
        { type: 'upgrade_road', edge: up2 },
      ]);
      expect(controller.supplyMenu.current.open).toBe(false);
    });

    it('without the mode a click on a road upgrades nothing: it is the area of its city', () => {
      const { controller, sent, hud } = roadSetup([], false);
      controller.click({ kind: 'edge', id: up2, cell: home }, false);
      expect(sent).toEqual([]);
      expect(hud.selection).toEqual({ kind: 'node', id: home });
      controller.hover({ kind: 'edge', id: up2 });
      expect(controller.ui.current.roadHover).toBeNull();
      expect(controller.overlay().candidates).toEqual([]);
      // Left again, the mode no longer upgrades either.
      controller.key(down('KeyU'));
      controller.key(down('KeyU'));
      controller.click({ kind: 'edge', id: up2, cell: home }, false);
      expect(sent).toEqual([]);
    });

    it('sends upgrade_road(edge) at once, with no city and no type, and stays in the mode', () => {
      const { controller, sent, hud } = roadSetup();
      controller.click({ kind: 'edge', id: up2 }, false);
      expect(sent).toEqual([{ type: 'upgrade_road', edge: up2 }]);
      // Nothing was selected by it, the mode goes on.
      expect(hud.selection).toBeNull();
      expect(controller.roadMode).toBe(true);
      // Any own road the server offers is raised, not only the roads of one city.
      controller.click({ kind: 'edge', id: up1, cell: home }, false);
      expect(sent.at(-1)).toEqual({ type: 'upgrade_road', edge: up1 });
    });

    it('a road without the hint of the server (foreign, buffer, top level) sends nothing', () => {
      const { controller, sent, hud } = roadSetup();
      controller.click({ kind: 'edge', id: away, cell: other.id }, false);
      expect(sent).toEqual([]);
      // It is a click on the area of its city.
      expect(hud.selection).toEqual({ kind: 'node', id: other.id });
    });

    it('a road with a build going is not raised again: the click is the area of its city', () => {
      const { controller, sent } = roadSetup([up1]);
      controller.click({ kind: 'edge', id: up1, cell: home }, false);
      expect(sent).toEqual([]);
      expect(controller.ui.current.roadHover).toBeNull();
    });

    it('every road a click would raise is lit in the mode, and none out of it', () => {
      const { controller, hud } = roadSetup();
      expect(controller.overlay().candidates).toEqual([up1, up2].sort((x, y) => x - y));
      // The server stops offering one (a build started): it goes out.
      hud.onSnapshot(withRoads(snapshot, [up1]));
      expect(controller.overlay().candidates).toEqual([up2]);
      controller.key(down('KeyU'));
      expect(controller.overlay().candidates).toEqual([]);
    });

    it('the road under the pointer is described, only while a click would raise it', () => {
      const { controller } = roadSetup();
      controller.hover({ kind: 'edge', id: up2 });
      expect(controller.ui.current.roadHover).toBe(up2);
      controller.hover({ kind: 'edge', id: away });
      expect(controller.ui.current.roadHover).toBeNull();
      controller.hover({ kind: 'edge', id: up1 });
      controller.hover(null);
      expect(controller.ui.current.roadHover).toBeNull();
    });

    it('the description goes out when the server stops offering the road', () => {
      const { controller, hud } = roadSetup();
      controller.hover({ kind: 'edge', id: up1 });
      controller.overlay();
      expect(controller.ui.current.roadHover).toBe(up1);
      hud.onSnapshot(withRoads(snapshot, [up1]));
      controller.overlay();
      expect(controller.ui.current.roadHover).toBeNull();
    });

    it('with a group selected the road has the click in the mode, and the order out of it', () => {
      const { controller, sent } = roadSetup([], false);
      controller.click({ kind: 'group', id: group.id }, false);
      controller.key(down('KeyU'));
      controller.click({ kind: 'edge', id: up2, cell: other.id }, false);
      expect(sent).toEqual([{ type: 'upgrade_road', edge: up2 }]);
      controller.key(down('KeyU'));
      controller.click({ kind: 'edge', id: up2, cell: other.id }, false);
      expect(sent).toEqual([
        { type: 'upgrade_road', edge: up2 },
        { type: 'move', group: group.id, dest: other.id, planned: false },
      ]);
    });

    it('turning the mode on ends a transfer pick and closes the menus; the city stays selected', () => {
      const { controller, hud } = roadSetup([], false);
      controller.click({ kind: 'node', id: home }, false);
      expect(controller.cityMenu.current.open).toBe(true);
      controller.key(down('KeyU'));
      expect(controller.cityMenu.current.open).toBe(false);
      expect(hud.selection).toEqual({ kind: 'node', id: home });
      controller.ui.patch({ transferFrom: home });
      controller.key(down('KeyU'));
      controller.key(down('KeyU'));
      expect(controller.ui.current.transferFrom).toBeNull();
    });

    it('a transfer pick keeps the click while it lasts', () => {
      const { controller, sent } = roadSetup();
      controller.ui.patch({ transferFrom: home });
      controller.click({ kind: 'edge', id: up2, cell: home }, false);
      expect(sent).toEqual([]);
    });

    it('sends nothing without a match to send to', () => {
      const env = setup(false);
      env.hud.onSnapshot(withRoads(snapshot));
      env.controller.key(down('KeyU'));
      env.controller.hover({ kind: 'edge', id: up2 });
      env.controller.click({ kind: 'edge', id: up2 }, false);
      expect(env.controller.ui.current.roadHover).toBeNull();
      expect(env.controller.overlay().candidates).toEqual([]);
      expect(env.sent).toEqual([]);
    });

    it("the price and the build time are the ruleset numbers, not the controller's", () => {
      const { controller } = roadSetup();
      expect(controller.roadCost).toBe(RULES.cost.build);
      expect(controller.roadBuildTicks).toBe(RULES.build.ticks_per_level);
      const rules: RulesetPublic = {
        ...RULES,
        cost: { ...RULES.cost, build: 70 },
        build: { ticks_per_level: 90 },
      };
      const hud = new HudState({ me: 0, nicks: ['Danya', 'Bot'], rules, map });
      const priced = new OrderController({
        hud,
        map,
        rules,
        book: new OrderBook(),
        send: null,
        now: () => 0,
        alerts: hud.alerts,
        focusNode: () => undefined,
        queryReach: () => undefined,
      });
      expect(priced.roadCost).toBe(70);
      expect(priced.roadBuildTicks).toBe(90);
    });

    it('a refusal of the server is shown as for any command', () => {
      const { controller, book } = roadSetup();
      controller.click({ kind: 'edge', id: up2 }, false);
      book.onAck(ack(1, 'NOT_ENOUGH_CP'));
      expect(controller.ui.current.notice).toMatchObject({
        kind: 'rejected',
        code: 'NOT_ENOUGH_CP',
        cmd: { type: 'upgrade_road', edge: up2 },
      });
    });
  });

  describe('the stance menu on Q', () => {
    const current = snapshot.view.me.stance;
    const target = current === 'war' ? 'economy' : 'war';

    it('opens on Q, and a hold released over a sector chooses it', () => {
      const { controller, sent, clock } = setup();
      expect(controller.key(down('KeyQ'))).toBe(true);
      expect(controller.radial.current).toMatchObject({ open: true, sticky: false });
      // A repeat of the held key changes nothing.
      expect(controller.key(down('KeyQ', true))).toBe(true);
      controller.radial.hover(target);
      clock.now = RADIAL.tapMs + 1;
      expect(controller.key(up('KeyQ'))).toBe(true);
      expect(controller.radial.current.open).toBe(false);
      expect(sent).toEqual([{ type: 'set_stance', stance: target }]);
    });

    it('cancels a hold released in the dead zone', () => {
      const { controller, sent, clock } = setup();
      controller.key(down('KeyQ'));
      clock.now = 500;
      controller.key(up('KeyQ'));
      expect(controller.radial.current.open).toBe(false);
      expect(sent).toEqual([]);
    });

    it('stays open after a tap and chooses by 1 / 2 / 3, not as modes', () => {
      const { controller, sent, clock } = setup();
      controller.key(down('KeyQ'));
      clock.now = RADIAL.tapMs - 1;
      controller.key(up('KeyQ'));
      expect(controller.radial.current).toMatchObject({ open: true, sticky: true });
      controller.key(down('Digit3'));
      expect(controller.radial.current.open).toBe(false);
      expect(sent).toEqual(current === 'war' ? [] : [{ type: 'set_stance', stance: 'war' }]);
      // Closed again: 1 is the mode of the selected group.
      controller.click({ kind: 'group', id: group.id }, false);
      controller.key(down('Digit1'));
      expect(sent.at(-1)).toMatchObject({ type: 'set_mode' });
    });

    it('closes on Esc or on a second Q, and does not resend the current stance', () => {
      const { controller, sent, clock } = setup();
      controller.key(down('KeyQ'));
      clock.now = 10;
      controller.key(up('KeyQ'));
      expect(controller.key(down('Escape'))).toBe(true);
      expect(controller.radial.current.open).toBe(false);
      controller.openRadial(true);
      controller.key(down('KeyQ'));
      expect(controller.radial.current.open).toBe(false);
      controller.chooseStance(current);
      expect(sent).toEqual([]);
    });

    it('a lost window focus cancels a hold, and there is no menu without a match', () => {
      const { controller, sent } = setup();
      controller.key(down('KeyQ'));
      controller.key({ type: 'keyup', code: '', shiftKey: false });
      expect(controller.radial.current.open).toBe(false);
      expect(sent).toEqual([]);
      const lone = setup(false).controller;
      lone.key(down('KeyQ'));
      expect(lone.radial.current.open).toBe(false);
    });

    it('serves the numbers of the ruleset of welcome', () => {
      const { controller } = setup();
      expect(controller.stanceRates.map((r) => [r.cpPerMinCenti / 100, r.chargesPerMin])).toEqual([
        [3, 18],
        [6, 12],
        [9, 6],
      ]);
    });
  });

  it('Space takes the camera to the next alert, and is not taken without one', () => {
    const { controller, focused, hud } = setup();
    expect(controller.key(down('Space'))).toBe(false);
    const aimed = snapshot.view.nodes.find((n) => n.owner === 0);
    if (aimed === undefined) throw new Error('no own node');
    hud.onSnapshot({
      ...snapshot,
      view: {
        ...snapshot.view,
        intents: [
          {
            id: 'i1',
            owner: 1,
            kind: 'planned_move',
            origin: enemy.id,
            target: aimed.id,
            created_tick: snapshot.tick,
          },
        ],
      },
    });
    expect(controller.key(down('Space'))).toBe(true);
    expect(focused).toEqual([aimed.id]);
  });

  describe('supply map mode (DEC-18)', () => {
    const city = home;
    const target = other.id;

    it('Tab and F2 toggle the mode; the overlay carries it', () => {
      const { controller } = setup();
      expect(controller.overlay().supply).toBeNull();
      expect(controller.key(down('Tab'))).toBe(true);
      expect(controller.supplyMode).toBe(true);
      expect(controller.overlay().supply).toEqual({ source: null, targets: [] });
      expect(controller.key(down('Tab', true))).toBe(true); // a held key does not flip it back
      expect(controller.supplyMode).toBe(true);
      controller.key(down('F2'));
      expect(controller.supplyMode).toBe(false);
      expect(controller.overlay().supply).toBeNull();
    });

    it('a click on an own city opens its menu; a key with no sector chooses nothing', () => {
      const { controller, sent } = setup();
      controller.key(down('Tab'));
      controller.click({ kind: 'node', id: city }, false);
      expect(controller.supplyMenu.current).toMatchObject({ open: true, node: city });
      controller.key(down('Digit4')); // no such sector: nothing is chosen, nothing is sent
      expect(controller.supplyMenu.current.open).toBe(true);
      expect(sent).toEqual([]);
    });

    it('Esc closes the menu; an enemy node opens nothing', () => {
      const { controller, sent } = setup();
      controller.key(down('Tab'));
      controller.click({ kind: 'node', id: city }, false);
      controller.key(down('Escape'));
      expect(controller.supplyMenu.current.open).toBe(false);
      controller.click({ kind: 'node', id: enemy.id }, false);
      expect(controller.supplyMenu.current.open).toBe(false);
      expect(sent).toEqual([]);
    });

    it('transfer: pick the source in the menu, click the destination, choose the amount', () => {
      const { controller, sent } = setup();
      controller.key(down('Tab'));
      controller.click({ kind: 'node', id: city }, false);
      controller.key(down('Digit3'));
      expect(controller.ui.current.transferFrom).toBe(city);
      const overlay = controller.overlay().supply;
      expect(overlay?.source).toBe(city);
      expect(overlay?.targets).toContain(target);
      expect(overlay?.targets).not.toContain(city);
      controller.click({ kind: 'node', id: target }, false);
      expect(controller.ui.current.transferFrom).toBeNull();
      const stock = snapshot.view.nodes[city]?.warehouse ?? 0;
      const there = snapshot.view.nodes[target];
      const room = (there?.warehouse_cap ?? 0) - (there?.warehouse ?? 0);
      expect(controller.transfer.current).toMatchObject({
        open: true,
        from: city,
        to: target,
        max: Math.min(stock, room),
      });
      controller.setTransferAmount(1);
      controller.confirmTransfer();
      expect(controller.transfer.current.open).toBe(false);
      expect(sent).toEqual(
        stock > 0 ? [{ type: 'transfer', from_node: city, to_node: target, n: 1 }] : [],
      );
    });

    it('the slider offers no more than the free room of the target warehouse', () => {
      const { hud, controller } = setup();
      const cap = snapshot.view.nodes.find((n) => n.id === target)?.warehouse_cap ?? 0;
      const stock = snapshot.view.nodes.find((n) => n.id === city)?.warehouse ?? 0;
      // The target holds all but 2 of its capacity (the source has more than 2 to give).
      const filled = (held: number): SnapshotMsg => ({
        ...snapshot,
        view: {
          ...snapshot.view,
          nodes: snapshot.view.nodes.map((n) =>
            n.id === target
              ? { ...n, warehouse: held }
              : n.id === city
                ? { ...n, warehouse: 9 }
                : n,
          ),
        },
      });
      expect(stock).toBeGreaterThanOrEqual(0);
      hud.onSnapshot(filled(cap - 2));
      controller.key(down('Tab'));
      controller.click({ kind: 'node', id: city }, false);
      controller.chooseSupply();
      controller.click({ kind: 'node', id: target }, false);
      expect(controller.transfer.current).toMatchObject({ open: true, max: 2, full: false });
      // No room at all: nothing to send, the dialog says why.
      controller.closeTransfer();
      hud.onSnapshot(filled(cap));
      controller.click({ kind: 'node', id: city }, false);
      controller.chooseSupply();
      controller.click({ kind: 'node', id: target }, false);
      expect(controller.transfer.current).toMatchObject({ open: true, max: 0, full: true });
      controller.confirmTransfer();
      expect(controller.transfer.current.open).toBe(false);
    });

    it('the amount stays within 1..warehouse', () => {
      const { controller } = setup();
      controller.transfer.open(city, target, 4);
      controller.setTransferAmount(99);
      expect(controller.transfer.current.n).toBe(4);
      controller.setTransferAmount(0);
      expect(controller.transfer.current.n).toBe(1);
    });

    it('Esc or a click elsewhere ends the transfer pick without a command', () => {
      const { controller, sent } = setup();
      controller.key(down('Tab'));
      controller.click({ kind: 'node', id: city }, false);
      controller.chooseSupply();
      controller.key(down('Escape'));
      expect(controller.ui.current.transferFrom).toBeNull();
      controller.click({ kind: 'node', id: city }, false);
      controller.chooseSupply();
      controller.click({ kind: 'node', id: enemy.id }, false);
      expect(controller.ui.current.transferFrom).toBeNull();
      expect(controller.transfer.current.open).toBe(false);
      expect(sent).toEqual([]);
    });

    describe('front markers and the rear minimum (DEC-28, items 2 and 3)', () => {
      const withFronts = (fronts: [number | null, number | null], rearMin = 1): SnapshotMsg => ({
        ...snapshot,
        view: { ...snapshot.view, me: { ...snapshot.view.me, fronts, rear_min: rearMin } },
      });

      it('key 1 of the menu puts marker 1 on the city, key 2 marker 2, and the menu closes', () => {
        const { controller, sent } = setup();
        controller.key(down('Tab'));
        controller.click({ kind: 'node', id: city }, false);
        controller.key(down('Digit1'));
        expect(controller.supplyMenu.current.open).toBe(false);
        controller.click({ kind: 'node', id: city }, false);
        controller.key(down('Digit2'));
        expect(sent).toEqual([
          { type: 'set_front', marker: 0, node: city },
          { type: 'set_front', marker: 1, node: city },
        ]);
      });

      it('a click on a sector sends the same command as its key', () => {
        const { controller, sent } = setup();
        controller.key(down('Tab'));
        controller.click({ kind: 'node', id: city }, false);
        controller.chooseSupply('front1');
        expect(sent).toEqual([{ type: 'set_front', marker: 1, node: city }]);
      });

      it('a marker standing elsewhere is moved to the city (free, no confirmation)', () => {
        const { controller, hud, sent } = setup();
        hud.onSnapshot(withFronts([target, null]));
        controller.key(down('Tab'));
        controller.click({ kind: 'node', id: city }, false);
        controller.chooseSupply('front0');
        expect(sent).toEqual([{ type: 'set_front', marker: 0, node: city }]);
      });

      it('the marker that stands on the city is taken off (node = null)', () => {
        const { controller, hud, sent } = setup();
        hud.onSnapshot(withFronts([city, null]));
        controller.key(down('Tab'));
        controller.click({ kind: 'node', id: city }, false);
        expect(controller.supplyMenu.current.fronts).toEqual([city, null]);
        controller.chooseSupply('front0');
        expect(sent).toEqual([{ type: 'set_front', marker: 0, node: null }]);
      });

      it('a city that holds the other marker takes none: nothing is sent', () => {
        const { controller, hud, sent } = setup();
        hud.onSnapshot(withFronts([null, city]));
        controller.key(down('Tab'));
        controller.click({ kind: 'node', id: city }, false);
        controller.key(down('Digit1'));
        expect(sent).toEqual([]);
      });

      it('has as many markers as the ruleset says, and no key for a missing one', () => {
        const rules: RulesetPublic = { ...RULES, supply: { ...RULES.supply, front_markers: 1 } };
        const hud = new HudState({ me: 0, nicks: ['Danya', 'Bot'], rules, map });
        hud.onSnapshot(snapshot);
        const sent: Command[] = [];
        const controller = new OrderController({
          hud,
          map,
          rules,
          book: new OrderBook(),
          send: (cmd) => sent.push(cmd),
          now: () => 0,
          alerts: hud.alerts,
          focusNode: () => undefined,
          queryReach: () => undefined,
        });
        expect(setup().controller.frontMarkers).toBe(RULES.supply.front_markers);
        expect(controller.frontMarkers).toBe(1);
        controller.key(down('Tab'));
        controller.click({ kind: 'node', id: city }, false);
        controller.key(down('Digit2'));
        expect(controller.supplyMenu.current.open).toBe(true);
        expect(sent).toEqual([]);
        controller.toggleFront(1, city);
        expect(sent).toEqual([]);
        controller.key(down('Digit1'));
        expect(sent).toEqual([{ type: 'set_front', marker: 0, node: city }]);
      });

      it('the price of a marker is the ruleset one', () => {
        expect(setup().controller.frontCost).toBe(RULES.cost.front);
      });

      it('a refusal of the server is shown as for any command', () => {
        const { controller, book } = setup();
        controller.key(down('Tab'));
        controller.click({ kind: 'node', id: city }, false);
        controller.key(down('Digit1'));
        book.onAck(ack(1, 'NOT_OWNER'));
        expect(controller.ui.current.notice).toMatchObject({
          kind: 'rejected',
          code: 'NOT_OWNER',
          cmd: { type: 'set_front' },
        });
      });

      it('the rear minimum slider sends set_rear_min, within 0..rear_min_max, and only on a change', () => {
        const { controller, hud, sent } = setup();
        hud.onSnapshot(withFronts([null, null], 1));
        expect(controller.rearMin).toBe(1);
        expect(controller.rearMinMax).toBe(RULES.supply.rear_min_max);
        controller.setRearMin(1);
        expect(sent).toEqual([]);
        controller.setRearMin(3);
        controller.setRearMin(99);
        controller.setRearMin(-4);
        controller.setRearMin(Number.NaN);
        expect(sent).toEqual([
          { type: 'set_rear_min', n: 3 },
          { type: 'set_rear_min', n: RULES.supply.rear_min_max },
          { type: 'set_rear_min', n: 0 },
        ]);
      });

      it('[ and ] lower and raise the rear minimum by one on the supply layer only', () => {
        const { controller, hud, sent } = setup();
        hud.onSnapshot(withFronts([null, null], 2));
        // Off the layer the keys are not the supply's.
        expect(controller.key(down('BracketRight'))).toBe(false);
        expect(sent).toEqual([]);
        controller.key(down('Tab'));
        expect(controller.key(down('BracketRight'))).toBe(true);
        expect(sent).toEqual([{ type: 'set_rear_min', n: 3 }]);
        // The snapshot confirms it; the next press goes on from there.
        hud.onSnapshot(withFronts([null, null], 3));
        controller.key(down('BracketLeft'));
        expect(sent.at(-1)).toEqual({ type: 'set_rear_min', n: 2 });
        // A held key is one step, as for the other keys.
        controller.key(down('BracketLeft', true));
        expect(sent).toHaveLength(2);
      });

      it('two quick presses before the snapshot are two steps, not one sent twice', () => {
        const { controller, hud, sent } = setup();
        hud.onSnapshot(withFronts([null, null], 1));
        controller.key(down('Tab'));
        controller.key(down('BracketRight'));
        controller.key(down('BracketRight'));
        expect(sent).toEqual([
          { type: 'set_rear_min', n: 2 },
          { type: 'set_rear_min', n: 3 },
        ]);
      });

      it('stops at the ends: never below 0 and never above rear_min_max, nothing sent there', () => {
        const { controller, hud, sent } = setup();
        hud.onSnapshot(withFronts([null, null], 0));
        controller.key(down('Tab'));
        controller.key(down('BracketLeft'));
        expect(sent).toEqual([]);
        hud.onSnapshot(withFronts([null, null], RULES.supply.rear_min_max));
        controller.key(down('BracketRight'));
        expect(sent).toEqual([]);
      });

      it('does nothing while the transfer dialog is open (its own keys)', () => {
        const { controller, hud, sent } = setup();
        hud.onSnapshot(withFronts([null, null], 1));
        controller.key(down('Tab'));
        controller.transfer.open(city, target, 2);
        controller.key(down('BracketRight'));
        expect(sent).toEqual([]);
      });
    });

    it('reports the arrival tick of an accepted transfer from the ack', () => {
      const { controller, book } = setup();
      const seen: (number | null | undefined)[] = [];
      controller.ui.onFeedback((f) => {
        if (f.kind === 'accepted') seen.push(f.arriveTick);
      });
      controller.transfer.open(city, target, 3);
      controller.confirmTransfer();
      book.onAck({
        type: 'ack',
        seq: 1,
        applied_tick: 31,
        path: [city, target],
        arrive_tick: 91,
        reject_code: null,
      });
      expect(seen).toEqual([91]);
    });
  });
});

describe('radial menus of a city and of a group (UI round 2)', () => {
  const key = (code: string) => ({ type: 'keydown', code, shiftKey: false }) as const;

  it('opens the menu of an own city on a click, and closes it on a second click on the city', () => {
    const { controller, hud } = setup();
    controller.click({ kind: 'node', id: home }, false);
    expect(hud.selection).toEqual({ kind: 'node', id: home });
    expect(controller.cityMenu.current).toMatchObject({ open: true, target: home });
    controller.click({ kind: 'node', id: home }, false);
    expect(controller.cityMenu.current.open).toBe(false);
    expect(hud.selection).toBeNull(); // the highlight goes with the menu (#426)
  });

  it('the highlight of the city goes off with its menu in every way it closes (#426)', () => {
    // A key: Esc closes the menu and drops the selection.
    const a = setup();
    a.controller.click({ kind: 'node', id: home }, false);
    a.controller.key(key('Escape'));
    expect(a.controller.cityMenu.current.open).toBe(false);
    expect(a.hud.selection).toBeNull();
    // A click outside the menu: on empty map (the menu is not modal), on the city again, or the
    // menu's own close (the ring lost its anchor).
    const b = setup();
    b.controller.click({ kind: 'node', id: home }, false);
    b.controller.click(null, false);
    expect(b.controller.cityMenu.current.open).toBe(false);
    expect(b.hud.selection).toBeNull();
    b.controller.click({ kind: 'node', id: home }, false);
    b.controller.click({ kind: 'node', id: home }, false);
    expect(b.controller.cityMenu.current.open).toBe(false);
    expect(b.hud.selection).toBeNull();
    b.controller.click({ kind: 'node', id: home }, false);
    b.controller.closeCityMenu();
    expect(b.controller.cityMenu.current.open).toBe(false);
    expect(b.hud.selection).toBeNull();
    // The barracks and the warehouse close the menu with the city; recruiting does not (#450).
    for (const choice of ['barracks', 'warehouse'] as const) {
      const c = setup();
      c.controller.click({ kind: 'node', id: home }, false);
      c.controller.chooseCity(choice);
      expect(c.sent).toHaveLength(1);
      expect(c.controller.cityMenu.current.open).toBe(false);
      expect(c.hud.selection).toBeNull();
    }
  });

  it('recruiting keeps the menu open and the city selected, so the next one needs no new click (#450)', () => {
    // A sector, twice, then the key R, then the key X (cancel): every one reaches the server.
    const { controller, hud, sent } = setup();
    controller.click({ kind: 'node', id: home }, false);
    controller.chooseCity('recruit');
    controller.chooseCity('recruit');
    controller.key(key('KeyR'));
    controller.key(key('KeyX'));
    controller.chooseCity('recruit');
    expect(sent).toEqual([
      { type: 'recruit', node: home },
      { type: 'recruit', node: home },
      { type: 'recruit', node: home },
      { type: 'cancel_recruit', node: home },
      { type: 'recruit', node: home },
    ]);
    expect(controller.cityMenu.current).toMatchObject({ open: true, target: home });
    expect(hud.selection).toEqual({ kind: 'node', id: home });
    // The #426 ways out still work after recruiting: Esc, then again a second click on the city.
    controller.key(key('Escape'));
    expect(controller.cityMenu.current.open).toBe(false);
    expect(hud.selection).toBeNull();
    controller.click({ kind: 'node', id: home }, false);
    controller.chooseCity('recruit');
    controller.click({ kind: 'node', id: home }, false);
    expect(controller.cityMenu.current.open).toBe(false);
    expect(hud.selection).toBeNull();
    controller.click({ kind: 'node', id: home }, false);
    controller.chooseCity('recruit');
    controller.click(null, false);
    expect(controller.cityMenu.current.open).toBe(false);
    expect(hud.selection).toBeNull();
  });

  it('closing a city menu does not touch another selection', () => {
    const { controller, hud } = setup();
    controller.click({ kind: 'node', id: home }, false);
    controller.closeCityMenu(); // closed and dropped
    controller.click({ kind: 'group', id: group.id }, false);
    controller.closeCityMenu(); // nothing open: the group stays selected
    expect(hud.selection).toEqual({ kind: 'group', id: group.id });
  });

  it('opens no city menu on an enemy city, or without a match to send to', () => {
    const a = setup();
    a.controller.click({ kind: 'node', id: enemy.id }, false);
    expect(a.controller.cityMenu.current.open).toBe(false);
    const b = setup(false);
    b.controller.click({ kind: 'node', id: home }, false);
    expect(b.controller.cityMenu.current.open).toBe(false);
  });

  it('a sector of the city menu does what its key does: recruit', () => {
    const { controller, sent } = setup();
    controller.click({ kind: 'node', id: home }, false);
    controller.chooseCity('recruit');
    expect(sent).toEqual([{ type: 'recruit', node: home }]);
  });

  it('the key R keeps the menu of the city open (#450)', () => {
    const { controller } = setup();
    controller.click({ kind: 'node', id: home }, false);
    controller.key(down('KeyR'));
    expect(controller.cityMenu.current.open).toBe(true);
  });

  it('the first click on a group only selects it, a second opens its menu, a third closes it', () => {
    const { controller, hud } = setup();
    controller.click({ kind: 'group', id: group.id }, false);
    expect(hud.selection).toEqual({ kind: 'group', id: group.id });
    expect(controller.groupMenu.current.open).toBe(false); // no ring in the way of an order
    controller.click({ kind: 'group', id: group.id }, false);
    expect(controller.groupMenu.current).toMatchObject({ open: true, target: group.id });
    controller.click({ kind: 'group', id: group.id }, false);
    expect(controller.groupMenu.current.open).toBe(false);
    expect(hud.selection).toEqual({ kind: 'group', id: group.id });
  });

  it('a click on another node orders the group and closes its menu', () => {
    const { controller, sent } = setup();
    controller.click({ kind: 'group', id: group.id }, false);
    controller.click({ kind: 'group', id: group.id }, false);
    expect(controller.groupMenu.current.open).toBe(true);
    controller.click({ kind: 'node', id: other.id }, false);
    expect(controller.groupMenu.current.open).toBe(false);
    expect(sent).toEqual([{ type: 'move', group: group.id, dest: other.id, planned: false }]);
  });

  it('a sector of the group menu does what its key does', () => {
    const { controller, sent } = setup();
    controller.click({ kind: 'group', id: group.id }, false);
    controller.click({ kind: 'group', id: group.id }, false);
    controller.chooseGroup('cancel');
    expect(sent.at(-1)).toEqual({ type: 'cancel_order', group: group.id });
    expect(controller.groupMenu.current.open).toBe(false);
    controller.click({ kind: 'group', id: group.id }, false); // cancelling let the group go
    controller.click({ kind: 'group', id: group.id }, false);
    controller.chooseGroup('defense');
    expect(sent.at(-1)).toEqual({ type: 'set_mode', group: group.id, mode: 'defense' });
    controller.chooseGroup('split');
    expect(controller.splitMenu.current.open).toBe(true);
    expect(controller.groupMenu.current.open).toBe(false);
  });

  it('D toggles the defense of the selected group', () => {
    const { controller, sent } = setup();
    controller.click({ kind: 'group', id: group.id }, false);
    expect(controller.key(key('KeyD'))).toBe(true);
    expect(sent).toEqual([{ type: 'set_mode', group: group.id, mode: 'defense' }]);
  });

  it('Esc deselects and closes the menus; the menu goes when the selection moves on', () => {
    const { controller, hud } = setup();
    controller.click({ kind: 'group', id: group.id }, false);
    controller.click({ kind: 'group', id: group.id }, false);
    controller.key(key('Escape'));
    expect(hud.selection).toBeNull();
    expect(controller.groupMenu.current.open).toBe(false);
    controller.click({ kind: 'node', id: home }, false);
    hud.select(null);
    controller.overlay(); // the frame loop syncs the menus with the selection
    expect(controller.cityMenu.current.open).toBe(false);
  });

  it('is idle only with nothing selected and no menu or pick open (the double Esc asks to leave)', () => {
    const { controller } = setup();
    expect(controller.isIdle()).toBe(true);
    controller.click({ kind: 'group', id: group.id }, false);
    expect(controller.isIdle()).toBe(false);
    controller.deselect();
    expect(controller.isIdle()).toBe(true);
    controller.openRadial(true);
    expect(controller.isIdle()).toBe(false);
    controller.closeRadial();
    expect(controller.isIdle()).toBe(true);
  });
});
