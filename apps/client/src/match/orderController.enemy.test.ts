import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { HudState } from '../hud/hudState.svelte.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { Command } from '../protocol.gen.ts';
import { OrderBook } from './orderBook.ts';
import { OrderController } from './orderController.ts';

// An enemy city is only a target: a click on it selects nothing and lights nothing (#535). Orders
// to it, and the own cities, stay as they were.
const base = devSnapshot(DEFAULT_MAP, DEV_RULES, 30);
const first = base.view.groups[0];
if (first?.location.kind !== 'node') throw new Error('the dev snapshot has no group in a node');
const home = first.location.node;
const enemy = base.view.nodes.find((n) => n.owner === 1);
if (enemy === undefined) throw new Error('the dev snapshot lacks an enemy node');

function setup() {
  const hud = new HudState({ me: 0, nicks: ['Danya', 'Bot'], rules: DEV_RULES, map: DEFAULT_MAP });
  hud.onSnapshot(base);
  const sent: Command[] = [];
  const controller = new OrderController({
    hud,
    map: DEFAULT_MAP,
    rules: DEV_RULES,
    book: new OrderBook(),
    send: (cmd) => sent.push(cmd),
    now: () => 0,
  });
  const menusOpen = (): boolean =>
    controller.cityMenu.current.open ||
    controller.groupMenu.current.open ||
    controller.stackMenu.current.open ||
    controller.supplyMenu.current.open;
  return { hud, controller, sent, menusOpen };
}

describe('an enemy city is not selected (#535)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a click on an enemy city gives no selection and no menu', () => {
    const { hud, controller, menusOpen } = setup();
    controller.click({ kind: 'node', id: enemy.id }, false);
    expect(hud.selection).toBeNull();
    expect(menusOpen()).toBe(false);
  });

  it('a click on an enemy city drops an earlier selection', () => {
    const { hud, controller } = setup();
    controller.click({ kind: 'node', id: home }, false);
    expect(hud.selection).toEqual({ kind: 'node', id: home });
    controller.click({ kind: 'node', id: enemy.id }, false);
    expect(hud.selection).toBeNull();
  });

  it('a click on the area (road side) of an enemy city is no selection either', () => {
    const { hud, controller } = setup();
    controller.click({ kind: 'edge', id: 0, cell: enemy.id }, false);
    expect(hud.selection).toBeNull();
  });

  it('a click on an enemy city with a group selected is a move order to it', () => {
    const { hud, controller, sent } = setup();
    controller.click({ kind: 'group', id: first.id }, false);
    controller.click({ kind: 'node', id: enemy.id }, false);
    expect(sent).toEqual([{ type: 'move', group: first.id, dest: enemy.id, planned: false }]);
    expect(hud.selection).toBeNull();
  });

  it('in the Supply view and in the road mode an enemy city is not selected', () => {
    const { hud, controller } = setup();
    controller.ui.patch({ supplyMode: true });
    controller.click({ kind: 'node', id: enemy.id }, false);
    expect(hud.selection).toBeNull();
    controller.ui.patch({ supplyMode: false, roadMode: true });
    controller.click({ kind: 'node', id: enemy.id }, false);
    expect(hud.selection).toBeNull();
  });

  it('a click on the icon of own units standing in an enemy city does not select the city', () => {
    const { hud, controller } = setup();
    controller.click({ kind: 'stack', node: enemy.id, ids: [first.id, 'other'] }, false);
    expect(hud.selection).toBeNull();
  });

  it('a selected city the enemy captures loses its highlight', () => {
    const { hud, controller } = setup();
    controller.click({ kind: 'node', id: home }, false);
    expect(hud.selection).toEqual({ kind: 'node', id: home });
    hud.onSnapshot({
      ...base,
      view: {
        ...base.view,
        nodes: base.view.nodes.map((n) => (n.id === home ? { ...n, owner: 1 } : n)),
      },
    });
    controller.overlay();
    expect(hud.selection).toBeNull();
  });

  it('a click on an own city is unchanged: it is selected and opens the city menu', () => {
    const { hud, controller } = setup();
    controller.click({ kind: 'node', id: home }, false);
    expect(hud.selection).toEqual({ kind: 'node', id: home });
    expect(controller.cityMenu.current.open).toBe(true);
  });
});
