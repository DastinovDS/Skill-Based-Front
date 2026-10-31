import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { HudState } from '../hud/hudState.svelte.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { Command, MapFile, SnapshotMsg } from '../protocol.gen.ts';
import { OrderBook } from './orderBook.ts';
import { OrderController } from './orderController.ts';

// A province (`kind = province`, DEC-23) is only a destination: it is never selected, lit or given
// a menu (#425). The city rules stay as they were.
const base = devSnapshot(DEFAULT_MAP, DEV_RULES, 30);
const first = base.view.groups[0];
if (first?.location.kind !== 'node') throw new Error('the dev snapshot has no group in a node');
const home = first.location.node;
const ownOther = base.view.nodes.find((n) => n.id !== home && n.owner === 0);
if (ownOther === undefined) throw new Error('the dev snapshot lacks an own node');
const province = ownOther.id;

/** The default map with one own node turned into a province. */
const map: MapFile = {
  ...DEFAULT_MAP,
  nodes: DEFAULT_MAP.nodes.map((n) => (n.id === province ? { ...n, kind: 'province' } : n)),
};

function setup(snapshot: SnapshotMsg = base) {
  const hud = new HudState({ me: 0, nicks: ['Danya', 'Bot'], rules: DEV_RULES, map });
  hud.onSnapshot(snapshot);
  const sent: Command[] = [];
  const controller = new OrderController({
    hud,
    map,
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

describe('a province is not selectable (#425)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a click on a province gives no selection and no menu', () => {
    const { hud, controller, menusOpen } = setup();
    controller.click({ kind: 'node', id: province }, false);
    expect(hud.selection).toBeNull();
    expect(menusOpen()).toBe(false);
  });

  it('a click on a province drops an earlier selection', () => {
    const { hud, controller } = setup();
    controller.click({ kind: 'node', id: home }, false);
    expect(hud.selection).toEqual({ kind: 'node', id: home });
    controller.click({ kind: 'node', id: province }, false);
    expect(hud.selection).toBeNull();
  });

  it('a click on the area (road side) of a province is no selection either', () => {
    const { hud, controller } = setup();
    controller.click({ kind: 'edge', id: 0, cell: province }, false);
    expect(hud.selection).toBeNull();
  });

  it('a click on a province with a group selected is a move order to it', () => {
    const { hud, controller, sent } = setup();
    controller.click({ kind: 'group', id: first.id }, false);
    controller.click({ kind: 'node', id: province }, false);
    expect(sent).toEqual([
      { type: 'move', group: first.id, dest: province, planned: false, bonus: 0 },
    ]);
    expect(hud.selection).toBeNull();
    expect(controller.cityMenu.current.open).toBe(false);
  });

  it('a click on a city is unchanged: it is selected and opens the city menu', () => {
    const { hud, controller } = setup();
    controller.click({ kind: 'node', id: home }, false);
    expect(hud.selection).toEqual({ kind: 'node', id: home });
    expect(controller.cityMenu.current.open).toBe(true);
  });

  it('in the Supply view a province opens no supply menu and is not selected', () => {
    const { hud, controller } = setup();
    controller.ui.patch({ supplyMode: true });
    controller.click({ kind: 'node', id: province }, false);
    expect(controller.supplyMenu.current.open).toBe(false);
    expect(hud.selection).toBeNull();
    // A city of the same view still opens it.
    controller.click({ kind: 'node', id: home }, false);
    expect(controller.supplyMenu.current.open).toBe(true);
  });

  it('in the road mode a province is not selected either', () => {
    const { hud, controller } = setup();
    controller.ui.patch({ roadMode: true });
    controller.click({ kind: 'node', id: province }, false);
    expect(hud.selection).toBeNull();
  });
});
