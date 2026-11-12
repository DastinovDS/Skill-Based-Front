import { describe, expect, it, vi } from 'vitest';
import { cityChoices } from '../hud/cityChoices.ts';
import { DEV_RULES_FLOW, devSnapshot } from '../hud/devFeed.ts';
import { HudState } from '../hud/hudState.svelte.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { AckMsg, Command, GroupView, SnapshotMsg } from '../protocol.gen.ts';
import { OrderBook } from './orderBook.ts';
import { CP_SHORT_FLASH_MS, OrderController, PLAN_BONUS, planBonusCap } from './orderController.ts';

// The UX batch of the 2026-11-05 playtest (#762), on the `mvp-4` rules (economy v2, the flow).
const RULES = DEV_RULES_FLOW;
const base = devSnapshot(DEFAULT_MAP, RULES, 30);
const own = base.view.nodes.filter((n) => n.owner === 0 && n.warehouse_cap !== null);
const [homeNode, secondNode] = own;
if (homeNode === undefined || secondNode === undefined) throw new Error('two own cities needed');
const home = homeNode.id;
const second = secondNode.id;
const enemyNode = base.view.nodes.find((n) => n.owner === 1);
if (enemyNode === undefined) throw new Error('the dev snapshot has no enemy node');
const enemy = enemyNode.id;
const GROUP = 'g-big';

function groupAt(node: number, units: number, charged: number, id = GROUP): GroupView {
  return {
    id,
    units,
    charged,
    mode: 'attack',
    location: { kind: 'node', node },
    order: null,
  };
}

/** The dev snapshot with one own group of `units` / `charged` at home and `cp` hundredths of CP. */
function snapshot(
  opts: { units?: number; charged?: number; cp?: number; extra?: GroupView[] } = {},
): SnapshotMsg {
  return {
    ...base,
    view: {
      ...base.view,
      me: { ...base.view.me, cp: opts.cp ?? 1000 },
      groups: [groupAt(home, opts.units ?? 6, opts.charged ?? 6), ...(opts.extra ?? [])],
    },
  };
}

function ack(seq: number, reject: string | null = null): AckMsg {
  return {
    type: 'ack',
    seq,
    applied_tick: 31,
    path: null,
    arrive_tick: null,
    reject_code: reject,
    kind: null,
    cost: null,
    members: null,
  };
}

/** E held over `node` and the wheel turned up `notches` notches, a pause apart (#793, #797). */
function wheelOver(
  controller: OrderController,
  clock: { now: number },
  node: number,
  notches: number,
): void {
  controller.key({ type: 'keydown', code: 'KeyE', shiftKey: false });
  controller.hover({ kind: 'node', id: node });
  for (let i = 0; i < notches; i++) {
    clock.now += 200;
    controller.wheel({ deltaX: 0, deltaY: -100, deltaMode: 0, shiftKey: true });
  }
}

function setup(snap: SnapshotMsg = snapshot()) {
  const hud = new HudState({ me: 0, nicks: ['Ember', 'Bot'], rules: RULES, map: DEFAULT_MAP });
  hud.onSnapshot(snap);
  const sent: Command[] = [];
  const clock = { now: 1000 };
  const book = new OrderBook(() => clock.now);
  const controller = new OrderController({
    hud,
    map: DEFAULT_MAP,
    rules: RULES,
    book,
    send: (cmd) => {
      sent.push(cmd);
      book.track(sent.length, cmd, cmd.type === 'move' ? home : null);
      return sent.length;
    },
    now: () => clock.now,
    queryReach: () => undefined,
  });
  return { hud, sent, controller, book, clock };
}

describe('hover: what a click would pick or aim at (#762)', () => {
  it('lights an own city, an own group, and nothing on an enemy city with nothing selected', () => {
    const { controller } = setup();
    controller.hover({ kind: 'node', id: second });
    expect(controller.overlay().hover).toEqual({ node: second, group: null });
    // A road off the road mode is the area of its city.
    controller.hover({ kind: 'edge', id: 0, cell: second });
    expect(controller.overlay().hover).toEqual({ node: second, group: null });
    controller.hover({ kind: 'group', id: GROUP });
    expect(controller.overlay().hover).toEqual({ node: null, group: GROUP });
    // An enemy city is only a target (#535): a click on it does nothing without a group.
    controller.hover({ kind: 'node', id: enemy });
    expect(controller.overlay().hover).toBeNull();
    controller.hover(null);
    expect(controller.overlay().hover).toBeNull();
  });

  it('with a group selected lights the target of the order, not the place it stands in', () => {
    const { controller } = setup();
    controller.click({ kind: 'group', id: GROUP }, false);
    controller.hover({ kind: 'node', id: enemy });
    const first = controller.overlay().hover;
    expect(first).toEqual({ node: enemy, group: null });
    // The same mark is the same object while nothing changes (the scene redraws on a change only).
    expect(controller.overlay().hover).toBe(first);
    controller.hover({ kind: 'node', id: home });
    expect(controller.overlay().hover).toBeNull();
  });

  it('lights nothing while a pick of its own runs (the road of a fortification)', () => {
    const { controller } = setup();
    controller.click({ kind: 'node', id: home }, false);
    controller.chooseCity('fortify');
    expect(controller.ui.current.fortFrom).toBe(home);
    controller.hover({ kind: 'node', id: second });
    expect(controller.overlay().hover).toBeNull();
  });
});

describe('a click at a place too small for the group splits and sends (#762)', () => {
  function selected(snap: SnapshotMsg = snapshot()) {
    const s = setup(snap);
    s.controller.click({ kind: 'group', id: GROUP }, false);
    s.controller.overlay();
    s.controller.onReach({
      type: 'reach',
      group: GROUP,
      tick: 30,
      nodes: [],
      split: [
        { node: enemy, units: 3 },
        { node: second, units: 0 },
      ],
    });
    return s;
  }

  it('opens the split menu with the size the server says fits, no higher', () => {
    const { controller, sent } = selected();
    expect(controller.splitFit(enemy)).toBe(3);
    controller.click({ kind: 'node', id: enemy }, false);
    expect(sent).toEqual([]);
    const menu = controller.splitMenu.current;
    expect([menu.open, menu.group, menu.n, menu.max, menu.dest]).toEqual([
      true,
      GROUP,
      3,
      3,
      enemy,
    ]);
    controller.splitMenu.set(5);
    expect(controller.splitMenu.current.n).toBe(3);
    controller.splitMenu.set(1);
    expect(controller.splitMenu.current.n).toBe(1);
  });

  it('on confirm splits, then orders the new group there once the server names it', () => {
    const { controller, sent, book, hud } = selected();
    controller.click({ kind: 'node', id: enemy }, false);
    controller.confirmSplit();
    expect(sent).toEqual([{ type: 'split', group: GROUP, n: 3 }]);
    book.onAck(ack(1));
    book.onEvent({
      type: 'event',
      tick: 31,
      kind: 'group_split',
      data: { group: GROUP, new_group: 'g-new' },
    });
    expect(sent[1]).toEqual({
      type: 'move',
      group: 'g-new',
      dest: enemy,
      planned: false,
      bonus: 0,
    });
    // The order is given: the group is let go, as after any order.
    expect(hud.selection).toBeNull();
    // The ghost of the move starts where the groups stand.
    expect(book.ghosts().map((g) => [g.from, g.dest])).toEqual([[home, enemy]]);
  });

  it('a planned order there is refused: no split offer, nothing sent (#940)', () => {
    const { controller, sent } = selected(snapshot({ units: 6, charged: 2 }));
    controller.key({ type: 'keydown', code: 'KeyE', shiftKey: false });
    controller.click({ kind: 'node', id: enemy }, false);
    expect(sent).toEqual([]);
    expect(controller.splitMenu.current.open).toBe(false);
  });

  it('sends nothing more when the split is refused, or the menu is closed', () => {
    const { controller, sent, book } = selected();
    controller.click({ kind: 'node', id: enemy }, false);
    controller.confirmSplit();
    book.onAck(ack(1, 'IN_FIGHT'));
    book.onEvent({
      type: 'event',
      tick: 31,
      kind: 'group_split',
      data: { group: GROUP, new_group: 'g-new' },
    });
    expect(sent).toEqual([{ type: 'split', group: GROUP, n: 3 }]);
    controller.click({ kind: 'group', id: GROUP }, false);
    controller.click({ kind: 'node', id: enemy }, false);
    controller.closeSplit();
    expect(sent).toHaveLength(1);
  });

  it('without a size that fits, the click is an ordinary order (the server answers)', () => {
    const { controller, sent } = selected();
    controller.click({ kind: 'node', id: second }, false);
    expect(controller.splitMenu.current.open).toBe(false);
    expect(sent).toEqual([{ type: 'move', group: GROUP, dest: second, planned: false, bonus: 0 }]);
  });
});

describe('CP shortage (#762)', () => {
  it('marks the CP badge while the hovered move costs more than the CP', () => {
    const { controller } = setup(snapshot({ cp: RULES.cost.move - 1 }));
    controller.click({ kind: 'group', id: GROUP }, false);
    controller.overlay();
    expect(controller.ui.current.cpShort).toBe(false);
    controller.hover({ kind: 'node', id: enemy });
    controller.overlay();
    expect(controller.ui.current.cpShort).toBe(true);
    controller.hover(null);
    controller.overlay();
    expect(controller.ui.current.cpShort).toBe(false);
  });

  it('does not mark it when the CP pay for the move', () => {
    const { controller } = setup(snapshot({ cp: RULES.cost.move }));
    controller.click({ kind: 'group', id: GROUP }, false);
    controller.hover({ kind: 'node', id: enemy });
    controller.overlay();
    expect(controller.ui.current.cpShort).toBe(false);
  });

  it('marks it for a while after a move is refused with NOT_ENOUGH_CP', () => {
    vi.useFakeTimers();
    try {
      const { controller, book, clock } = setup();
      controller.click({ kind: 'group', id: GROUP }, false);
      controller.click({ kind: 'node', id: enemy }, false);
      book.onAck(ack(1, 'NOT_ENOUGH_CP'));
      expect(controller.ui.current.cpShort).toBe(true);
      // The flash ends on the controller's own timer, with no frame drawn (ARC-C01).
      clock.now += CP_SHORT_FLASH_MS - 1;
      vi.advanceTimersByTime(CP_SHORT_FLASH_MS - 1);
      expect(controller.ui.current.cpShort).toBe(true);
      clock.now += 1;
      vi.advanceTimersByTime(1);
      expect(controller.ui.current.cpShort).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('another refusal does not mark it', () => {
    const { controller, book } = setup();
    controller.click({ kind: 'group', id: GROUP }, false);
    controller.click({ kind: 'node', id: enemy }, false);
    book.onAck(ack(1, 'STACK_LIMIT'));
    controller.overlay();
    expect(controller.ui.current.cpShort).toBe(false);
  });
});

describe('the bonus of a planned order (#762)', () => {
  it('caps the wheel by the charged units of the selected group (DEC-41, item 10)', () => {
    expect(planBonusCap(null)).toBe(PLAN_BONUS.max);
    expect(planBonusCap(0)).toBe(PLAN_BONUS.min);
    expect(planBonusCap(3)).toBe(3);
    expect(planBonusCap(40)).toBe(PLAN_BONUS.max);
    const { controller, clock } = setup(snapshot({ units: 6, charged: 1 }));
    controller.click({ kind: 'group', id: GROUP }, false);
    expect(controller.planBonusMax).toBe(1);
    // The most a group with one charged unit gathers is 1, whatever the wheel does.
    wheelOver(controller, clock, enemy, 0);
    expect(controller.planBonus).toBe(1);
    wheelOver(controller, clock, enemy, 1);
    expect(controller.planBonus).toBe(1);
  });

  it('steps up to the charged units and sends that bonus', () => {
    const { controller, sent, clock } = setup(snapshot({ units: 6, charged: 4 }));
    controller.click({ kind: 'group', id: GROUP }, false);
    wheelOver(controller, clock, enemy, 6);
    expect(controller.planBonus).toBe(4);
    controller.click({ kind: 'node', id: enemy }, false);
    expect(sent).toEqual([{ type: 'move', group: GROUP, dest: enemy, planned: true, bonus: 4 }]);
  });

  it('says when a planned order is being made: E held or the switch on', () => {
    const { controller } = setup();
    expect(controller.ui.current.planning).toBe(false);
    controller.key({ type: 'keydown', code: 'KeyE', shiftKey: false });
    expect(controller.ui.current.planning).toBe(true);
    controller.key({ type: 'keyup', code: 'KeyE', shiftKey: false });
    expect(controller.ui.current.planning).toBe(false);
    controller.setPlanned(true);
    expect(controller.ui.current.planning).toBe(true);
    controller.setPlanned(false);
    expect(controller.ui.current.planning).toBe(false);
  });
});

describe('factories and fortifications in the city menu (#762)', () => {
  function withFactories(built: readonly number[], building: readonly number[]): SnapshotMsg {
    const snap = snapshot();
    return {
      ...snap,
      view: {
        ...snap.view,
        nodes: snap.view.nodes.map((n) => ({
          ...n,
          factory: built.includes(n.id) ? true : n.factory,
          factory_build: building.includes(n.id) ? { done_tick: 90, owed: 0 } : n.factory_build,
        })),
      },
    };
  }

  it('offers no factory at the factory max', () => {
    const notFull = setup(withFactories([home], [second])).controller;
    expect(notFull.factoriesFull).toBe(false);
    const third = own[2];
    if (third === undefined) throw new Error('three own cities needed');
    const full = setup(withFactories([home, third.id], [second])).controller;
    expect(full.factoriesFull).toBe(true);
    expect(cityChoices(null, false, false)).toContain('factory');
    expect(cityChoices(null, false, true)).not.toContain('factory');
  });

  it('offers no "Fortify road" in a node whose every road has its line, built or being built', () => {
    const roads = DEFAULT_MAP.edges.filter((e) => e.a === home || e.b === home).map((e) => e.id);
    const snap = snapshot();
    const fortified: SnapshotMsg = {
      ...snap,
      view: {
        ...snap.view,
        edges: snap.view.edges.map((edge) => ({
          ...edge,
          forts: roads.includes(edge.id)
            ? [{ node: home, owner: 0, built: edge.id !== roads[0], done_tick: null }]
            : [],
        })),
      },
    };
    const { controller } = setup(fortified);
    expect(controller.fortifiable(home)).toBe(false);
    expect(controller.fortifiable(second)).toBe(true);
    // Neither the sector nor the key B starts a pick with nothing to pick.
    controller.click({ kind: 'node', id: home }, false);
    controller.startFortify();
    expect(controller.ui.current.fortFrom).toBeNull();
    expect(cityChoices(null, false, false, false)).not.toContain('fortify');
    // A province with nothing left to do has an empty menu (nothing is drawn).
    expect(cityChoices(null, true, false, false)).toEqual([]);
  });
});
