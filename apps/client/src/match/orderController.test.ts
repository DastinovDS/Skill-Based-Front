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
const RULES: RulesetPublic = { ...DEV_RULES };
const snapshot = devSnapshot(map, RULES, 30);
const group = snapshot.view.groups[0];
if (group?.location.kind !== 'node') throw new Error('the dev snapshot has no group in a node');
const home = group.location.node;
const enemy = snapshot.view.nodes.find((n) => n.owner === 1 && n.detail === 'exact');
const other = snapshot.view.nodes.find((n) => n.id !== home && n.owner === 0);
if (enemy === undefined || other === undefined) throw new Error('the dev snapshot lacks nodes');

function setup(withSend = true) {
  const hud = new HudState({ me: 0, nicks: ['Ember', 'Bot'], rules: RULES, map });
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
  ({
    type: 'ack',
    seq,
    applied_tick: 31,
    path: null,
    arrive_tick: null,
    reject_code,
    kind: null,
    cost: null,
    members: null,
  }) as const;

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

  it('orders the selected group to a clicked node: normal, then planned with E held', () => {
    const { controller, sent, book } = setup();
    controller.click({ kind: 'group', id: group.id }, false);
    controller.click({ kind: 'node', id: enemy.id }, false);
    controller.click({ kind: 'group', id: group.id }, false); // the order let the group go
    controller.key({ type: 'keydown', code: 'KeyE', shiftKey: false });
    controller.click({ kind: 'node', id: other.id }, false);
    expect(sent).toEqual([
      { type: 'move', group: group.id, dest: enemy.id, planned: false, bonus: 0 },
      { type: 'move', group: group.id, dest: other.id, planned: true, bonus: 1 },
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

  it('key P with a group selected does nothing: E+click is the way to a planned order (#213)', () => {
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
    controller.click({ kind: 'node', id: other.id }, false);
    expect(hud.selection).toEqual({ kind: 'node', id: other.id });
  });

  it('previews only a target the server says the group reaches (#793), no combat estimate', () => {
    const { controller } = setup();
    controller.click({ kind: 'group', id: group.id }, false);
    controller.hover({ kind: 'node', id: enemy.id });
    // No `reach` answer yet: no ghost of the order (the client works out no path).
    expect(controller.overlay().preview).toBeNull();
    controller.onReach({
      type: 'reach',
      group: group.id,
      tick: 30,
      nodes: [{ node: enemy.id, ticks: 25, path: [home, enemy.id] }],
      split: [],
    });
    expect(controller.overlay().preview).toEqual({
      from: home,
      to: enemy.id,
      planned: false,
      path: [home, enemy.id],
    });
    controller.key({ type: 'keydown', code: 'KeyE', shiftKey: false });
    expect(controller.overlay().preview).toEqual({
      from: home,
      to: enemy.id,
      planned: true,
      path: [home, enemy.id],
    });
    // A node the answer does not list: no ghost.
    controller.hover({ kind: 'node', id: other.id });
    expect(controller.overlay().preview).toBeNull();
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
    controller.split(1);
    controller.recruit();
    controller.setStance('economy');
    controller.forfeit();
    expect(sent).toEqual([
      { type: 'split', group: group.id, n: 1 },
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
      nodes: [{ node: enemy.id, ticks: 25, path: [home, other.id, enemy.id] }],
      split: [{ node: other.id, units: 0 }],
    });
    const overlay = controller.overlay();
    expect([overlay.reach, overlay.split]).toEqual([[enemy.id], [other.id]]);
    // The hovered reachable target shows the server's travel time as one number, nothing else.
    expect(controller.overlay().eta).toBeNull();
    controller.hover({ kind: 'node', id: enemy.id });
    // The route the server gave comes with it, for the highlight and the place of the label (#448).
    expect(controller.overlay().eta).toEqual({
      from: home,
      node: enemy.id,
      ticks: 25,
      path: [home, other.id, enemy.id],
    });
    expect(controller.overlay().preview?.path).toEqual([home, other.id, enemy.id]);
    // E (a planned order): the delay before the group sets off comes on top.
    controller.key({ type: 'keydown', code: 'KeyE', shiftKey: false });
    expect(controller.overlay().eta).toEqual({
      from: home,
      node: enemy.id,
      ticks: 25, // a plan gathers its bonus, no fixed delay
      path: [home, other.id, enemy.id],
    });
    controller.key({ type: 'keyup', code: 'KeyE', shiftKey: false });
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

  it('points at a hovered target the group is too big for, before any order is sent (#468)', () => {
    const { controller, sent } = setup();
    controller.click({ kind: 'group', id: group.id }, false);
    controller.overlay();
    controller.onReach({
      type: 'reach',
      group: group.id,
      tick: 30,
      nodes: [{ node: enemy.id, ticks: 25, path: [home, other.id, enemy.id] }],
      split: [{ node: other.id, units: 0 }],
    });
    // Nothing hovered: no hint.
    controller.overlay();
    expect(controller.ui.current.splitHover).toBeNull();
    // A target the server lists under `split`: the hint, from the server's list only.
    controller.hover({ kind: 'node', id: other.id });
    controller.overlay();
    expect(controller.ui.current.splitHover).toBe(other.id);
    // A reachable target and the group's own node: no hint.
    controller.hover({ kind: 'node', id: enemy.id });
    controller.overlay();
    expect(controller.ui.current.splitHover).toBeNull();
    controller.hover({ kind: 'node', id: other.id });
    controller.overlay();
    controller.hover({ kind: 'node', id: home });
    controller.overlay();
    expect(controller.ui.current.splitHover).toBeNull();
    // The pointer leaves, or the group is let go: the hint goes.
    controller.hover({ kind: 'node', id: other.id });
    controller.overlay();
    controller.hover(null);
    controller.overlay();
    expect(controller.ui.current.splitHover).toBeNull();
    controller.hover({ kind: 'node', id: other.id });
    controller.overlay();
    controller.deselect();
    controller.overlay();
    expect(controller.ui.current.splitHover).toBeNull();
    // Hovering sends nothing.
    expect(sent).toEqual([]);
  });

  it('has no hint without an answer of the server: it computes nothing itself (#468)', () => {
    const { controller } = setup();
    controller.click({ kind: 'group', id: group.id }, false);
    controller.hover({ kind: 'node', id: other.id });
    controller.overlay();
    expect(controller.ui.current.splitHover).toBeNull();
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
      order: {
        dest: enemy.id,
        path: [enemy.id],
        planned: true,
        bonus: 1,
        gathering: false,
        plan: 0,
        next_charge_tick: null,
        depart_tick: null,
        group_order: null,
        arrive_tick: null,
      },
    } satisfies typeof group;
    hud.onSnapshot({ ...snapshot, view: { ...snapshot.view, groups: [group, twin, waiting] } });
    controller.click({ kind: 'group', id: group.id }, false);
    expect(controller.mergeCandidates()).toEqual([group.id, 'twin']);
    controller.merge();
    expect(sent).toEqual([{ type: 'merge', groups: [group.id, 'twin'] }]);
    controller.click({ kind: 'group', id: 'waiting' }, false);
    expect(controller.mergeCandidates()).toEqual([]);
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

    it('stays open after a tap and chooses by 1 / 2 / 3', () => {
      const { controller, sent, clock } = setup();
      controller.key(down('KeyQ'));
      clock.now = RADIAL.tapMs - 1;
      controller.key(up('KeyQ'));
      expect(controller.radial.current).toMatchObject({ open: true, sticky: true });
      controller.key(down('Digit3'));
      expect(controller.radial.current.open).toBe(false);
      expect(sent).toEqual(current === 'war' ? [] : [{ type: 'set_stance', stance: 'war' }]);
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
        [3, 6],
        [6, 3],
        [7.5, 1.5],
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

  describe('terrain map mode (#429)', () => {
    it('T toggles the mode; the overlay carries it; a held key does not flip it back', () => {
      const { controller } = setup();
      expect(controller.overlay().terrain).toBe(false);
      expect(controller.key(down('KeyT'))).toBe(true);
      expect(controller.terrainMode).toBe(true);
      expect(controller.overlay().terrain).toBe(true);
      controller.key(down('KeyT', true));
      expect(controller.terrainMode).toBe(true);
      controller.key(down('KeyT'));
      expect(controller.terrainMode).toBe(false);
      expect(controller.overlay().terrain).toBe(false);
    });

    it('gives the vision table of the rules as it is, for the legend', () => {
      const { controller } = setup();
      const table = controller.visionTable;
      // DEC-21, item 2: forest is always a range, mountains see plains exactly.
      expect(table.forest).toEqual({ plains: 'range', forest: 'range', mountains: 'presence' });
      expect(table.mountains.plains).toBe('exact');
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
    expect(sent).toEqual([
      { type: 'move', group: group.id, dest: other.id, planned: false, bonus: 0 },
    ]);
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
    controller.chooseGroup('split');
    expect(controller.splitMenu.current.open).toBe(true);
    expect(controller.groupMenu.current.open).toBe(false);
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
