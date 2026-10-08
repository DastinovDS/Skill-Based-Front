import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { HudState } from '../hud/hudState.svelte.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { Command } from '../protocol.gen.ts';
import { OrderBook } from './orderBook.ts';
import { NOTICE_MS, OrderController } from './orderController.ts';

const map = DEFAULT_MAP;
const snapshot = devSnapshot(map, DEV_RULES, 30);
const group = snapshot.view.groups[0];
if (group?.location.kind !== 'node') throw new Error('the dev snapshot has no group in a node');
const home = group.location.node;
const enemy = snapshot.view.nodes.find((n) => n.owner === 1 && n.detail === 'exact');
const other = snapshot.view.nodes.find((n) => n.id !== home && n.owner === 0);
if (enemy === undefined || other === undefined) throw new Error('the dev snapshot lacks nodes');

function setup(withSend = true) {
  const hud = new HudState({ me: 0, rules: DEV_RULES, map });
  hud.onSnapshot(snapshot);
  const book = new OrderBook();
  const sent: Command[] = [];
  const controller = new OrderController({
    hud,
    map,
    rules: DEV_RULES,
    book,
    send: withSend ? (cmd) => sent.push(cmd) : null,
  });
  return { hud, book, sent, controller };
}

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

  it('makes every order planned while the switch is on (key P toggles it)', () => {
    const { controller, sent } = setup();
    controller.click({ kind: 'group', id: group.id }, false);
    expect(controller.key({ type: 'keydown', code: 'KeyP', shiftKey: false })).toBe(true);
    expect(controller.ui.current.planned).toBe(true);
    controller.click({ kind: 'node', id: enemy.id }, false);
    expect(sent[0]).toMatchObject({ planned: true });
    controller.key({ type: 'keydown', code: 'KeyP', shiftKey: false });
    expect(controller.ui.current.planned).toBe(false);
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

  it('shows a rejection as a notice that fades, and rolls the ghost back', () => {
    const { controller, book } = setup();
    controller.click({ kind: 'group', id: group.id }, false);
    controller.click({ kind: 'node', id: enemy.id }, false);
    book.onAck(ack(1, 'NOT_ENOUGH_CP'));
    expect(book.ghosts()).toEqual([]);
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
    expect(controller.key({ type: 'keydown', code: 'KeyQ', shiftKey: false })).toBe(false);
  });

  it('sends the other commands as intents', () => {
    const { controller, sent } = setup();
    controller.click({ kind: 'group', id: group.id }, false);
    controller.setMode('build');
    controller.split(1);
    controller.upgradeRoad(3);
    controller.recruit();
    controller.setStance('economy');
    controller.forfeit();
    expect(sent).toEqual([
      { type: 'set_mode', group: group.id, mode: 'build' },
      { type: 'split', group: group.id, n: 1 },
      { type: 'upgrade_road', group: group.id, edge: 3 },
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

  it('keys 1-3 set the mode and R recruits', () => {
    const { controller, sent } = setup();
    controller.click({ kind: 'group', id: group.id }, false);
    for (const code of ['Digit1', 'Digit2', 'Digit3', 'KeyR']) {
      expect(controller.key({ type: 'keydown', code, shiftKey: false })).toBe(true);
    }
    expect(sent.map((c) => c.type)).toEqual(['set_mode', 'set_mode', 'set_mode', 'recruit']);
  });

  it('clicking a road upgrades it only with a group selected; hovering shows the gain', () => {
    const { controller, sent, hud } = setup();
    const edges = snapshot.view.edges.map((e, i) =>
      i === 2 ? { ...e, upgrade_gain: { capacity_centi: 150, packet_speed_pct: 10 } } : e,
    );
    hud.onSnapshot({ ...snapshot, view: { ...snapshot.view, edges } });
    controller.click({ kind: 'edge', id: 2 }, false);
    expect(sent).toEqual([]);
    controller.hover({ kind: 'edge', id: 2 });
    expect(controller.ui.current.road).toEqual({
      edge: 2,
      capacityCenti: 150,
      packetSpeedPct: 10,
      cost: DEV_RULES.cost.build,
    });
    expect(controller.overlay().road).toBe(2);
    controller.click({ kind: 'group', id: group.id }, false);
    controller.click({ kind: 'edge', id: 2 }, false);
    expect(sent).toEqual([{ type: 'upgrade_road', group: group.id, edge: 2 }]);
    controller.hover({ kind: 'edge', id: 1 });
    expect(controller.ui.current.road).toBeNull();
  });
});
