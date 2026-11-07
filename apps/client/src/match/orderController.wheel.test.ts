import { describe, expect, it } from 'vitest';
import { DEV_RULES_FLOW, devSnapshot } from '../hud/devFeed.ts';
import { HudState } from '../hud/hudState.svelte.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { Command, GroupView, SnapshotMsg } from '../protocol.gen.ts';
import { OrderBook } from './orderBook.ts';
import { OrderController, PLAN_BONUS } from './orderController.ts';
import { WHEEL_GESTURE_GAP_MS } from './wheelSteps.ts';

// The planned order bonus by Shift, hover and wheel (#793), on the `mvp-4` rules (economy v2).
const RULES = DEV_RULES_FLOW;
const base = devSnapshot(DEFAULT_MAP, RULES, 30);
const homeNode = base.view.nodes.find((n) => n.owner === 0 && n.warehouse_cap !== null);
const enemyNode = base.view.nodes.find((n) => n.owner === 1);
if (homeNode === undefined || enemyNode === undefined) {
  throw new Error('the dev snapshot lacks nodes');
}
const home = homeNode.id;
const enemy = enemyNode.id;
const farNode = base.view.nodes.find((n) => n.id !== home && n.id !== enemy);
if (farNode === undefined) throw new Error('the dev snapshot lacks a third node');
const far = farNode.id;
const GROUP = 'g-wheel';

function snapshot(charged: number): SnapshotMsg {
  const group: GroupView = {
    id: GROUP,
    units: 9,
    charged,
    mode: 'attack',
    location: { kind: 'node', node: home },
    order: null,
    defense_bonus: null,
    defense_cap: null,
  };
  return { ...base, view: { ...base.view, me: { ...base.view.me, cp: 1000 }, groups: [group] } };
}

function setup(charged = 9) {
  const hud = new HudState({ me: 0, nicks: ['Ember', 'Bot'], rules: RULES, map: DEFAULT_MAP });
  hud.onSnapshot(snapshot(charged));
  const sent: Command[] = [];
  const clock = { now: 1000 };
  const controller = new OrderController({
    hud,
    map: DEFAULT_MAP,
    rules: RULES,
    book: new OrderBook(() => clock.now),
    send: (cmd) => sent.push(cmd),
    now: () => clock.now,
    queryReach: () => undefined,
  });
  controller.click({ kind: 'group', id: GROUP }, false);
  // The frame asks the server where the group goes; the answer comes after the query.
  controller.overlay();
  controller.onReach({
    type: 'reach',
    group: GROUP,
    tick: 30,
    nodes: [{ node: enemy, ticks: 40, path: [home, enemy] }],
    split: [],
  });
  return { controller, sent, clock };
}

const shiftDown = { type: 'keydown', code: 'ShiftLeft', shiftKey: true } as const;
const shiftUp = { type: 'keyup', code: 'ShiftLeft', shiftKey: false } as const;
/** One wheel event in pixels: up (negative) raises the bonus. */
const roll = (deltaY: number, shiftKey = true) =>
  ({ deltaX: 0, deltaY, deltaMode: 0, shiftKey }) as const;

/** Turns the wheel `n` notches of 100 px, a pause apart (`n` < 0: down). */
function turn(controller: OrderController, clock: { now: number }, n: number): boolean[] {
  const used: boolean[] = [];
  for (let i = 0; i < Math.abs(n); i++) {
    clock.now += WHEEL_GESTURE_GAP_MS;
    used.push(controller.wheel(roll(n > 0 ? -100 : 100)));
  }
  return used;
}

describe('the plan bonus by Shift, hover and wheel (#793)', () => {
  it('Shift over a reachable target: the ghost and the counter with the bonus and its time', () => {
    const { controller } = setup();
    controller.hover({ kind: 'node', id: enemy });
    expect(controller.overlay().bonus).toBeNull();
    controller.key(shiftDown);
    const overlay = controller.overlay();
    expect(overlay.preview).toEqual({ from: home, to: enemy, planned: true, path: [home, enemy] });
    // The banner's value, the cap, and one `plan_ticks_per_bonus` per point (DEC-41, item 10).
    expect(overlay.bonus).toEqual({
      node: enemy,
      bonus: controller.planBonus,
      max: PLAN_BONUS.max,
      ticks: controller.planBonus * RULES.orders.plan_ticks_per_bonus,
    });
    // Shift up: an ordinary order, no counter.
    controller.key(shiftUp);
    expect(controller.overlay().bonus).toBeNull();
    expect(controller.overlay().preview?.planned).toBe(false);
  });

  it('no ghost and no counter over a target the server does not list', () => {
    const { controller } = setup();
    controller.key(shiftDown);
    controller.hover({ kind: 'node', id: far });
    expect(controller.overlay().preview).toBeNull();
    expect(controller.overlay().bonus).toBeNull();
  });

  it('the wheel with Shift steps the bonus, one notch one step, the same value as [ ]', () => {
    const { controller, clock } = setup();
    controller.key(shiftDown);
    controller.hover({ kind: 'node', id: enemy });
    const start = controller.planBonus;
    expect(turn(controller, clock, 2)).toEqual([true, true]);
    expect(controller.planBonus).toBe(start + 2);
    expect(controller.overlay().bonus?.bonus).toBe(start + 2);
    controller.key({ type: 'keydown', code: 'BracketLeft', shiftKey: true });
    expect(controller.planBonus).toBe(start + 1);
    turn(controller, clock, -1);
    expect(controller.planBonus).toBe(start);
    // The banner's buttons call the same stepper.
    controller.stepPlanBonus(1);
    expect(controller.overlay().bonus?.bonus).toBe(start + 1);
  });

  it('keeps the wheel within 1 and the charged units of the group', () => {
    const { controller, clock } = setup(3);
    controller.key(shiftDown);
    controller.hover({ kind: 'node', id: enemy });
    turn(controller, clock, 10);
    expect(controller.planBonus).toBe(3);
    expect(controller.overlay().bonus).toMatchObject({ bonus: 3, max: 3 });
    turn(controller, clock, -10);
    expect(controller.planBonus).toBe(PLAN_BONUS.min);
  });

  it('a trackpad swipe does not jump to the cap', () => {
    const { controller, clock } = setup();
    controller.key(shiftDown);
    const start = controller.planBonus;
    for (let i = 0; i < 40; i++) {
      clock.now += 16;
      controller.wheel(roll(-5));
    }
    // 200 px a frame apart: the first event and one full step after it.
    expect(controller.planBonus).toBe(start + 2);
  });

  it('without Shift the wheel is left to the zoom; Shift up starts the gathering afresh', () => {
    const { controller, clock } = setup();
    const start = controller.planBonus;
    expect(controller.wheel(roll(-100, false))).toBe(false);
    expect(controller.planBonus).toBe(start);
    controller.key(shiftDown);
    clock.now += 16;
    controller.wheel(roll(-5));
    clock.now += 16;
    controller.wheel(roll(-90));
    expect(controller.planBonus).toBe(start + 1);
    controller.key(shiftUp);
    controller.key(shiftDown);
    // The 90 px gathered before Shift went up are gone: a new gesture, one step at once.
    clock.now += 16;
    controller.wheel(roll(-20));
    expect(controller.planBonus).toBe(start + 2);
  });

  it('a click sends the planned order with the bonus the wheel chose', () => {
    const { controller, sent, clock } = setup();
    controller.key(shiftDown);
    controller.hover({ kind: 'node', id: enemy });
    turn(controller, clock, 3);
    const bonus = controller.planBonus;
    controller.click({ kind: 'node', id: enemy }, true);
    expect(sent).toEqual([{ type: 'move', group: GROUP, dest: enemy, planned: true, bonus }]);
  });

  it('without a selected group the wheel zooms even with Shift', () => {
    const { controller } = setup();
    controller.deselect();
    expect(controller.wheel(roll(-100))).toBe(false);
  });
});
