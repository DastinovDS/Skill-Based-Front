import { describe, expect, it } from 'vitest';
import { DEV_RULES_GROUP, devSnapshot } from '../hud/devFeed.ts';
import { HudState } from '../hud/hudState.svelte.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { Command, GroupView, ReachMsg, SnapshotMsg } from '../protocol.gen.ts';
import { OrderBook } from './orderBook.ts';
import {
  OrderController,
  PICK_REACH_GAP_TICKS,
  PICK_REACH_REFRESH_TICKS,
} from './orderController.ts';

// #1004: the preview of an order follows only the routes the server gave in `reach`, for a single
// group too big for the roads (item 1) and for every group of a group order (item 2).
const RULES = DEV_RULES_GROUP;
const base = devSnapshot(DEFAULT_MAP, RULES, 30);
const own = base.view.nodes.filter((n) => n.owner === 0).map((n) => n.id);
const enemyNode = base.view.nodes.find((n) => n.owner === 1);
const [a, b, c] = own;
if (a === undefined || b === undefined || c === undefined)
  throw new Error('three own nodes needed');
if (enemyNode === undefined) throw new Error('the dev snapshot lacks an enemy node');
const enemy = enemyNode.id;

const groupAt = (id: string, node: number, units: number): GroupView => ({
  id,
  units,
  charged: units,
  mode: 'attack',
  location: { kind: 'node', node },
  order: null,
});

function snapshot(groups: readonly GroupView[], tick = base.tick): SnapshotMsg {
  return {
    ...base,
    tick,
    view: { ...base.view, me: { ...base.view.me, cp: 1000 }, groups: [...groups] },
  };
}

const GROUPS = [groupAt('g1', a, 6), groupAt('g2', b, 2), groupAt('g3', c, 2)];

function setup(groups: readonly GroupView[] = GROUPS) {
  const hud = new HudState({ me: 0, nicks: ['Ember', 'Bot'], rules: RULES, map: DEFAULT_MAP });
  hud.onSnapshot(snapshot(groups));
  const book = new OrderBook(() => 0);
  const sent: Command[] = [];
  const queried: string[] = [];
  const controller = new OrderController({
    hud,
    map: DEFAULT_MAP,
    rules: RULES,
    book,
    send: (cmd) => sent.push(cmd),
    now: () => 0,
    queryReach: (group) => queried.push(group),
  });
  return { hud, book, sent, queried, controller };
}

const reach = (group: string, over: Partial<ReachMsg> = {}): ReachMsg => ({
  type: 'reach',
  group,
  tick: 30,
  nodes: [],
  split: [],
  ...over,
});

const eDown = { type: 'keydown', code: 'KeyE', shiftKey: false } as const;
const shiftDown = { type: 'keydown', code: 'ShiftLeft', shiftKey: true } as const;
const shiftUp = { type: 'keyup', code: 'ShiftLeft', shiftKey: false } as const;

function pickAll(controller: OrderController): void {
  controller.click({ kind: 'group', id: 'g1', node: a }, false);
  controller.key(shiftDown);
  controller.click({ kind: 'group', id: 'g2', node: b }, true);
  controller.click({ kind: 'group', id: 'g3', node: c }, true);
  controller.key(shiftUp);
}

// Item 1, the owner's screenshot of 2026-11-12: the capital's 6 units at the start do not fit the
// smaller nodes on the way (DEC-20, D), the server lists the far node under `split` with the part
// that fits, and the preview was a straight line across the map. It follows the part's route now.
describe('a single group too big for the roads (#1004, item 1)', () => {
  it('previews the route of the part that fits, with its time, never a straight line', () => {
    const { controller } = setup();
    controller.click({ kind: 'group', id: 'g1', node: a }, false);
    controller.onReach(
      reach('g1', { split: [{ node: enemy, units: 3, ticks: 70, path: [a, b, c, enemy] }] }),
    );
    controller.hover({ kind: 'node', id: enemy });
    const overlay = controller.overlay();
    expect(overlay.preview?.path).toEqual([a, b, c, enemy]);
    expect(overlay.eta).toEqual({ from: a, node: enemy, ticks: 70, path: [a, b, c, enemy] });
    expect(overlay.split).toEqual([enemy]);
  });

  it('draws no line to a node no part gets to', () => {
    const { controller } = setup();
    controller.click({ kind: 'group', id: 'g1', node: a }, false);
    controller.onReach(
      reach('g1', { split: [{ node: enemy, units: 0, ticks: null, path: null }] }),
    );
    controller.hover({ kind: 'node', id: enemy });
    expect(controller.overlay().preview).toBeNull();
    expect(controller.overlay().eta).toBeNull();
  });

  it('a planned order there has no line (#940)', () => {
    const { controller } = setup();
    controller.click({ kind: 'group', id: 'g1', node: a }, false);
    controller.onReach(
      reach('g1', { split: [{ node: enemy, units: 3, ticks: 70, path: [a, b, enemy] }] }),
    );
    controller.key(eDown);
    controller.hover({ kind: 'node', id: enemy });
    expect(controller.overlay().preview).toBeNull();
    expect(controller.overlay().eta).toBeNull();
  });

  it('the split part goes on with a ghost along that route', () => {
    const { controller, book, sent } = setup();
    controller.click({ kind: 'group', id: 'g1', node: a }, false);
    controller.onReach(
      reach('g1', { split: [{ node: enemy, units: 3, ticks: 70, path: [a, b, enemy] }] }),
    );
    controller.hover({ kind: 'node', id: enemy });
    controller.click({ kind: 'node', id: enemy }, false);
    expect(controller.splitMenu.current).toMatchObject({ open: true, n: 3, dest: enemy });
    controller.confirmSplit();
    // The server names the part (`group_split`): it is sent on along the route of its size.
    book.onEvent({
      type: 'event',
      tick: 31,
      kind: 'group_split',
      data: { group: 'g1', new_group: 'g9' },
    });
    expect(sent.at(-1)).toMatchObject({ type: 'move', group: 'g9', dest: enemy });
    expect(book.ghosts().find((g) => g.group === 'g9')?.path).toEqual([a, b, enemy]);
  });
});

// Item 2 (owner 2026-11-12, reversing the straight lines of 2026-11-11): each group selected together
// previews its own route to the hovered node, from its own `reach` answer.
describe('the routes of a group order (#1004, item 2)', () => {
  it('asks the server where each selected group goes, once per group, node and size', () => {
    const { controller, queried } = setup();
    pickAll(controller);
    controller.overlay();
    expect(queried.filter((id) => id !== 'g1')).toEqual(['g2', 'g3']);
    expect(queried.filter((id) => id === 'g1').length).toBeGreaterThanOrEqual(1);
    const before = queried.length;
    controller.overlay();
    expect(queried.length).toBe(before);
  });

  it('each member follows its own route; a member without one has no line', () => {
    const { controller } = setup();
    pickAll(controller);
    controller.onReach(reach('g2', { nodes: [{ node: enemy, ticks: 20, path: [b, enemy] }] }));
    controller.onReach(reach('g3', { nodes: [{ node: enemy, ticks: 40, path: [c, b, enemy] }] }));
    controller.hover({ kind: 'node', id: enemy });
    // g1 has no answer yet: no line for it, and no straight one either.
    expect(controller.overlay().group).toMatchObject({
      from: [a, b, c],
      routes: [
        [b, enemy],
        [c, b, enemy],
      ],
    });
  });

  it('an ordinary order takes the route of the part that fits, a planned one drops the member', () => {
    const { controller } = setup();
    pickAll(controller);
    controller.onReach(
      reach('g1', { split: [{ node: enemy, units: 3, ticks: 60, path: [a, c, enemy] }] }),
    );
    controller.onReach(reach('g2', { nodes: [{ node: enemy, ticks: 20, path: [b, enemy] }] }));
    controller.hover({ kind: 'node', id: enemy });
    expect(controller.overlay().group?.routes).toEqual([
      [a, c, enemy],
      [b, enemy],
    ]);
    // E held (DEC-48, owner decision (10)): a planned member too big for every road is dropped.
    controller.key(eDown);
    expect(controller.overlay().group).toMatchObject({ planned: true, routes: [[b, enemy]] });
  });

  it('an answer about a group that moved is not used', () => {
    const { controller, hud } = setup();
    pickAll(controller);
    controller.onReach(reach('g2', { nodes: [{ node: enemy, ticks: 20, path: [b, enemy] }] }));
    hud.onSnapshot(snapshot([groupAt('g1', a, 6), groupAt('g2', c, 2), groupAt('g3', c, 2)]));
    controller.hover({ kind: 'node', id: enemy });
    expect(controller.overlay().group?.routes).toEqual([]);
  });

  it('the ghosts of a sent group order follow the members routes until the ack', () => {
    const { controller, book } = setup();
    pickAll(controller);
    controller.onReach(reach('g2', { nodes: [{ node: enemy, ticks: 20, path: [b, enemy] }] }));
    controller.hover({ kind: 'node', id: enemy });
    controller.click({ kind: 'node', id: enemy }, false);
    expect(book.ghosts().map((g) => [g.group, g.path])).toEqual([
      ['g1', null],
      ['g2', [b, enemy]],
      ['g3', null],
    ]);
  });

  it('asks again after a while, one group at a time, and forgets groups let go', () => {
    const { controller, hud, queried } = setup();
    pickAll(controller);
    controller.overlay();
    controller.onReach(reach('g2', { nodes: [{ node: enemy, ticks: 20, path: [b, enemy] }] }));
    const asked = queried.length;
    hud.onSnapshot(snapshot(GROUPS, base.tick + PICK_REACH_REFRESH_TICKS));
    controller.overlay();
    expect(queried.length).toBe(asked + 1);
    hud.onSnapshot(snapshot(GROUPS, base.tick + PICK_REACH_REFRESH_TICKS + 1));
    controller.overlay();
    expect(queried.length).toBe(asked + 1);
    hud.onSnapshot(snapshot(GROUPS, base.tick + PICK_REACH_REFRESH_TICKS + PICK_REACH_GAP_TICKS));
    controller.overlay();
    expect(queried.length).toBe(asked + 2);
    controller.deselect();
    controller.overlay();
    expect(controller.ui.current.pickReach).toEqual({});
  });
});
