import { describe, expect, it } from 'vitest';
import { DEV_RULES, DEV_RULES_GROUP, devSnapshot } from '../hud/devFeed.ts';
import { HudState } from '../hud/hudState.svelte.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type {
  AckMember,
  Command,
  GroupView,
  NodeView,
  RulesetPublic,
  SnapshotMsg,
} from '../protocol.gen.ts';
import { OrderBook } from './orderBook.ts';
import type { OrderFeedback } from './orderUi.svelte.ts';
import { OrderController, rallyPrice } from './orderController.ts';

// The group order and the recruit rally point (DEC-48, item K; #896) on the rules of `mvp-7`.
const RULES = DEV_RULES_GROUP;
const base = devSnapshot(DEFAULT_MAP, RULES, 30);
const own = base.view.nodes.filter((n) => n.owner === 0).map((n) => n.id);
const enemyNode = base.view.nodes.find((n) => n.owner === 1);
const [a, b, c, d] = own;
if (a === undefined || b === undefined || c === undefined || d === undefined) {
  throw new Error('the dev snapshot lacks four own nodes');
}
if (enemyNode === undefined) throw new Error('the dev snapshot lacks an enemy node');
const enemy = enemyNode.id;

const groupAt = (id: string, node: number, units: number, charged: number): GroupView => ({
  id,
  units,
  charged,
  mode: 'attack',
  location: { kind: 'node', node },
  order: null,
});

const GROUPS: readonly GroupView[] = [
  groupAt('g1', a, 3, 3),
  groupAt('g2', b, 2, 2),
  groupAt('g3', c, 2, 1),
];

function snapshot(
  groups: readonly GroupView[] = GROUPS,
  cp = 1000,
  nodes?: (n: NodeView) => NodeView,
): SnapshotMsg {
  return {
    ...base,
    view: {
      ...base.view,
      me: { ...base.view.me, cp },
      groups: [...groups],
      nodes: nodes === undefined ? base.view.nodes : base.view.nodes.map(nodes),
    },
  };
}

function setup(rules: RulesetPublic = RULES, snap: SnapshotMsg = snapshot()) {
  const hud = new HudState({ me: 0, nicks: ['Ember', 'Bot'], rules, map: DEFAULT_MAP });
  hud.onSnapshot(snap);
  const book = new OrderBook(() => 0);
  const sent: Command[] = [];
  const feedback: OrderFeedback[] = [];
  const queried: string[] = [];
  const controller = new OrderController({
    hud,
    map: DEFAULT_MAP,
    rules,
    book,
    send: (cmd) => sent.push(cmd),
    now: () => 0,
    queryReach: (group) => queried.push(group),
  });
  controller.ui.onFeedback((f) => feedback.push(f));
  return { hud, book, sent, feedback, queried, controller };
}

/** Selects g1, g2 and g3 together, in that order. */
function pickAll(controller: OrderController): void {
  controller.click({ kind: 'group', id: 'g1', node: a }, false);
  controller.click({ kind: 'group', id: 'g2', node: b }, true);
  controller.click({ kind: 'group', id: 'g3', node: c }, true);
}

const eDown = { type: 'keydown', code: 'KeyE', shiftKey: false } as const;

describe('the selection of several groups (DEC-48, item K1)', () => {
  it('Shift+click adds a group and takes it out again; one left is the ordinary selection', () => {
    const { controller, hud } = setup();
    controller.click({ kind: 'group', id: 'g1', node: a }, false);
    expect(hud.selection).toEqual({ kind: 'group', id: 'g1' });
    controller.click({ kind: 'group', id: 'g2', node: b }, true);
    expect(controller.picks).toEqual(['g1', 'g2']);
    expect(controller.ui.current.picks).toEqual(['g1', 'g2']);
    expect(hud.selection).toBeNull();
    controller.click({ kind: 'group', id: 'g3', node: c }, true);
    expect(controller.overlay().picks).toEqual(['g1', 'g2', 'g3']);
    controller.click({ kind: 'group', id: 'g2', node: b }, true);
    expect(controller.picks).toEqual(['g1', 'g3']);
    controller.click({ kind: 'group', id: 'g3', node: c }, true);
    expect(controller.picks).toEqual([]);
    expect(hud.selection).toEqual({ kind: 'group', id: 'g1' });
  });

  it('a box adds the own groups inside it, in the order given; Esc lets them all go', () => {
    const { controller } = setup();
    controller.selectBox(['g2', 'enemy-1', 'g3']);
    expect(controller.picks).toEqual(['g2', 'g3']);
    controller.selectBox(['g1', 'g2']);
    expect(controller.picks).toEqual(['g2', 'g3', 'g1']);
    expect(controller.isIdle()).toBe(false);
    controller.key({ type: 'keydown', code: 'Escape', shiftKey: false });
    expect(controller.picks).toEqual([]);
    expect(controller.isIdle()).toBe(true);
  });

  it('without the group order in the rules Shift does not select: the click is a plain one', () => {
    const { controller, hud } = setup(DEV_RULES);
    controller.click({ kind: 'group', id: 'g1', node: a }, false);
    controller.click({ kind: 'group', id: 'g2', node: b }, true);
    expect(controller.picks).toEqual([]);
    expect(hud.selection).toBeNull();
    controller.selectBox(['g1', 'g2']);
    expect(controller.picks).toEqual([]);
  });

  it('a group that is gone leaves the selection', () => {
    const { controller, hud } = setup();
    pickAll(controller);
    hud.onSnapshot(snapshot(GROUPS.filter((g) => g.id !== 'g2')));
    controller.overlay();
    expect(controller.picks).toEqual(['g1', 'g3']);
  });
});

describe('one command for the selection (DEC-48, items B1, K4, K5)', () => {
  it('a click on an enemy node sends one group_move in the order of the selection', () => {
    const { controller, sent, book, hud } = setup();
    pickAll(controller);
    controller.click({ kind: 'node', id: enemy }, false);
    expect(sent).toEqual([
      { type: 'group_move', groups: ['g1', 'g2', 'g3'], dest: enemy, planned: false, bonus: 0 },
    ]);
    // A ghost per member from its node (a straight line until the ack brings the paths).
    expect(book.ghosts().map((g) => [g.group, g.from, g.dest])).toEqual([
      ['g1', a, enemy],
      ['g2', b, enemy],
      ['g3', c, enemy],
    ]);
    expect(controller.picks).toEqual([]);
    expect(hud.selection).toBeNull();
  });

  it('a single selected group still sends a move (item K5)', () => {
    const { controller, sent } = setup();
    controller.click({ kind: 'group', id: 'g1', node: a }, false);
    controller.click({ kind: 'node', id: enemy }, false);
    expect(sent[0]).toMatchObject({ type: 'move', group: 'g1', dest: enemy });
  });

  it('prices the order before the click: a rally half a move a group rounded up, an attack a move each', () => {
    const { controller } = setup();
    pickAll(controller);
    controller.hover({ kind: 'node', id: d });
    const rally = controller.overlay().group;
    expect(rally).toMatchObject({ kind: 'rally', to: d, from: [a, b, c], planned: false });
    // 3 groups, a move of 1 CP, 50%: 2 CP (DEC-48, item A2).
    expect(rally?.price).toBe('2');
    expect(controller.ui.current.cpPrice).toBe(200);
    controller.hover({ kind: 'node', id: enemy });
    expect(controller.overlay().group).toMatchObject({ kind: 'attack', price: '3' });
    expect(controller.ui.current.cpPrice).toBe(3 * RULES.cost.move);
  });

  it('follows the rounding of item A2 for 1 to 6 groups', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => rallyPrice(n, 100, 50))).toEqual([
      100, 100, 200, 200, 300, 300,
    ]);
  });

  it('E held: a planned attack with the requested total, never a planned rally (item G1)', () => {
    const { controller, sent } = setup();
    pickAll(controller);
    controller.key(eDown);
    controller.hover({ kind: 'node', id: enemy });
    expect(controller.overlay().group?.planned).toBe(true);
    // E + wheel steps the total, up to the charged units of the selection (3 + 2 + 1).
    for (let i = 0; i < 9; i++) {
      controller.wheel({ deltaX: 0, deltaY: -100, deltaMode: 1, shiftKey: false });
    }
    expect(controller.planBonus).toBe(6);
    expect(controller.overlay().bonus).toMatchObject({ node: enemy, bonus: 6, max: 6 });
    controller.click({ kind: 'node', id: enemy }, false);
    expect(sent).toEqual([
      { type: 'group_move', groups: ['g1', 'g2', 'g3'], dest: enemy, planned: true, bonus: 6 },
    ]);
    pickAll(controller);
    controller.click({ kind: 'node', id: d }, false);
    expect(sent[1]).toMatchObject({ type: 'group_move', dest: d, planned: false, bonus: 0 });
  });

  it('a lost focus lets E go: the next click is an ordinary order (item K2)', () => {
    const { controller, sent } = setup();
    controller.key(eDown);
    expect(controller.planned).toBe(true);
    controller.key({ type: 'keyup', code: '', shiftKey: false });
    expect(controller.planned).toBe(false);
    controller.click({ kind: 'group', id: 'g1', node: a }, false);
    controller.click({ kind: 'node', id: enemy }, false);
    expect(sent[0]).toMatchObject({ type: 'move', planned: false });
  });

  it('X cancels the order of every selected group that has one', () => {
    const ordered = GROUPS.map((g) =>
      g.id === 'g3'
        ? g
        : {
            ...g,
            order: {
              dest: enemy,
              path: [enemy] as [number],
              planned: false,
              bonus: 0,
              gathering: false,
              plan: 0,
              next_charge_tick: null,
              depart_tick: 60,
              group_order: 'go-1',
              arrive_tick: 90,
            },
          },
    );
    const { controller, sent } = setup(RULES, snapshot(ordered));
    pickAll(controller);
    controller.key({ type: 'keydown', code: 'KeyX', shiftKey: false });
    expect(sent).toEqual([
      { type: 'cancel_order', group: 'g1' },
      { type: 'cancel_order', group: 'g2' },
    ]);
    expect(controller.picks).toEqual([]);
  });
});

describe('the answer to a group order (DEC-48, items B3 to B6)', () => {
  const member = (reject_code: string | null): AckMember => ({
    path: reject_code === null ? [0, 1] : null,
    depart_tick: reject_code === null ? 31 : null,
    arrive_tick: reject_code === null ? 60 : null,
    bonus: 0,
    reject_code,
  });

  it('short of CP: refused as a whole, the CP badge marked with the price of the order', () => {
    const { controller, book, feedback } = setup();
    pickAll(controller);
    controller.click({ kind: 'node', id: enemy }, false);
    book.onAck({
      type: 'ack',
      seq: 1,
      applied_tick: 31,
      path: null,
      arrive_tick: null,
      reject_code: 'NOT_ENOUGH_CP',
      kind: null,
      cost: null,
      members: null,
    });
    expect(feedback.at(-1)).toMatchObject({ kind: 'rejected', code: 'NOT_ENOUGH_CP' });
    expect(controller.ui.current.cpShort).toBe(true);
    expect(controller.ui.current.cpPrice).toBe(3 * RULES.cost.move);
    expect(book.ghosts().every((g) => g.status === 'rejected')).toBe(true);
  });

  it('dropped groups: a feedback per code; the one too big gets the split offer of #762', () => {
    const { controller, book, feedback, hud, queried } = setup();
    pickAll(controller);
    controller.click({ kind: 'node', id: enemy }, false);
    book.onAck({
      type: 'ack',
      seq: 1,
      applied_tick: 31,
      path: null,
      arrive_tick: 60,
      reject_code: null,
      kind: 'attack',
      cost: 100,
      members: [member('STACK_LIMIT'), member(null), member('GROUP_BUSY')],
    });
    expect(feedback.filter((f) => f.kind === 'dropped')).toEqual([
      expect.objectContaining({ code: 'STACK_LIMIT', count: 1 }),
      expect.objectContaining({ code: 'GROUP_BUSY', count: 1 }),
    ]);
    // The accepted group goes on; the dropped ones show their refusal.
    expect(book.ghosts().map((g) => [g.group, g.status])).toEqual([
      ['g1', 'rejected'],
      ['g2', 'accepted'],
      ['g3', 'rejected'],
    ]);
    expect(hud.selection).toEqual({ kind: 'group', id: 'g1' });
    controller.overlay();
    expect(queried).toContain('g1');
    controller.onReach({
      type: 'reach',
      group: 'g1',
      tick: 31,
      nodes: [],
      split: [{ node: enemy, units: 2 }],
    });
    expect(controller.splitMenu.current).toMatchObject({
      open: true,
      group: 'g1',
      n: 2,
      dest: enemy,
    });
  });
});

describe('the release goes under the group order (DEC-48, items A7, K6)', () => {
  it('F is not taken and nothing is sent', () => {
    const { controller, sent } = setup();
    expect(controller.canRelease).toBe(false);
    controller.click({ kind: 'group', id: 'g1', node: a }, false);
    expect(controller.key({ type: 'keydown', code: 'KeyF', shiftKey: false })).toBe(false);
    controller.releasePlan();
    expect(sent).toEqual([]);
    expect(setup(DEV_RULES).controller.canRelease).toBe(true);
  });
});

describe('the recruit rally point (DEC-48, items H, K7)', () => {
  it('the sector or P asks for the node, a click sets the point', () => {
    const { controller, sent } = setup();
    controller.click({ kind: 'node', id: a }, false);
    controller.chooseCity('rally');
    expect(controller.ui.current.rallyFrom).toBe(a);
    expect(controller.overlay().rallyFrom).toBe(a);
    controller.hover({ kind: 'node', id: b });
    expect(controller.overlay().hover).toEqual({ node: b, group: null });
    controller.click({ kind: 'node', id: b }, false);
    expect(sent).toEqual([{ type: 'set_rally_point', node: a, target: b }]);
    expect(controller.ui.current.rallyFrom).toBeNull();
  });

  it('Esc or a click on nothing drops the pick; P starts it from the selected city', () => {
    const { controller, sent } = setup();
    controller.click({ kind: 'node', id: a }, false);
    expect(controller.key({ type: 'keydown', code: 'KeyP', shiftKey: false })).toBe(true);
    expect(controller.ui.current.rallyFrom).toBe(a);
    controller.key({ type: 'keydown', code: 'Escape', shiftKey: false });
    expect(controller.ui.current.rallyFrom).toBeNull();
    controller.click({ kind: 'node', id: a }, false);
    controller.startRally();
    controller.click(null, false);
    expect(controller.ui.current.rallyFrom).toBeNull();
    expect(sent).toEqual([]);
  });

  it('a city with a point clears it at once', () => {
    const snap = snapshot(GROUPS, 1000, (n) => (n.id === a ? { ...n, rally_point: b } : n));
    const { controller, sent } = setup(RULES, snap);
    controller.click({ kind: 'node', id: a }, false);
    controller.chooseCity('rally');
    expect(sent).toEqual([{ type: 'set_rally_point', node: a, target: null }]);
    expect(controller.ui.current.rallyFrom).toBeNull();
  });

  it('without the rally point in the rules P is not taken', () => {
    const { controller } = setup(DEV_RULES);
    controller.click({ kind: 'node', id: a }, false);
    expect(controller.key({ type: 'keydown', code: 'KeyP', shiftKey: false })).toBe(false);
  });
});
