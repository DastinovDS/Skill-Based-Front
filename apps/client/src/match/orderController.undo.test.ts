import { describe, expect, it } from 'vitest';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { HudState } from '../hud/hudState.svelte.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { Command, FightView, GroupView, SnapshotMsg } from '../protocol.gen.ts';
import { UNDO_CUE } from '../render/style.ts';
import { OrderBook } from './orderBook.ts';
import { OrderController } from './orderController.ts';

const map = DEFAULT_MAP;
const RULES = DEV_RULES;
const snapshot = devSnapshot(map, RULES, 30);
const first = snapshot.view.groups[0];
if (first?.location.kind !== 'node') throw new Error('the dev snapshot has no group in a node');
const home = first.location.node;

/** Two more own groups beside the first: each of the moves below is of a group of its own. */
const groupAt = (id: string): GroupView => ({ ...first, id });
const onRoad = (id: string): GroupView => ({
  ...first,
  id,
  location: { kind: 'edge', edge: 0, from_node: home, progress: 100 },
  order: {
    dest: 7,
    path: [5, 7],
    planned: false,
    bonus: 0,
    gathering: false,
    plan: 0,
    next_charge_tick: null,
    depart_tick: null,
    group_order: null,
    arrive_tick: null,
  },
});
const withGroups = (groups: GroupView[], fights: FightView[] = []): SnapshotMsg => ({
  ...snapshot,
  view: { ...snapshot.view, groups, fights },
});
const fightOf = (group: string): FightView =>
  ({ id: 'f', node: home, edge: null, point: null, groups: [group] }) as unknown as FightView;

const ANSWER = {
  applied_tick: 31,
  path: null,
  arrive_tick: null,
  kind: null,
  cost: null,
  members: null,
} as const;

function setup() {
  const hud = new HudState({ me: 0, nicks: ['Ember', 'Bot'], rules: RULES, map });
  hud.onSnapshot(withGroups([first as GroupView, groupAt('g2'), groupAt('g3')]));
  const book = new OrderBook();
  const sent: Command[] = [];
  const clock = { now: 1000 };
  const controller = new OrderController({
    hud,
    map,
    rules: RULES,
    book,
    send: (cmd) => sent.push(cmd),
    now: () => clock.now,
  });
  const toasts: unknown[] = [];
  controller.ui.onFeedback((feedback) => {
    if (feedback.kind !== 'accepted') toasts.push(feedback);
  });
  /** Tracks `cmd` as the controller's own and answers it: the way an accepted command gets in. */
  const accepted = (cmd: Command): void => {
    const seq = sent.push(cmd);
    book.track(seq, cmd);
    book.onAck({ type: 'ack', seq, reject_code: null, ...ANSWER });
  };
  const answer = (reject_code: string | null = null): void => {
    book.onAck({ type: 'ack', seq: sent.length, reject_code, ...ANSWER });
  };
  const press = (repeat = false): void => {
    controller.key({ type: 'keydown', code: 'KeyX', shiftKey: false, repeat });
  };
  return { hud, book, sent, clock, controller, toasts, accepted, answer, press };
}

const move = (group: string): Command => ({
  type: 'move',
  group,
  dest: 5,
  planned: false,
  bonus: 0,
});
const cancel = (group: string): Command => ({ type: 'cancel_order', group });

describe('X with nothing selected (#764)', () => {
  it('undoes one step further back with each press', () => {
    const { sent, accepted, answer, press } = setup();
    accepted(move('g2'));
    accepted({ type: 'recruit', node: home });
    accepted(move('g3'));
    press();
    expect(sent.at(-1)).toEqual(cancel('g3'));
    answer();
    press();
    expect(sent.at(-1)).toEqual({ type: 'cancel_recruit', node: home });
    answer();
    press();
    expect(sent.at(-1)).toEqual(cancel('g2'));
    answer();
    expect(sent).toHaveLength(6);
  });

  it('a press while another undo is on its way waits for it: one undo at a time', () => {
    const { sent, accepted, answer, press } = setup();
    accepted(move('g2'));
    accepted(move('g3'));
    press();
    press();
    expect(sent).toHaveLength(3);
    answer();
    expect(sent.at(-1)).toEqual(cancel('g2'));
    answer();
    expect(sent).toHaveLength(4);
  });

  it('skips quietly what the server has nothing to cancel for: one press, one real undo', () => {
    const { sent, accepted, answer, press, toasts, controller } = setup();
    accepted(move('g2'));
    accepted(move('g3'));
    press();
    answer('NOTHING_TO_CANCEL');
    expect(sent.at(-1)).toEqual(cancel('g2'));
    answer();
    expect(sent).toHaveLength(4); // the press is served, nothing else goes out
    expect(toasts).toEqual([]);
    expect(controller.ui.current.notice?.kind).toBe('accepted');
  });

  it('skips a group that is gone or a city that was lost the same way', () => {
    const { sent, accepted, answer, press, toasts, controller } = setup();
    accepted({ type: 'recruit', node: home });
    accepted(move('g2'));
    accepted({ type: 'recruit', node: 1 });
    press();
    answer('NOT_OWNER');
    expect(sent.at(-1)).toEqual(cancel('g2'));
    answer('NOT_FOUND_OR_HIDDEN');
    expect(sent.at(-1)).toEqual({ type: 'cancel_recruit', node: home });
    answer('NOTHING_TO_CANCEL');
    expect(toasts).toEqual([]);
    expect(controller.ui.current.notice).toBeNull();
  });

  it('with the list run out: nothing sent, a neutral mark, no toast; the key keeps working', () => {
    const { sent, accepted, answer, press, toasts, controller, clock } = setup();
    press();
    expect(sent).toEqual([]);
    expect(controller.overlay().undo).toEqual([{ at: 1000, group: null, node: null, path: [] }]);
    clock.now += UNDO_CUE.ms;
    expect(controller.overlay().undo).toEqual([]);
    accepted(move('g2'));
    press();
    answer('NOTHING_TO_CANCEL');
    expect(controller.overlay().undo).toHaveLength(1); // ran out again: the neutral mark
    expect(toasts).toEqual([]);
    accepted(move('g3'));
    press();
    expect(sent.at(-1)).toEqual(cancel('g3'));
  });

  it('skips the entries of a group in a fight, the others still go', () => {
    const { hud, sent, accepted, answer, press } = setup();
    accepted(move('g2'));
    accepted(move('g3'));
    hud.onSnapshot(withGroups([groupAt('g2'), groupAt('g3')], [fightOf('g3')]));
    press();
    expect(sent.at(-1)).toEqual(cancel('g2'));
    answer();
    press();
    expect(sent).toHaveLength(3); // only g3 is left, and it fights: no withdrawal under fire
    // Out of the fight the entry is the server's to answer again.
    hud.onSnapshot(withGroups([groupAt('g3')]));
    press();
    expect(sent.at(-1)).toEqual(cancel('g3'));
  });

  it('waits for the answer to a move on its way: that move is the last action', () => {
    const { book, sent, accepted, answer, press } = setup();
    accepted(move('g2'));
    const seq = sent.push(move('g3'));
    book.track(seq, move('g3'));
    press();
    expect(sent).toHaveLength(2);
    book.onAck({ type: 'ack', seq, reject_code: null, ...ANSWER });
    expect(sent.at(-1)).toEqual(cancel('g3'));
    answer();
  });

  it('a held key does not walk the list', () => {
    const { sent, accepted, answer, press } = setup();
    accepted(move('g2'));
    accepted(move('g3'));
    press();
    answer();
    press(true);
    press(true);
    expect(sent).toHaveLength(3);
  });

  it('with a selection X is what it was: no undo, no cue', () => {
    const { hud, sent, accepted, answer, press, controller } = setup();
    accepted(move('g2'));
    accepted({ type: 'recruit', node: home });
    controller.click({ kind: 'group', id: 'g3' }, false);
    expect(hud.selection).toEqual({ kind: 'group', id: 'g3' });
    press();
    expect(sent.at(-1)).toEqual(cancel('g3'));
    answer('NOTHING_TO_CANCEL');
    expect(controller.overlay().undo).toEqual([]);
    expect(controller.ui.current.notice?.kind).toBe('rejected');
    controller.click({ kind: 'node', id: home }, false);
    press();
    expect(sent.at(-1)).toEqual({ type: 'cancel_recruit', node: home });
    answer();
    // That recruit is gone by hand, so the undo goes on with the entry before it.
    controller.deselect();
    press();
    expect(sent.at(-1)).toEqual(cancel('g2'));
  });

  it('starts empty after a reconnect and at the end of a match', () => {
    const { book, sent, accepted, press } = setup();
    accepted(move('g2'));
    book.undo.clear(); // what `MatchSession` does on `welcome` and `match_end`
    press();
    expect(sent).toHaveLength(1);
  });

  it('a lost answer ends the presses waiting: the snapshots show the outcome', () => {
    const { book, sent, accepted, press, toasts } = setup();
    accepted(move('g2'));
    accepted(move('g3'));
    press();
    press();
    book.onAckLost(sent.length);
    expect(sent).toHaveLength(3);
    expect(toasts).toHaveLength(1);
    press();
    expect(sent.at(-1)).toEqual(cancel('g2'));
  });

  it('the cue marks the group with the way it had ahead, once the server accepted', () => {
    const { hud, accepted, answer, press, controller, clock } = setup();
    accepted(move('g2'));
    hud.onSnapshot(withGroups([onRoad('g2')]));
    press();
    expect(controller.overlay().undo).toEqual([]); // not before the server says so
    clock.now += 40;
    answer();
    expect(controller.overlay().undo).toEqual([
      { at: 1040, group: 'g2', node: null, path: [5, 7] },
    ]);
  });

  it('the cue of a recruit marks its city; the overlay stays the same object meanwhile', () => {
    const { accepted, answer, press, controller, clock } = setup();
    accepted({ type: 'recruit', node: home });
    press();
    answer();
    const overlay = controller.overlay();
    expect(overlay.undo).toEqual([{ at: 1000, group: null, node: home, path: [] }]);
    expect(controller.overlay()).toBe(overlay);
    clock.now += UNDO_CUE.ms;
    expect(controller.overlay().undo).toEqual([]);
  });
});
