import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_RULES_V2, devSnapshot } from '../hud/devFeed.ts';
import { HudState } from '../hud/hudState.svelte.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { Command, LineView, SnapshotMsg } from '../protocol.gen.ts';
import { OrderBook } from './orderBook.ts';
import { OrderController, PLAN_BONUS } from './orderController.ts';

// Economy v2 (DEC-41, #649): the controls of factories, bunkers, supply lines and a gathering plan;
// the v1 controls (stance, road mode, "Defense", markers, transfers) are off.
const map = DEFAULT_MAP;
const RULES = DEV_RULES_V2;
const base = devSnapshot(map, RULES, 30);
const group = base.view.groups[0];
if (group?.location.kind !== 'node') throw new Error('the dev snapshot has no group in a node');
const home = group.location.node;
const own = new Set(base.view.nodes.filter((n) => n.owner === 0).map((n) => n.id));
// An own road out of `home`: the first step of a line drawn from it.
const road = map.edges.find(
  (e) => (e.a === home && own.has(e.b)) || (e.b === home && own.has(e.a)),
);
if (road === undefined) throw new Error('the dev snapshot has no own road out of the home node');
const next = road.a === home ? road.b : road.a;
// Another own node: the target of a line whose path the server suggests.
const far = [...own].find((n) => n !== home && n !== next);
if (far === undefined) throw new Error('the dev snapshot has three own nodes at least');
const enemy = base.view.nodes.find((n) => n.owner === 1);
if (enemy === undefined) throw new Error('the dev snapshot has no enemy node');

function setup(lines: LineView[] = []) {
  const hud = new HudState({ me: 0, nicks: ['Danya', 'Bot'], rules: RULES, map });
  const snapshot: SnapshotMsg = { ...base, view: { ...base.view, lines } };
  hud.onSnapshot(snapshot);
  const sent: Command[] = [];
  const queries: number[][] = [];
  const controller = new OrderController({
    hud,
    map,
    rules: RULES,
    book: new OrderBook(),
    send: (cmd) => sent.push(cmd),
    queryLineRoute: (points) => queries.push([...points]),
  });
  return { hud, sent, controller, queries };
}

const down = (code: string) => ({ type: 'keydown', code, shiftKey: false }) as const;

describe('OrderController under economy v2 (DEC-41)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('knows the model from the rules', () => {
    expect(setup().controller.v2).toBe(true);
  });

  it('has no stance menu, road mode or «Defense»', () => {
    const { controller, sent } = setup();
    controller.click({ kind: 'group', id: group.id }, false);
    expect(controller.key(down('KeyQ'))).toBe(false);
    expect(controller.radial.current.open).toBe(false);
    expect(controller.openRadial(true)).toBe(false);
    expect(controller.key(down('KeyU'))).toBe(false);
    expect(controller.roadMode).toBe(false);
    expect(controller.key(down('KeyD'))).toBe(false);
    expect(controller.key(down('Digit2'))).toBe(false);
    controller.toggleDefense();
    expect(sent).toEqual([]);
  });

  it('a planned order asks for the bonus of the stepper; an ordinary one for none', () => {
    const { controller, sent } = setup();
    expect(controller.planBonus).toBe(2);
    controller.key(down('BracketRight'));
    expect(controller.planBonus).toBe(3);
    controller.click({ kind: 'group', id: group.id }, false);
    controller.click({ kind: 'node', id: enemy.id }, true);
    controller.click({ kind: 'group', id: group.id }, false);
    controller.click({ kind: 'node', id: enemy.id }, false);
    expect(sent).toEqual([
      { type: 'move', group: group.id, dest: enemy.id, planned: true, bonus: 3 },
      { type: 'move', group: group.id, dest: enemy.id, planned: false, bonus: 0 },
    ]);
  });

  it('keeps the requested bonus within its range', () => {
    const { controller } = setup();
    for (let i = 0; i < 20; i++) controller.stepPlanBonus(-1);
    expect(controller.planBonus).toBe(PLAN_BONUS.min);
    for (let i = 0; i < 20; i++) controller.stepPlanBonus(1);
    expect(controller.planBonus).toBe(PLAN_BONUS.max);
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

  it('the city menu builds a factory and a bunker', () => {
    const { controller, sent } = setup();
    controller.click({ kind: 'node', id: home }, false);
    controller.chooseCity('factory');
    controller.click({ kind: 'node', id: home }, false);
    controller.chooseCity('bunker');
    expect(sent).toEqual([
      { type: 'build_factory', node: home },
      { type: 'build_bunker', node: home },
    ]);
  });

  it('draws a supply line: the menu, a click on the target, the server path, Enter (#665)', () => {
    const { controller, sent, queries } = setup();
    controller.key(down('Tab'));
    controller.click({ kind: 'node', id: home }, false);
    expect(controller.supplyMenu.current).toMatchObject({ open: true, node: home, lines: [] });
    controller.key(down('Digit1'));
    expect(controller.ui.current.lineDraft).toEqual([home]);
    expect(controller.overlay().supply).toMatchObject({ source: home, draft: [] });
    expect(controller.overlay().supply?.targets).toContain(far);
    // A node that is not own is not taken.
    controller.click({ kind: 'node', id: enemy.id }, false);
    expect(controller.ui.current.lineDraft).toEqual([home]);
    controller.click({ kind: 'node', id: far }, false);
    expect(controller.ui.current.lineDraft).toEqual([home, far]);
    expect(queries).toEqual([[home, far]]);
    // No path yet: nothing to draw, Enter waits.
    controller.key(down('Enter'));
    expect(sent).toEqual([]);
    controller.onLineRoute({
      type: 'line_route',
      points: [home, far],
      tick: 30,
      path: [home, next, far],
    });
    expect(controller.overlay().supply).toMatchObject({ draft: [home, next, far], targets: [] });
    controller.key(down('Enter'));
    expect(controller.ui.current.lineDraft).toBeNull();
    expect(sent).toEqual([{ type: 'draw_line', path: [home, next, far] }]);
  });

  it('a click routes the line through a node, again takes it off, Shift goes on to it', () => {
    const { controller, queries } = setup();
    controller.key(down('Tab'));
    controller.click({ kind: 'node', id: home }, false);
    controller.chooseLine('draw');
    controller.click({ kind: 'node', id: far }, false);
    controller.click({ kind: 'node', id: next }, false);
    expect(controller.ui.current.lineDraft).toEqual([home, next, far]);
    controller.click({ kind: 'node', id: next }, false);
    expect(controller.ui.current.lineDraft).toEqual([home, far]);
    controller.click({ kind: 'node', id: next }, true);
    expect(controller.ui.current.lineDraft).toEqual([home, far, next]);
    expect(queries).toEqual([
      [home, far],
      [home, next, far],
      [home, far],
      [home, far, next],
    ]);
    // An answer about other points than the current ones is dropped.
    controller.onLineRoute({
      type: 'line_route',
      points: [home, far],
      tick: 30,
      path: [home, far],
    });
    expect(controller.ui.current.linePath).toBeNull();
  });

  it('a click on the target confirms; Backspace steps back; Esc drops the line', () => {
    const { controller, sent } = setup();
    controller.key(down('Tab'));
    controller.click({ kind: 'node', id: home }, false);
    controller.chooseLine('draw');
    controller.click({ kind: 'node', id: far }, false);
    controller.click({ kind: 'node', id: next }, false);
    controller.key(down('Backspace'));
    expect(controller.ui.current.lineDraft).toEqual([home, far]);
    controller.key(down('Backspace'));
    expect(controller.ui.current.lineDraft).toEqual([home]);
    controller.key(down('Escape'));
    expect(controller.ui.current.lineDraft).toBeNull();
    expect(controller.supplyMode).toBe(true);
    controller.click({ kind: 'node', id: home }, false);
    controller.chooseLine('draw');
    controller.click({ kind: 'node', id: next }, false);
    controller.onLineRoute({
      type: 'line_route',
      points: [home, next],
      tick: 30,
      path: [home, next],
    });
    controller.click({ kind: 'node', id: next }, false);
    expect(sent).toEqual([{ type: 'draw_line', path: [home, next] }]);
  });

  it('the auto-extension toggle sends set_auto_lines only for a change (#665)', () => {
    const { controller, sent } = setup();
    expect(controller.autoLines).toBe(true);
    controller.setAutoLines(true);
    controller.setAutoLines(false);
    expect(sent).toEqual([{ type: 'set_auto_lines', on: false }]);
  });

  it('the supply menu lists the lines that start at the city and removes one by its key', () => {
    const { controller, sent } = setup([
      { id: 7, path: [home, next] },
      { id: 8, path: [next, home] },
    ]);
    controller.key(down('Tab'));
    controller.click({ kind: 'node', id: home }, false);
    expect(controller.supplyMenu.current.lines).toEqual([{ id: 7, to: next }]);
    controller.key(down('Digit2'));
    expect(sent).toEqual([{ type: 'remove_line', line: 7 }]);
    expect(controller.supplyMenu.current.open).toBe(false);
  });
});
