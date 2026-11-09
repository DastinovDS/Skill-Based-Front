import { describe, expect, it } from 'vitest';
import { cityChoices } from '../hud/cityChoices.ts';
import { DEV_RULES_FLOW, devSnapshot } from '../hud/devFeed.ts';
import { HudState } from '../hud/hudState.svelte.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { Command, MapFile, RulesetPublic, SnapshotMsg } from '../protocol.gen.ts';
import { OrderBook } from './orderBook.ts';
import { OrderController } from './orderController.ts';

// Road fortifications (DEC-43, item D; #707): "Fortify road" in the menu of an own city or province,
// then the road pick; the price, the checks and the rejects are the server's call.
const RULES = DEV_RULES_FLOW;
const base = devSnapshot(DEFAULT_MAP, RULES, 30);
const homeNode = base.view.nodes.find((n) => n.owner === 0 && n.warehouse_cap !== null);
if (homeNode === undefined) throw new Error('the dev snapshot has no own city');
const home = homeNode.id;
const enemy = base.view.nodes.find((n) => n.owner === 1);
if (enemy === undefined) throw new Error('the dev snapshot has no enemy node');
const roads = DEFAULT_MAP.edges.filter((e) => e.a === home || e.b === home).map((e) => e.id);
if (roads.length < 2) throw new Error('the own city needs two roads');
const [road, other] = roads as [number, number];

const down = (code: string) => ({ type: 'keydown', code, shiftKey: false }) as const;

function snapshotWith(forts: Readonly<Record<number, readonly number[]>>): SnapshotMsg {
  return {
    ...base,
    view: {
      ...base.view,
      edges: base.view.edges.map((edge) => ({
        ...edge,
        forts: (forts[edge.id] ?? []).map((node) => ({
          node,
          owner: node === home ? 0 : 1,
          built: true,
          done_tick: null,
        })),
      })),
    },
  };
}

function setup(
  rules: RulesetPublic = RULES,
  snapshot: SnapshotMsg = base,
  map: MapFile = DEFAULT_MAP,
) {
  const hud = new HudState({ me: 0, nicks: ['Ember', 'Bot'], rules, map });
  hud.onSnapshot(snapshot);
  const sent: Command[] = [];
  const controller = new OrderController({
    hud,
    map,
    rules,
    book: new OrderBook(),
    send: (cmd) => sent.push(cmd),
  });
  return { hud, sent, controller };
}

/** The city menu, then "Fortify road": the pick is on. */
function startPick(c: OrderController): void {
  c.click({ kind: 'node', id: home }, false);
  c.chooseCity('fortify');
}

describe('the rules: mvp-4 has road fortifications, the others have none', () => {
  it('offers the sector in the menu of a city and of a province, only with the feature', () => {
    const on = { enabled: false, warehouse_max_level: 0 };
    expect(cityChoices(on, null, true, false, false, true)).toContain('fortify');
    expect(cityChoices(on, null, true, false, false, false)).not.toContain('fortify');
    // A province has no bunker in mvp-4, but its menu holds this one.
    expect(cityChoices(on, null, true, true, false, true)).toEqual(['fortify']);
    expect(cityChoices(on, null, true, true, false, false)).toEqual([]);
    // Without economy v2 nothing changes.
    expect(cityChoices(on, null, false, false, false, true)).not.toContain('fortify');
  });
});

describe('Fortify road: the road pick', () => {
  it('the sector closes the menu and asks for the road: every road of the node, ghost on each', () => {
    const { controller, hud } = setup();
    startPick(controller);
    expect(controller.cityMenu.current.open).toBe(false);
    expect(hud.selection).toBeNull();
    const pick = controller.overlay().fortPick;
    expect(pick?.node).toBe(home);
    expect([...(pick?.edges ?? [])].sort()).toEqual([...roads].sort());
    expect(pick?.hover).toBeNull();
    expect(pick?.cost).toBe('1.5 CP');
  });

  it('offers no road that already has a line of this node, internal roads included', () => {
    const { controller } = setup(RULES, snapshotWith({ [road]: [home] }));
    startPick(controller);
    expect(controller.overlay().fortPick?.edges).not.toContain(road);
    expect(controller.overlay().fortPick?.edges).toContain(other);
    // The line of the other end of the road does not count.
    const theirs = setup(RULES, snapshotWith({ [road]: [enemy.id] }));
    startPick(theirs.controller);
    expect(theirs.controller.overlay().fortPick?.edges).toContain(road);
  });

  it('a click on a road of the pick sends fortify_road for the node and the road, and ends the pick', () => {
    const { controller, sent } = setup();
    startPick(controller);
    controller.click({ kind: 'edge', id: road }, false);
    expect(sent).toEqual([{ type: 'fortify_road', node: home, edge: road }]);
    expect(controller.overlay().fortPick).toBeNull();
    expect(controller.isIdle()).toBe(true);
  });

  it('shows the road under the pointer as the hover, and none when it is not on offer', () => {
    const { controller } = setup();
    startPick(controller);
    controller.hover({ kind: 'edge', id: road });
    expect(controller.overlay().fortPick?.hover).toBe(road);
    controller.hover({ kind: 'node', id: home });
    expect(controller.overlay().fortPick?.hover).toBeNull();
    const farRoad = DEFAULT_MAP.edges.find((e) => e.a !== home && e.b !== home);
    if (farRoad === undefined) throw new Error('every road touches the node');
    controller.hover({ kind: 'edge', id: farRoad.id });
    expect(controller.overlay().fortPick?.hover).toBeNull();
  });

  it('Esc cancels and sends nothing', () => {
    const { controller, sent } = setup();
    startPick(controller);
    expect(controller.key(down('Escape'))).toBe(true);
    expect(controller.overlay().fortPick).toBeNull();
    expect(sent).toEqual([]);
  });

  it('a click anywhere else cancels, sends nothing and selects nothing', () => {
    const { controller, sent, hud } = setup();
    startPick(controller);
    controller.click(null, false);
    expect(controller.overlay().fortPick).toBeNull();
    startPick(controller);
    controller.click({ kind: 'node', id: enemy.id }, false);
    expect(controller.overlay().fortPick).toBeNull();
    startPick(controller);
    controller.click({ kind: 'edge', id: road + 1000 }, false);
    expect(controller.overlay().fortPick).toBeNull();
    expect(sent).toEqual([]);
    expect(hud.selection).toBeNull();
    expect(controller.cityMenu.current.open).toBe(false);
  });

  it('is not idle while picking, so Esc does not count towards leaving the match', () => {
    const { controller } = setup();
    startPick(controller);
    expect(controller.isIdle()).toBe(false);
  });

  it('B does the same as the sector, only for a selected own city', () => {
    const { controller } = setup();
    expect(controller.key(down('KeyB'))).toBe(false);
    controller.click({ kind: 'node', id: home }, false);
    expect(controller.key(down('KeyB'))).toBe(true);
    expect(controller.overlay().fortPick?.node).toBe(home);
  });

  it('a click on the city itself cancels it too, and so does the Supply mode', () => {
    const { controller } = setup();
    startPick(controller);
    controller.click({ kind: 'node', id: home }, false);
    expect(controller.overlay().fortPick).toBeNull();
    startPick(controller);
    controller.key(down('Tab'));
    expect(controller.overlay().fortPick).toBeNull();
  });

  it('the pick ends when the city is lost meanwhile', () => {
    const { controller, hud } = setup();
    startPick(controller);
    hud.onSnapshot({
      ...base,
      tick: 40,
      view: {
        ...base.view,
        nodes: base.view.nodes.map((n) => (n.id === home ? { ...n, owner: 1 } : n)),
      },
    });
    expect(controller.overlay().fortPick).toBeNull();
  });

  it('sends nothing without a match to send to (selection only)', () => {
    const hud = new HudState({ me: 0, nicks: ['Ember', 'Bot'], rules: RULES, map: DEFAULT_MAP });
    hud.onSnapshot(base);
    const controller = new OrderController({
      hud,
      map: DEFAULT_MAP,
      rules: RULES,
      book: new OrderBook(),
      send: null,
    });
    controller.startFortify();
    expect(controller.overlay().fortPick).toBeNull();
  });
});

describe('an own province under mvp-4 can fortify its roads (DEC-43, item D)', () => {
  const province = base.view.nodes.find((n) => n.owner === 0 && n.id !== home)?.id;
  if (province === undefined) throw new Error('the dev snapshot lacks a second own node');
  const map: MapFile = {
    ...DEFAULT_MAP,
    nodes: DEFAULT_MAP.nodes.map((n) => (n.id === province ? { ...n, kind: 'province' } : n)),
  };

  it('is selected and has a menu, though the rules have no bunker', () => {
    const { controller, hud } = setup(RULES, base, map);
    controller.click({ kind: 'node', id: province }, false);
    expect(hud.selection).toEqual({ kind: 'node', id: province });
    expect(controller.cityMenu.current.open).toBe(true);
    controller.chooseCity('fortify');
    expect(controller.overlay().fortPick?.node).toBe(province);
  });
});
