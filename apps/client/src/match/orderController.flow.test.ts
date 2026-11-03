import { describe, expect, it } from 'vitest';
import { DEV_RULES_FLOW, devSnapshot } from '../hud/devFeed.ts';
import { HudState } from '../hud/hudState.svelte.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { Command, SnapshotMsg } from '../protocol.gen.ts';
import { OrderBook } from './orderBook.ts';
import { OrderController } from './orderController.ts';

// The automatic supply flow (DEC-43, `mvp-4`): one lever, the leaf shift; no lines, no supply menu.
const map = DEFAULT_MAP;
const RULES = DEV_RULES_FLOW;
const base = devSnapshot(map, RULES, 30);
const homeNode = base.view.nodes.find((n) => n.owner === 0 && n.warehouse_cap !== null);
if (homeNode === undefined) throw new Error('the dev snapshot has no own city');
const home = homeNode.id;
const enemy = base.view.nodes.find((n) => n.owner === 1);
if (enemy === undefined) throw new Error('the dev snapshot has no enemy node');

/** The dev snapshot with the flow fields: the own leaf shift `shift` of at most `max`. */
function flowSnapshot(shift: number | null, max: number | null): SnapshotMsg {
  return {
    ...base,
    view: {
      ...base.view,
      me: { ...base.view.me, leaf_shift: shift, leaf_shift_max: max, next_dispatch_tick: 40 },
    },
  };
}

function setup(shift: number | null = 0, max: number | null = 3) {
  const hud = new HudState({ me: 0, nicks: ['Ember', 'Bot'], rules: RULES, map });
  hud.onSnapshot(flowSnapshot(shift, max));
  const sent: Command[] = [];
  const controller = new OrderController({
    hud,
    map,
    rules: RULES,
    book: new OrderBook(),
    send: (cmd) => sent.push(cmd),
  });
  return { hud, sent, controller };
}

const down = (code: string, repeat = false) =>
  ({ type: 'keydown', code, shiftKey: false, repeat }) as const;

describe('the leaf shift control (DEC-43, item B)', () => {
  it('knows the flow from the rules and the shift from the snapshot', () => {
    const { controller } = setup(1, 3);
    expect(controller.flow).toBe(true);
    expect(controller.v2).toBe(true);
    expect(controller.leafShift).toBe(1);
    expect(controller.leafShiftMax).toBe(3);
  });

  it('minus moves the level one road back, plus forward: set_leaf_shift of the new value', () => {
    const { controller, sent } = setup(1, 3);
    controller.stepLeafShift(1);
    expect(sent).toEqual([{ type: 'set_leaf_shift', shift: 2 }]);
    sent.length = 0;
    const { controller: other, sent: otherSent } = setup(1, 3);
    other.stepLeafShift(-1);
    expect(otherSent).toEqual([{ type: 'set_leaf_shift', shift: 0 }]);
  });

  it('stays within 0..leaf_shift_max: a step past either end sends nothing', () => {
    const { controller, sent } = setup(3, 3);
    controller.stepLeafShift(1);
    expect(sent).toEqual([]);
    const front = setup(0, 3);
    front.controller.stepLeafShift(-1);
    expect(front.sent).toEqual([]);
  });

  it('two quick presses before the snapshot are two steps, not one', () => {
    const { controller, sent } = setup(0, 3);
    controller.stepLeafShift(1);
    controller.stepLeafShift(1);
    expect(sent).toEqual([
      { type: 'set_leaf_shift', shift: 1 },
      { type: 'set_leaf_shift', shift: 2 },
    ]);
  });

  it('the keys - and = (and the numpad) are the same steps; a held key repeats nothing', () => {
    const { controller, sent } = setup(1, 3);
    expect(controller.key(down('Minus'))).toBe(true);
    expect(controller.key(down('Minus', true))).toBe(true);
    expect(sent).toEqual([{ type: 'set_leaf_shift', shift: 2 }]);
    sent.length = 0;
    const next = setup(2, 3);
    expect(next.controller.key(down('Equal'))).toBe(true);
    expect(next.controller.key(down('NumpadAdd'))).toBe(true);
    expect(next.sent).toEqual([
      { type: 'set_leaf_shift', shift: 1 },
      { type: 'set_leaf_shift', shift: 0 },
    ]);
  });

  it('does nothing before a snapshot with a shift (lines rules, or no flow fields)', () => {
    const { controller, sent } = setup(null, null);
    controller.stepLeafShift(1);
    expect(sent).toEqual([]);
    expect(controller.key(down('Minus'))).toBe(false);
  });
});

describe('the lines UI is gone under the flow', () => {
  it('a click on an own city in the Supply mode opens no supply menu and draws no line', () => {
    const { controller, sent } = setup();
    controller.key(down('Tab'));
    controller.click({ kind: 'node', id: home }, false);
    expect(controller.supplyMenu.current.open).toBe(false);
    expect(controller.ui.current.lineDraft).toBeNull();
    expect(controller.openSupplyMenu(home)).toBe(false);
    expect(sent).toEqual([]);
    // No auto-lines toggle: the view has no value for it.
    expect(controller.autoLines).toBeNull();
  });

  it('the bunker is not in the rules, so no city or province offers one', () => {
    const { controller } = setup();
    expect(controller.hasBunker).toBe(false);
  });
});

describe('the hover of the Supply layer (N4, P2): the own city under the pointer, or a pinned one', () => {
  it('follows the pointer over an own city only, and only in the Supply mode', () => {
    const { controller } = setup();
    controller.hover({ kind: 'node', id: home });
    expect(controller.overlay().supply).toBeNull();
    controller.key(down('Tab'));
    expect(controller.overlay().supply?.flow).toBe(home);
    controller.hover({ kind: 'node', id: enemy.id });
    expect(controller.overlay().supply?.flow).toBeNull();
    controller.hover(null);
    expect(controller.overlay().supply?.flow).toBeNull();
  });

  it('a click pins the city, the same click again or a click elsewhere lets go; Tab drops it', () => {
    const { controller } = setup();
    controller.key(down('Tab'));
    controller.click({ kind: 'node', id: home }, false);
    controller.hover(null);
    expect(controller.overlay().supply?.flow).toBe(home);
    controller.click({ kind: 'node', id: home }, false);
    expect(controller.overlay().supply?.flow).toBeNull();
    controller.click({ kind: 'node', id: home }, false);
    controller.click({ kind: 'node', id: enemy.id }, false);
    expect(controller.overlay().supply?.flow).toBeNull();
    controller.click({ kind: 'node', id: home }, false);
    controller.key(down('Tab'));
    controller.key(down('Tab'));
    expect(controller.overlay().supply?.flow).toBeNull();
  });

  it('the overlay is the same object while nothing changed, a new one when the node does', () => {
    const { controller } = setup();
    controller.key(down('Tab'));
    controller.hover({ kind: 'node', id: home });
    const first = controller.overlay();
    expect(controller.overlay()).toBe(first);
    controller.hover({ kind: 'node', id: enemy.id });
    expect(controller.overlay()).not.toBe(first);
  });
});
