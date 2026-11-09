import { describe, expect, it } from 'vitest';
import { UNDO_MAX, UndoList, undoCommand } from './undoList.ts';

const move = (group: string) =>
  ({ type: 'move', group, dest: 1, planned: false, bonus: 0 }) as const;
const recruit = (node: number) => ({ type: 'recruit', node }) as const;
const free = () => false;

describe('UndoList', () => {
  it('gives the newest entry first', () => {
    const list = new UndoList();
    list.onAccepted(move('a'));
    list.onAccepted(recruit(3));
    list.onAccepted(move('b'));
    expect(list.take(free)).toEqual({ kind: 'order', group: 'b' });
    expect(list.take(free)).toEqual({ kind: 'recruit', node: 3 });
    expect(list.take(free)).toEqual({ kind: 'order', group: 'a' });
    expect(list.take(free)).toBeNull();
  });

  it('remembers only what X can undo: no split, merge, stance, leaf shift or build', () => {
    const list = new UndoList();
    list.onAccepted({ type: 'split', group: 'a', n: 1 });
    list.onAccepted({ type: 'merge', groups: ['a', 'b'] });
    list.onAccepted({ type: 'set_stance', stance: 'war' });
    list.onAccepted({ type: 'set_leaf_shift', shift: 1 });
    list.onAccepted({ type: 'build_factory', node: 1 });
    list.onAccepted({ type: 'build_barracks', node: 1 });
    list.onAccepted({ type: 'fortify_road', node: 1, edge: 2 });
    expect(list.size).toBe(0);
  });

  it('keeps a held entry in place and takes the next one', () => {
    const list = new UndoList();
    list.onAccepted(move('a'));
    list.onAccepted(move('b'));
    const held = (e: { kind: string; group?: string }) => e.group === 'b';
    expect(list.take(held)).toEqual({ kind: 'order', group: 'a' });
    expect(list.take(held)).toBeNull();
    expect(list.take(free)).toEqual({ kind: 'order', group: 'b' });
  });

  it('a cancel by hand takes out only the newest entry it matches', () => {
    const list = new UndoList();
    list.onAccepted(recruit(3));
    list.onAccepted(recruit(3));
    list.onAccepted(move('a'));
    list.onAccepted({ type: 'cancel_recruit', node: 3 });
    list.onAccepted({ type: 'cancel_order', group: 'a' });
    expect(list.size).toBe(1);
    expect(list.take(free)).toEqual({ kind: 'recruit', node: 3 });
  });

  it('is bounded: the oldest entry goes', () => {
    const list = new UndoList();
    for (let i = 0; i <= UNDO_MAX; i++) list.onAccepted(recruit(i));
    expect(list.size).toBe(UNDO_MAX);
    let last = null;
    for (let i = 0; i < UNDO_MAX; i++) last = list.take(free);
    expect(last).toEqual({ kind: 'recruit', node: 1 });
  });

  it('turns an entry into the existing cancel commands', () => {
    expect(undoCommand({ kind: 'order', group: 'a' })).toEqual({
      type: 'cancel_order',
      group: 'a',
    });
    expect(undoCommand({ kind: 'recruit', node: 3 })).toEqual({ type: 'cancel_recruit', node: 3 });
  });
});
