import { describe, expect, it } from 'vitest';
import { DEV_RULES_FLOW, devSnapshot } from '../hud/devFeed.ts';
import { HudState } from '../hud/hudState.svelte.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { Command, UiFlag } from '../protocol.gen.ts';
import type { CommandFacts } from '../tutorial/allow.ts';
import { OrderBook } from './orderBook.ts';
import { OrderController, type OrderLocks } from './orderController.ts';

// The locks of a tutorial beat in the order controller (#806, docs/design/tutorial.md 7.7): a
// control whose piece is hidden or whose command the beat does not allow does nothing but tell the
// coach; without locks (a normal match) nothing changes.
const RULES = DEV_RULES_FLOW;
const snapshot = devSnapshot(DEFAULT_MAP, RULES, 30);
const group = snapshot.view.groups[0];
if (group?.location.kind !== 'node') throw new Error('the dev snapshot has no group in a node');
const home = group.location.node;
const target = DEFAULT_MAP.edges.find((e) => e.a === home || e.b === home);
if (target === undefined) throw new Error('the home node has no road');
const next = target.a === home ? target.b : target.a;
const other = DEFAULT_MAP.nodes.find((n) => n.id !== home && n.id !== next)?.id ?? -1;

const down = (code: string) => ({ type: 'keydown', code, shiftKey: false }) as const;

interface Lock extends OrderLocks {
  refusals: number;
}

function locks(
  shown: readonly UiFlag[],
  allows: (cmd: Command) => boolean,
  facts: (f: CommandFacts) => boolean = () => false,
): Lock {
  const lock: Lock = {
    refusals: 0,
    shows: (flag) => shown.includes(flag),
    allows: (cmd) => cmd.type === 'forfeit' || allows(cmd),
    allowsFacts: facts,
    refused: () => {
      lock.refusals += 1;
    },
  };
  return lock;
}

function setup(lock: OrderLocks | null) {
  const hud = new HudState({ me: 0, nicks: ['Ember', 'Bot'], rules: RULES, map: DEFAULT_MAP });
  hud.onSnapshot(snapshot);
  const sent: Command[] = [];
  const controller = new OrderController({
    hud,
    map: DEFAULT_MAP,
    rules: RULES,
    book: new OrderBook(),
    send: (cmd) => sent.push(cmd),
    locks: lock,
  });
  return { hud, sent, controller };
}

const selectGroup = (c: OrderController): void => {
  c.click({ kind: 'group', id: group.id, node: home }, false);
};

describe('the locks of a tutorial beat', () => {
  it('sends only the move the beat allows; another target pulses the card and keeps the group', () => {
    const lock = locks([], (cmd) => cmd.type === 'move' && cmd.dest === next && !cmd.planned);
    const { controller, sent, hud } = setup(lock);
    selectGroup(controller);
    controller.click({ kind: 'node', id: other }, false);
    expect(sent).toEqual([]);
    expect(lock.refusals).toBe(1);
    expect(hud.selection).toEqual({ kind: 'group', id: group.id });
    controller.click({ kind: 'node', id: next }, false);
    expect(sent).toEqual([{ type: 'move', group: group.id, dest: next, planned: false, bonus: 0 }]);
  });

  it('holds the keys of hidden pieces and never splits, merges or releases in a chapter', () => {
    const lock = locks([], () => true);
    const { controller, sent } = setup(lock);
    expect(controller.key(down('KeyT'))).toBe(true);
    expect(controller.terrainMode).toBe(false);
    selectGroup(controller);
    for (const key of ['KeyS', 'KeyG', 'KeyF', 'KeyQ']) controller.key(down(key));
    expect(controller.splitMenu.current.open).toBe(false);
    expect(controller.radial.current.open).toBe(false);
    expect(sent).toEqual([]);
    expect(lock.refusals).toBe(5);
    // The planned key is not held while planned orders are hidden: a click stays ordinary.
    controller.key({ type: 'keydown', code: 'KeyE', shiftKey: false });
    expect(controller.planned).toBe(false);
  });

  it('shows the terrain mode once the beat unlocks it', () => {
    const { controller } = setup(locks(['terrainMode'], () => true));
    controller.key(down('KeyT'));
    expect(controller.terrainMode).toBe(true);
  });

  it('locks the menu items the beat does not allow, and the stance chip', () => {
    const lock = locks(
      ['buildings', 'stance'],
      () => true,
      (f) => f.command === 'build_factory',
    );
    const { controller } = setup(lock);
    expect(controller.cityChoiceLocked('factory', home)).toBe(false);
    expect(controller.cityChoiceLocked('barracks', home)).toBe(true);
    expect(controller.cityChoiceLocked('fortify', home)).toBe(true);
    expect(controller.cityChoiceLocked('recruit', home)).toBe(true);
    expect(controller.groupChoiceLocked('split', group.id)).toBe(true);
    expect(controller.groupChoiceLocked('cancel', group.id)).toBe(true);
    expect(controller.stanceChipLocked).toBe(true);
    expect(controller.openRadial(true)).toBe(false);
    expect(lock.refusals).toBe(1);
  });

  it('changes nothing in a normal match', () => {
    const { controller, sent } = setup(null);
    expect(controller.locks).toBeNull();
    expect(controller.cityChoiceLocked('fortify', home)).toBe(false);
    expect(controller.groupChoiceLocked('split', group.id)).toBe(false);
    expect(controller.stanceChipLocked).toBe(false);
    expect(controller.shows('groupSelect')).toBe(true);
    controller.key(down('KeyT'));
    expect(controller.terrainMode).toBe(true);
    controller.key(down('KeyT'));
    selectGroup(controller);
    controller.click({ kind: 'node', id: other }, false);
    expect(sent).toHaveLength(1);
  });
});
