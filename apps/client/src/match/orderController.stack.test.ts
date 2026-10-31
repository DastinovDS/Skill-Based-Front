import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { HudState } from '../hud/hudState.svelte.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { Command, GroupView, SnapshotMsg } from '../protocol.gen.ts';
import { OrderBook } from './orderBook.ts';
import { OrderController } from './orderController.ts';

// Own units standing in one city (UI round 2, #236): one icon on the map; a click on it selects the
// group, or lists the groups when there are several.
const map = DEFAULT_MAP;
const base = devSnapshot(map, DEV_RULES, 30);
const first = base.view.groups[0];
if (first?.location.kind !== 'node') throw new Error('the dev snapshot has no group in a node');
const home = first.location.node;
const away = base.view.nodes.find((n) => n.id !== home && n.owner === 0);
if (away === undefined) throw new Error('the dev snapshot lacks an own node');

const second: GroupView = {
  ...first,
  id: 'second-group',
  units: 2,
  charged: 1,
  mode: 'defense',
  order: null,
};
const third: GroupView = { ...first, id: 'third-group', units: 1, charged: 0, order: null };
const crowded: SnapshotMsg = {
  ...base,
  view: { ...base.view, groups: [{ ...first, order: null }, second, third] },
};

function setup(snapshot: SnapshotMsg = crowded) {
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
  return { hud, controller, sent };
}

const stack = {
  kind: 'stack',
  node: home,
  ids: [first.id, 'second-group', 'third-group'],
} as const;
const down = (code: string) => ({ type: 'keydown', code, shiftKey: false }) as const;

describe('the icon of own units in a city', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a click on the icon of one group selects it; a second click opens its menu', () => {
    const { hud, controller } = setup();
    controller.click({ kind: 'group', id: first.id, node: home }, false);
    expect(hud.selection).toEqual({ kind: 'group', id: first.id });
    expect(controller.groupMenu.current.open).toBe(false);
    controller.click({ kind: 'group', id: first.id, node: home }, false);
    expect(controller.groupMenu.current).toMatchObject({ open: true, target: first.id });
  });

  it('a click on the icon of several groups selects the city and lists the groups', () => {
    const { hud, controller } = setup();
    controller.click(stack, false);
    expect(hud.selection).toEqual({ kind: 'node', id: home });
    expect(controller.stackMenu.current).toMatchObject({ open: true, target: home });
    expect(controller.stackGroups().map((g) => [g.id, g.units, g.charged])).toEqual([
      [first.id, first.units, first.charged],
      ['second-group', 2, 1],
      ['third-group', 1, 0],
    ]);
    // A second click on the icon closes the list.
    controller.click(stack, false);
    expect(controller.stackMenu.current.open).toBe(false);
  });

  it('a sector of the list selects that group; the same group again opens its menu', () => {
    const { hud, controller } = setup();
    controller.click(stack, false);
    controller.chooseStackGroup('second-group');
    expect(controller.stackMenu.current.open).toBe(false);
    expect(hud.selection).toEqual({ kind: 'group', id: 'second-group' });
    expect(hud.current?.group?.id).toBe('second-group');
    // The list opens again from the icon, the selected group stays selected meanwhile.
    controller.click(stack, false);
    expect(hud.selection).toEqual({ kind: 'group', id: 'second-group' });
    controller.chooseStackGroup('second-group');
    expect(controller.groupMenu.current).toMatchObject({ open: true, target: 'second-group' });
  });

  it('digits choose a group from the open list (they are not the modes then)', () => {
    const { hud, controller, sent } = setup();
    controller.click(stack, false);
    expect(controller.key(down('Digit3'))).toBe(true);
    expect(hud.selection).toEqual({ kind: 'group', id: 'third-group' });
    expect(sent).toEqual([]);
    // With the list closed the digit is the mode key again.
    expect(controller.key(down('Digit2'))).toBe(true);
    expect(sent).toEqual([{ type: 'set_mode', group: 'third-group', mode: 'defense' }]);
  });

  it('the keys work with the picked group: merge sends every group of the city', () => {
    const { controller, sent } = setup();
    controller.click(stack, false);
    controller.chooseStackGroup('second-group');
    controller.key(down('KeyG'));
    expect(sent).toEqual([{ type: 'merge', groups: ['second-group', first.id, 'third-group'] }]);
  });

  it('Esc drops the list and the selection', () => {
    const { hud, controller } = setup();
    controller.click(stack, false);
    expect(controller.isIdle()).toBe(false);
    controller.key(down('Escape'));
    expect(controller.stackMenu.current.open).toBe(false);
    expect(hud.selection).toBeNull();
    expect(controller.isIdle()).toBe(true);
  });

  it('the list closes when the city has no choice left (one group)', () => {
    const { controller, hud } = setup();
    controller.click(stack, false);
    hud.onSnapshot({ ...crowded, view: { ...crowded.view, groups: [first] } });
    controller.overlay();
    expect(controller.stackMenu.current.open).toBe(false);
  });

  it('an order for a group selected elsewhere goes to the city whose icon is clicked', () => {
    const { controller, sent, hud } = setup();
    // The group on the road or in another city is selected: use the group of `home`, aim at `away`.
    controller.click({ kind: 'group', id: first.id, node: home }, false);
    controller.click({ kind: 'group', id: 'far-group', node: away.id }, false);
    expect(sent).toEqual([
      { type: 'move', group: first.id, dest: away.id, planned: false, bonus: 0 },
    ]);
    expect(hud.selection).toBeNull();
    controller.click({ kind: 'group', id: first.id, node: home }, false);
    controller.click({ kind: 'stack', node: away.id, ids: ['x', 'y'] }, true);
    expect(sent[1]).toEqual({
      type: 'move',
      group: first.id,
      dest: away.id,
      planned: true,
      bonus: 0,
    });
  });

  it('the tip of a stack is the total of its groups', () => {
    const { controller, hud } = setup();
    controller.hover(stack);
    expect(hud.current?.hovered).toMatchObject({
      node: home,
      units: first.units + 3,
      charged: first.charged + 1,
    });
    controller.hover(null);
    expect(hud.current?.hovered).toBeNull();
  });
});

describe('the area of a city', () => {
  it('a click on a road outside the road pick is a click on the city it lies in', () => {
    const { hud, controller } = setup();
    controller.click({ kind: 'edge', id: 0, cell: away.id }, false);
    expect(hud.selection).toEqual({ kind: 'node', id: away.id });
    // The own city opens its menu.
    expect(controller.cityMenu.current).toMatchObject({ open: true, target: away.id });
  });

  it('a click on a road with no area does nothing', () => {
    const { hud, controller } = setup();
    controller.click({ kind: 'edge', id: 0 }, false);
    expect(hud.selection).toBeNull();
  });

  it('with a group selected, a click in the area of another city orders it there', () => {
    const { controller, sent } = setup();
    controller.click({ kind: 'group', id: first.id, node: home }, false);
    controller.click({ kind: 'node', id: away.id }, false);
    expect(sent).toEqual([
      { type: 'move', group: first.id, dest: away.id, planned: false, bonus: 0 },
    ]);
  });
});
