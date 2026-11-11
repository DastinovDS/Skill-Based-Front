import { describe, expect, it } from 'vitest';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { HudState } from '../hud/hudState.svelte.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type {
  Command,
  FightView,
  GroupView,
  Retreat,
  RulesetPublic,
  SnapshotMsg,
} from '../protocol.gen.ts';
import { OrderBook } from './orderBook.ts';
import { OrderController } from './orderController.ts';

// No retreat from a fight (DEC-40, #626): under `combat.retreat = "none"` a group in a fight gets
// no move and no cancel from the client; under `"round"` (older rulesets) everything stays.
const map = DEFAULT_MAP;
const rulesOf = (retreat: Retreat): RulesetPublic => ({
  ...DEV_RULES,
  combat: { ...DEV_RULES.combat, retreat },
});
const base = devSnapshot(map, DEV_RULES, 30);
const first = base.view.groups[0];
if (first?.location.kind !== 'node') throw new Error('the dev snapshot has no group in a node');
const home = first.location.node;
const target = base.view.nodes.find((n) => n.owner === 0 && n.id !== home)?.id;
if (target === undefined) throw new Error('a second own node is needed');

const GROUP = 'g-fight';
const orderOf = (planned: boolean): NonNullable<GroupView['order']> => ({
  dest: target,
  path: [target],
  planned,
  bonus: 0,
  gathering: false,
  plan: 0,
  next_charge_tick: null,
  depart_tick: null,
  group_order: null,
  arrive_tick: null,
});
const group = (order: GroupView['order']): GroupView => ({ ...first, id: GROUP, order });
const snapshotOf = (groups: GroupView[], fighting: boolean): SnapshotMsg => ({
  ...base,
  view: {
    ...base.view,
    groups,
    fights: fighting
      ? [{ id: 'f', node: home, edge: null, point: null, groups: [GROUP] } as unknown as FightView]
      : [],
  },
});

function setup(retreat: Retreat, groupView: GroupView, fighting: boolean) {
  const rules = rulesOf(retreat);
  const hud = new HudState({ me: 0, nicks: ['Ember', 'Bot'], rules, map });
  hud.onSnapshot(snapshotOf([groupView], fighting));
  const sent: Command[] = [];
  const controller = new OrderController({
    hud,
    map,
    rules,
    book: new OrderBook(),
    send: (cmd) => sent.push(cmd),
    now: () => 1000,
  });
  return { controller, sent };
}

describe.each(['none', 'round'] as const)('a group in a fight, combat.retreat = %s', (retreat) => {
  const held = retreat === 'none';

  it('sends a move only when it may leave', () => {
    const { controller, sent } = setup(retreat, group(null), true);
    controller.click({ kind: 'group', id: GROUP }, false);
    controller.click({ kind: 'node', id: target }, false);
    expect(sent.filter((c) => c.type === 'move')).toHaveLength(held ? 0 : 1);
  });

  it('sends a cancel (X and the radial sector) only when it may leave', () => {
    const { controller, sent } = setup(retreat, group(orderOf(false)), true);
    controller.click({ kind: 'group', id: GROUP }, false);
    controller.key({ type: 'keydown', code: 'KeyX', shiftKey: false });
    controller.chooseGroup('cancel');
    expect(sent.filter((c) => c.type === 'cancel_order')).toHaveLength(held ? 0 : 1);
  });

  it('still cancels a plan waiting in the fight node (the group stays, the plan goes)', () => {
    const { controller, sent } = setup(retreat, group(orderOf(true)), true);
    controller.click({ kind: 'group', id: GROUP }, false);
    controller.key({ type: 'keydown', code: 'KeyX', shiftKey: false });
    expect(sent).toEqual([{ type: 'cancel_order', group: GROUP }]);
  });

  it('is not held out of a fight', () => {
    const { controller, sent } = setup(retreat, group(orderOf(false)), false);
    controller.click({ kind: 'group', id: GROUP }, false);
    controller.key({ type: 'keydown', code: 'KeyX', shiftKey: false });
    expect(sent).toEqual([{ type: 'cancel_order', group: GROUP }]);
  });
});
