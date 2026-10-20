import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { HudState } from '../hud/hudState.svelte.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { Command, GroupView, SnapshotMsg } from '../protocol.gen.ts';
import { OrderBook } from './orderBook.ts';
import { OrderController } from './orderController.ts';

// At most one radial menu is open at a time (#282, interface before the release), and Tab drops the
// selected city together with its menu.
const map = DEFAULT_MAP;
const base = devSnapshot(map, DEV_RULES, 30);
const first = base.view.groups[0];
if (first?.location.kind !== 'node') throw new Error('the dev snapshot has no group in a node');
const home = first.location.node;
const second: GroupView = { ...first, id: 'second-group', units: 2, charged: 1, order: null };
const crowded: SnapshotMsg = {
  ...base,
  view: { ...base.view, groups: [{ ...first, order: null }, second] },
};
const away = base.view.nodes.find((n) => n.id !== home && n.owner === 0);
if (away === undefined) throw new Error('the dev snapshot lacks an own node');

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
  /** The radial menus that are open now. */
  const open = (): string[] =>
    (
      [
        ['stance', controller.radial.current.open],
        ['supply', controller.supplyMenu.current.open],
        ['split', controller.splitMenu.current.open],
        ['city', controller.cityMenu.current.open],
        ['group', controller.groupMenu.current.open],
        ['stack', controller.stackMenu.current.open],
      ] as const
    )
      .filter(([, isOpen]) => isOpen)
      .map(([name]) => name);
  return { hud, controller, open };
}

const down = (code: string) => ({ type: 'keydown', code, shiftKey: false }) as const;
const city = { kind: 'node', id: home } as const;

describe('one radial menu at a time', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('the stance menu (Q) closes the menu of the selected city', () => {
    const { controller, open } = setup();
    controller.click(city, false);
    expect(open()).toEqual(['city']);
    controller.key(down('KeyQ'));
    expect(open()).toEqual(['stance']);
  });

  it('a click on a city closes the stance menu that was left open', () => {
    const { controller, open } = setup();
    controller.openRadial(true);
    expect(open()).toEqual(['stance']);
    controller.click(city, false);
    expect(open()).toEqual(['city']);
  });

  it('the split menu closes the menu of the group, and the group menu the split menu', () => {
    const { controller, open } = setup();
    controller.click({ kind: 'group', id: first.id }, false);
    controller.click({ kind: 'group', id: first.id }, false);
    expect(open()).toEqual(['group']);
    controller.key(down('KeyS'));
    expect(open()).toEqual(['split']);
    controller.click({ kind: 'group', id: first.id }, false); // the selected group: its menu
    expect(open()).toEqual(['group']);
  });

  it('the list of stacked groups closes the city menu, and a chosen group opens only its own', () => {
    const { controller, open } = setup(crowded);
    controller.click(city, false);
    expect(open()).toEqual(['city']);
    controller.click({ kind: 'stack', node: home, ids: [first.id, second.id] }, false);
    expect(open()).toEqual(['stack']);
    controller.chooseStackGroup(first.id);
    controller.chooseStackGroup(first.id); // the same group again: its own menu
    expect(open()).toEqual(['group']);
  });

  it('the supply menu and the stance menu push each other out', () => {
    const { controller, open } = setup();
    controller.key(down('Tab'));
    controller.click(city, false);
    expect(open()).toEqual(['supply']);
    controller.key(down('KeyQ'));
    expect(open()).toEqual(['stance']);
    controller.click(city, false);
    expect(open()).toEqual(['supply']);
  });

  it('a second supply menu replaces the first', () => {
    const { controller, open } = setup();
    controller.key(down('Tab'));
    controller.click(city, false);
    controller.click({ kind: 'node', id: away.id }, false);
    expect(open()).toEqual(['supply']);
    expect(controller.supplyMenu.current.node).toBe(away.id);
  });
});

describe('Tab', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('switches the supply mode on and drops the selected city with its menu', () => {
    const { controller, hud, open } = setup();
    controller.click(city, false);
    expect(hud.selection).toEqual(city);
    expect(open()).toEqual(['city']);
    expect(controller.key(down('Tab'))).toBe(true);
    expect(controller.supplyMode).toBe(true);
    expect(hud.selection).toBeNull();
    expect(open()).toEqual([]);
  });

  it('drops the city and its menu when the mode goes off too', () => {
    const { controller, hud, open } = setup();
    controller.key(down('Tab'));
    controller.click({ kind: 'node', id: home }, false);
    controller.key(down('Tab'));
    expect(controller.supplyMode).toBe(false);
    expect(open()).toEqual([]);
    controller.click(city, false);
    expect(open()).toEqual(['city']);
    controller.key(down('F2'));
    expect(hud.selection).toBeNull();
    expect(open()).toEqual([]);
  });

  it('keeps a selected group', () => {
    const { controller, hud } = setup();
    controller.click({ kind: 'group', id: first.id }, false);
    controller.key(down('Tab'));
    expect(hud.selection).toEqual({ kind: 'group', id: first.id });
  });
});
