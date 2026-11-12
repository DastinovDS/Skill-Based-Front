import { describe, expect, it, vi } from 'vitest';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { HudState } from '../hud/hudState.svelte.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { Command, OrderView, RulesetPublic, SnapshotMsg } from '../protocol.gen.ts';
import { OrderBook } from './orderBook.ts';
import { CP_SHORT_FLASH_MS, OrderController } from './orderController.ts';

// The owner's marks on the pop-up catalogue (#765): a refused command is no toast, the map answers
// it. B8: a recruit or a road fortification short of CP marks the CP gauge as a move does. B21: a
// recruit refused for want of room pulses the capacity ring of its city. B10: a group waiting to
// depart is not split.
const RULES: RulesetPublic = DEV_RULES;
const snapshot = devSnapshot(DEFAULT_MAP, RULES, 30);
const first = snapshot.view.groups[0];
if (first?.location.kind !== 'node') throw new Error('the dev snapshot has no group in a node');
const home = first.location.node;
const road = DEFAULT_MAP.edges.find((e) => e.a === home || e.b === home)?.id;
if (road === undefined) throw new Error('the home city has no road');

function setup(view: SnapshotMsg = snapshot) {
  const hud = new HudState({ me: 0, nicks: ['Ember', 'Bot'], rules: RULES, map: DEFAULT_MAP });
  hud.onSnapshot(view);
  const book = new OrderBook();
  const sent: Command[] = [];
  const clock = { now: 1000 };
  const controller = new OrderController({
    hud,
    map: DEFAULT_MAP,
    rules: RULES,
    book,
    send: (cmd) => sent.push(cmd),
    now: () => clock.now,
  });
  return { hud, book, sent, controller, clock };
}

const ack = (seq: number, reject_code: string | null) =>
  ({
    type: 'ack',
    seq,
    applied_tick: 31,
    path: null,
    arrive_tick: null,
    reject_code,
    kind: null,
    cost: null,
    members: null,
  }) as const;

describe('a recruit or a fortification short of CP flashes the CP gauge (#765, B8)', () => {
  it('marks the gauge with the recruit price, then lets it go', () => {
    vi.useFakeTimers();
    try {
      const { controller, book, clock } = setup();
      controller.click({ kind: 'node', id: home }, false);
      controller.recruit();
      expect(controller.ui.current.cpShort).toBe(false);
      book.onAck(ack(1, 'NOT_ENOUGH_CP'));
      expect(controller.ui.current.cpShort).toBe(true);
      expect(controller.ui.current.cpPrice).toBe(RULES.cost.recruit);
      // The next steps keep the price of the refused recruit, not of a move.
      controller.hover(null);
      expect(controller.ui.current.cpPrice).toBe(RULES.cost.recruit);
      clock.now += CP_SHORT_FLASH_MS;
      vi.advanceTimersByTime(CP_SHORT_FLASH_MS);
      expect(controller.ui.current.cpShort).toBe(false);
      expect(controller.ui.current.cpPrice).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks the gauge with the price of a road fortification', () => {
    const { controller, book, sent } = setup();
    controller.click({ kind: 'node', id: home }, false);
    controller.startFortify();
    controller.click({ kind: 'edge', id: road }, false);
    expect(sent).toEqual([{ type: 'fortify_road', node: home, edge: road }]);
    book.onAck(ack(1, 'NOT_ENOUGH_CP'));
    expect(controller.ui.current.cpShort).toBe(true);
    expect(controller.ui.current.cpPrice).toBe(RULES.fort.cost);
  });

  it('does not mark the gauge for a refusal that is not about CP', () => {
    const { controller, book } = setup();
    controller.click({ kind: 'node', id: home }, false);
    controller.recruit();
    book.onAck(ack(1, 'QUEUE_FULL'));
    expect(controller.ui.current.cpShort).toBe(false);
  });
});

describe('a recruit with no room pulses the capacity ring (#765, B21)', () => {
  it('hands the city and the time of the refusal to the map', () => {
    const { controller, book, clock } = setup();
    expect(controller.overlay().cityFull ?? null).toBeNull();
    controller.click({ kind: 'node', id: home }, false);
    controller.recruit();
    clock.now = 4321;
    book.onAck(ack(1, 'CITY_FULL'));
    expect(controller.overlay().cityFull).toEqual({ node: home, at: 4321 });
  });

  it('pulses nothing for another refusal of a recruit', () => {
    const { controller, book } = setup();
    controller.click({ kind: 'node', id: home }, false);
    controller.recruit();
    book.onAck(ack(1, 'NOT_ENOUGH_CP'));
    expect(controller.overlay().cityFull ?? null).toBeNull();
  });
});

describe('a group waiting to depart (#765, B10)', () => {
  const dest = snapshot.view.nodes.find((n) => n.owner === 1)?.id ?? 0;
  const order: OrderView = {
    dest,
    path: [home, dest],
    planned: true,
    bonus: 0,
    gathering: true,
    plan: 1,
    next_charge_tick: null,
    depart_tick: null,
    arrive_tick: null,
    group_order: null,
  };
  const waiting: SnapshotMsg = {
    ...snapshot,
    view: {
      ...snapshot.view,
      groups: snapshot.view.groups.map((g) =>
        g.id === first.id ? { ...g, units: Math.max(2, g.units), order } : g,
      ),
    },
  };

  it('is waiting and does not open the split menu; a group without an order does', () => {
    const busy = setup(waiting);
    busy.controller.click({ kind: 'group', id: first.id }, false);
    const group = busy.hud.current?.group;
    if (group == null) throw new Error('not selected');
    expect(busy.controller.isWaiting(group)).toBe(true);
    busy.controller.toggleSplit();
    expect(busy.controller.splitMenu.current.open).toBe(false);
    expect(busy.controller.mergeCandidates()).toEqual([]);
    const free = setup({
      ...waiting,
      view: {
        ...waiting.view,
        groups: waiting.view.groups.map((g) => (g.id === first.id ? { ...g, order: null } : g)),
      },
    });
    free.controller.click({ kind: 'group', id: first.id }, false);
    free.controller.toggleSplit();
    expect(free.controller.splitMenu.current.open).toBe(true);
  });
});
