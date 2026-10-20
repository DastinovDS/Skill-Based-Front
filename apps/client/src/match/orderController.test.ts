import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { HudState } from '../hud/hudState.svelte.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { Command, RulesetPublic, SnapshotMsg } from '../protocol.gen.ts';
import { RADIAL } from '../hud/radial.ts';
import { OrderBook } from './orderBook.ts';
import { NOTICE_MS, OrderController, REACH_REFRESH_TICKS } from './orderController.ts';

const map = DEFAULT_MAP;
// Road prices of DEC-16 (mechanics.md, section 8): the price of a level is the new width.
const RULES: RulesetPublic = {
  ...DEV_RULES,
  build: {
    ticks_per_level: 150,
    charges_per_level: [
      { width: 2, charges: 2 },
      { width: 3, charges: 3 },
      { width: 4, charges: 4 },
      { width: 5, charges: 5 },
    ],
  },
};
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
      // The group stands in an own city: that city builds (DEC-16).
      { type: 'upgrade_road', node: home, edge: 3, kind: null },
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
      nodes: [{ node: enemy.id, ticks: 25 }],
      split: [other.id],
    });
    const overlay = controller.overlay();
    expect([overlay.reach, overlay.split]).toEqual([[enemy.id], [other.id]]);
    // The hovered reachable target shows the server's travel time as one number, nothing else.
    expect(controller.overlay().eta).toBeNull();
    controller.hover({ kind: 'node', id: enemy.id });
    expect(controller.overlay().eta).toEqual({ node: enemy.id, ticks: 25 });
    // Shift (a planned order): the delay before the group sets off comes on top.
    controller.key({ type: 'keydown', code: 'ShiftLeft', shiftKey: true });
    expect(controller.overlay().eta).toEqual({
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
      order: { dest: enemy.id, path: [enemy.id], planned: true },
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

  describe('road pick of a city (key U, DEC-16; road types DEC-22)', () => {
    // Roads of the home city, and one road elsewhere; two of the home roads can be upgraded.
    const homeRoads = map.edges.filter((e) => e.a === home || e.b === home).map((e) => e.id);
    const away = map.edges.find((e) => e.a !== home && e.b !== home)?.id;
    const [up1, up2] = homeRoads;
    if (up1 === undefined || up2 === undefined || away === undefined) {
      throw new Error('the map lacks roads around the home city');
    }
    // Roads have no type (DEC-26): every next level only speeds the packets up.
    const gain = { speed_pct: 50 };

    function withRoads(base: SnapshotMsg, build: { edge: number; done_tick: number } | null) {
      return {
        ...base,
        view: {
          ...base.view,
          nodes: base.view.nodes.map((n) => (n.id === home ? { ...n, build } : n)),
          edges: base.view.edges.map((e) =>
            e.id === up2
              ? { ...e, width: 2, upgrade_gain: gain }
              : e.id === up1 || e.id === away
                ? { ...e, width: 1, upgrade_gain: gain }
                : e,
          ),
        },
      };
    }

    function pickSetup(build: { edge: number; done_tick: number } | null = null) {
      const env = setup();
      env.hud.onSnapshot(withRoads(snapshot, build));
      env.controller.click({ kind: 'node', id: home }, false);
      return env;
    }

    const key = (code: string) => ({ type: 'keydown', code, shiftKey: false }) as const;

    it('U lights up the upgradable roads of the selected own city; a click on one sends it', () => {
      const { controller, sent } = pickSetup();
      expect(controller.key(key('KeyU'))).toBe(true);
      expect(controller.ui.current.roadPick).toBe(home);
      expect([...controller.overlay().candidates].sort()).toEqual([up1, up2].sort());

      // A road of another city is not a candidate: the click does nothing.
      controller.click({ kind: 'edge', id: away }, false);
      expect(sent).toEqual([]);

      // The click sends at once, without a type (DEC-26, item 7).
      controller.click({ kind: 'edge', id: up2 }, false);
      expect(sent).toEqual([{ type: 'upgrade_road', node: home, edge: up2, kind: null }]);
      // The pick ends with the command.
      expect(controller.ui.current.roadPick).toBeNull();
      expect(controller.overlay().candidates).toEqual([]);
    });

    it('a road of level 1 is sent at once as well: no type menu any more (DEC-26)', () => {
      const { controller, sent } = pickSetup();
      controller.key(key('KeyU'));
      controller.click({ kind: 'edge', id: up1 }, false);
      expect(sent).toEqual([{ type: 'upgrade_road', node: home, edge: up1, kind: null }]);
      expect(controller.ui.current.roadPick).toBeNull();
    });

    it('Esc ends the pick and keeps the city selected; a second Esc deselects', () => {
      const { controller, hud, sent } = pickSetup();
      controller.key(key('KeyU'));
      expect(controller.key(key('Escape'))).toBe(true);
      expect(controller.ui.current.roadPick).toBeNull();
      expect(hud.selection).toEqual({ kind: 'node', id: home });
      controller.click({ kind: 'edge', id: up1 }, false);
      expect(sent).toEqual([]); // no pick: a road click does nothing
      controller.key(key('Escape'));
      expect(hud.selection).toBeNull();
    });

    it('U again or a click on a node ends the pick', () => {
      const { controller, hud } = pickSetup();
      controller.key(key('KeyU'));
      controller.key(key('KeyU'));
      expect(controller.ui.current.roadPick).toBeNull();
      controller.key(key('KeyU'));
      controller.click({ kind: 'node', id: other.id }, false);
      expect(controller.ui.current.roadPick).toBeNull();
      expect(hud.selection).toEqual({ kind: 'node', id: other.id });
    });

    it('does not start without an own city, nor in a city that already builds', () => {
      const { controller } = pickSetup({ edge: up1, done_tick: 120 });
      controller.key(key('KeyU'));
      expect(controller.ui.current.roadPick).toBeNull();
      controller.click({ kind: 'node', id: enemy.id }, false);
      controller.key(key('KeyU'));
      expect(controller.ui.current.roadPick).toBeNull();
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

    it('a click on an own city opens its menu (DEC-28: the transfer only, no priorities)', () => {
      const { controller, sent } = setup();
      controller.key(down('Tab'));
      controller.click({ kind: 'node', id: city }, false);
      expect(controller.supplyMenu.current).toMatchObject({ open: true, node: city });
      controller.key(down('Digit2')); // no such sector: nothing is chosen, nothing is sent
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
      controller.key(down('Digit1'));
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
    expect(hud.selection).toEqual({ kind: 'node', id: home }); // still selected
  });

  it('opens no city menu on an enemy city, or without a match to send to', () => {
    const a = setup();
    a.controller.click({ kind: 'node', id: enemy.id }, false);
    expect(a.controller.cityMenu.current.open).toBe(false);
    const b = setup(false);
    b.controller.click({ kind: 'node', id: home }, false);
    expect(b.controller.cityMenu.current.open).toBe(false);
  });

  it('a sector of the city menu does what its key does: recruit, or the road pick', () => {
    const { controller, sent } = setup();
    controller.click({ kind: 'node', id: home }, false);
    controller.chooseCity('recruit');
    expect(sent).toEqual([{ type: 'recruit', node: home }]);
    expect(controller.cityMenu.current.open).toBe(false);
    controller.click({ kind: 'node', id: home }, false);
    controller.chooseCity('roads');
    expect(controller.cityMenu.current.open).toBe(false);
    expect(controller.ui.current.roadPick).toBe(home);
  });

  it('the keys R and U close the menu of the city as well', () => {
    const { controller } = setup();
    controller.click({ kind: 'node', id: home }, false);
    controller.key(key('KeyU'));
    expect(controller.cityMenu.current.open).toBe(false);
    expect(controller.ui.current.roadPick).toBe(home);
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
