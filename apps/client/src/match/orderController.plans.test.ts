import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_RULES_V2, devSnapshot } from '../hud/devFeed.ts';
import { HudState } from '../hud/hudState.svelte.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { Command, SnapshotMsg } from '../protocol.gen.ts';

import { OrderBook } from './orderBook.ts';
import { OrderController, PLAN_BONUS } from './orderController.ts';

// DEC-41, #649: the controls of a gathering plan, and the «Supply» layer that takes no click.
const map = DEFAULT_MAP;
const RULES = DEV_RULES_V2;
const base = devSnapshot(map, RULES, 30);
const group = base.view.groups[0];
if (group?.location.kind !== 'node') throw new Error('the dev snapshot has no group in a node');
const home = group.location.node;
const enemy = base.view.nodes.find((n) => n.owner === 1);
if (enemy === undefined) throw new Error('the dev snapshot has no enemy node');

/** `factories`: the own nodes that are factories; `home` by default. */
function setup(factories: readonly number[] = [home]) {
  const hud = new HudState({ me: 0, nicks: ['Ember', 'Bot'], rules: RULES, map });
  const nodes = base.view.nodes.map((n) =>
    n.owner === 0 ? { ...n, factory: factories.includes(n.id) } : n,
  );
  const snapshot: SnapshotMsg = { ...base, view: { ...base.view, nodes } };
  hud.onSnapshot(snapshot);
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

const down = (code: string) => ({ type: 'keydown', code, shiftKey: false }) as const;

describe('OrderController: planned orders and the «Supply» layer (DEC-41)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a Shift click with no wheel step asks for bonus 1; an ordinary order for none (#797)', () => {
    const { controller, sent } = setup();
    controller.click({ kind: 'group', id: group.id }, false);
    expect(controller.planBonus).toBe(PLAN_BONUS.min);
    controller.click({ kind: 'node', id: enemy.id }, true);
    controller.click({ kind: 'group', id: group.id }, false);
    controller.click({ kind: 'node', id: enemy.id }, false);
    expect(sent).toEqual([
      { type: 'move', group: group.id, dest: enemy.id, planned: true, bonus: 1 },
      { type: 'move', group: group.id, dest: enemy.id, planned: false, bonus: 0 },
    ]);
  });

  it('has no [ ] keys for the bonus any more (#797): they are not taken and change nothing', () => {
    const { controller, sent } = setup();
    controller.click({ kind: 'group', id: group.id }, false);
    controller.hover({ kind: 'node', id: enemy.id });
    expect(controller.key(down('BracketRight'))).toBe(false);
    // Not with Shift held either.
    expect(controller.key({ type: 'keydown', code: 'BracketRight', shiftKey: true })).toBe(false);
    expect(controller.key(down('BracketLeft'))).toBe(false);
    expect(controller.planBonus).toBe(PLAN_BONUS.min);
    controller.click({ kind: 'node', id: enemy.id }, true);
    expect(sent).toEqual([
      { type: 'move', group: group.id, dest: enemy.id, planned: true, bonus: 1 },
    ]);
  });

  it('F and the group menu let the plan of the selected group go', () => {
    const { controller, sent } = setup();
    controller.click({ kind: 'group', id: group.id }, false);
    expect(controller.key(down('KeyF'))).toBe(true);
    controller.chooseGroup('release');
    expect(sent).toEqual([
      { type: 'release_plan', group: group.id },
      { type: 'release_plan', group: group.id },
    ]);
  });

  it('in the «Supply» mode a click never selects or opens a city, group or stack menu (#678)', () => {
    const { controller, hud } = setup([]);
    controller.key(down('Tab'));
    expect(controller.supplyMode).toBe(true);
    const hits = [
      { kind: 'node', id: home },
      { kind: 'node', id: enemy.id },
      { kind: 'edge', id: 0, cell: home },
      { kind: 'group', id: group.id, node: home },
      { kind: 'stack', node: home, ids: [group.id] },
    ] as const;
    for (const hit of hits) {
      controller.click(hit, false);
      controller.click(hit, false);
      expect(hud.selection).toBeNull();
      expect(controller.cityMenu.current.open).toBe(false);
      expect(controller.groupMenu.current.open).toBe(false);
      expect(controller.stackMenu.current.open).toBe(false);
    }
    // Out of the mode the same click selects the city and opens its menu again.
    controller.key(down('Tab'));
    controller.click({ kind: 'node', id: home }, false);
    expect(controller.cityMenu.current.open).toBe(true);
  });
});
