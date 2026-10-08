import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { HudState } from '../hud/hudState.svelte.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { Command, RulesetPublic, SnapshotMsg } from '../protocol.gen.ts';
import { RADIAL } from '../hud/radial.ts';
import { OrderBook } from './orderBook.ts';
import { NOTICE_MS, OrderController } from './orderController.ts';

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
  const controller = new OrderController({
    hud,
    map,
    rules: RULES,
    book,
    send: withSend ? (cmd) => sent.push(cmd) : null,
    now: () => clock.now,
    alerts: hud.alerts,
    focusNode: (node) => focused.push(node),
  });
  return { hud, book, sent, controller, clock, focused };
}

const down = (code: string, repeat = false) =>
  ({ type: 'keydown', code, shiftKey: false, repeat }) as const;
const up = (code: string) => ({ type: 'keyup', code, shiftKey: false }) as const;

const ack = (seq: number, reject_code: string | null = null) =>
  ({ type: 'ack', seq, applied_tick: 31, path: null, reject_code }) as const;

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
    controller.click({ kind: 'node', id: other.id }, true);
    expect(sent).toEqual([
      { type: 'move', group: group.id, dest: enemy.id, planned: false },
      { type: 'move', group: group.id, dest: other.id, planned: true },
    ]);
    // Shown at once as a ghost, the last order replacing the first.
    expect(book.ghosts().map((g) => [g.from, g.dest, g.planned])).toEqual([[home, other.id, true]]);
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

  it('does not order the group to its own node: that click selects the node', () => {
    const { controller, sent, hud } = setup();
    controller.click({ kind: 'group', id: group.id }, false);
    controller.click({ kind: 'node', id: home }, false);
    expect(sent).toEqual([]);
    expect(hud.selection).toEqual({ kind: 'node', id: home });
  });

  it('only selects when there is no match to send to', () => {
    const { controller, hud } = setup(false);
    controller.click({ kind: 'group', id: group.id }, false);
    controller.click({ kind: 'node', id: enemy.id }, false);
    expect(hud.selection).toEqual({ kind: 'node', id: enemy.id });
  });

  it('previews the target with the price from the ruleset, and aims the estimate at enemies', () => {
    const { controller, hud } = setup();
    controller.click({ kind: 'group', id: group.id }, false);
    controller.hover({ kind: 'node', id: enemy.id });
    expect(controller.ui.current.preview).toEqual({
      node: enemy.id,
      planned: false,
      cost: DEV_RULES.cost.move,
    });
    expect(hud.target).toEqual({ node: enemy.id, planned: false });
    expect(controller.overlay().preview).toEqual({ from: home, to: enemy.id, planned: false });

    // Shift held: the price switches to the planned one before the click.
    controller.key({ type: 'keydown', code: 'ShiftLeft', shiftKey: true });
    expect(controller.ui.current.preview).toEqual({
      node: enemy.id,
      planned: true,
      cost: DEV_RULES.cost.planned_move,
    });

    controller.hover(null);
    expect(controller.ui.current.preview).toBeNull();
    expect(hud.target).toBeNull();
    controller.hover({ kind: 'node', id: other.id });
    expect(hud.target).toBeNull(); // not an enemy node: no estimate
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
    controller.click({ kind: 'node', id: enemy.id }, false);
    book.onAck(ack(2, 'NOT_ENOUGH_CP'));
    expect(seen).toEqual(['accepted', 'rejected']);
    stop();
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
      { type: 'upgrade_road', node: home, edge: 3 },
      { type: 'recruit', node: home },
      { type: 'set_stance', stance: 'economy' },
      { type: 'forfeit' },
    ]);
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

  describe('road pick of a city (key U, DEC-16)', () => {
    // Roads of the home city, and one road elsewhere; two of the home roads can be upgraded.
    const homeRoads = map.edges.filter((e) => e.a === home || e.b === home).map((e) => e.id);
    const away = map.edges.find((e) => e.a !== home && e.b !== home)?.id;
    const [up1, up2] = homeRoads;
    if (up1 === undefined || up2 === undefined || away === undefined) {
      throw new Error('the map lacks roads around the home city');
    }
    const gain = { capacity_centi: 50, packet_speed_pct: 10 };

    function withRoads(base: SnapshotMsg, build: { edge: number; done_tick: number } | null) {
      return {
        ...base,
        view: {
          ...base.view,
          nodes: base.view.nodes.map((n) => (n.id === home ? { ...n, build } : n)),
          edges: base.view.edges.map((e) =>
            e.id === up1 || e.id === up2 || e.id === away
              ? { ...e, width: e.id === up2 ? 2 : 1, upgrade_gain: gain }
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

      controller.click({ kind: 'edge', id: up2 }, false);
      expect(sent).toEqual([{ type: 'upgrade_road', node: home, edge: up2 }]);
      // The pick ends with the command.
      expect(controller.ui.current.roadPick).toBeNull();
      expect(controller.overlay().candidates).toEqual([]);
    });

    it('hovering a candidate shows the gain and the price in charges of the next width', () => {
      const { controller } = pickSetup();
      controller.key(key('KeyU'));
      controller.hover({ kind: 'edge', id: up2 });
      // Width 2 -> 3 costs 3 charges (DEC-16).
      expect(controller.ui.current.road).toEqual({
        edge: up2,
        width: 3,
        capacityCenti: 50,
        packetSpeedPct: 10,
        charges: 3,
        pickable: true,
      });
      controller.hover({ kind: 'edge', id: away });
      expect(controller.ui.current.road).toMatchObject({ edge: away, charges: 2, pickable: false });
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
});
