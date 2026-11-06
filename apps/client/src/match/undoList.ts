import type { Command } from '../protocol.gen.ts';

/** What `X` with nothing selected can take back: ids and kinds only, the server decides the rest. */
export type UndoEntry =
  | { readonly kind: 'order'; readonly group: string }
  | { readonly kind: 'recruit'; readonly node: number };

/** Entries kept at most; the oldest goes first. */
export const UNDO_MAX = 32;

/** The command that takes `entry` back; prices and refunds are the server's (DEC-20, DEC-25). */
export function undoCommand(entry: UndoEntry): Command {
  return entry.kind === 'order'
    ? { type: 'cancel_order', group: entry.group }
    : { type: 'cancel_recruit', node: entry.node };
}

/**
 * The player's accepted commands that `X` can undo, newest last (#764): moves, planned orders and
 * recruits. A plain list of what the server accepted: whether an entry can still be cancelled (the
 * group arrived, merged, died) is asked of the server, never worked out here (AGENTS.md 7.1).
 */
export class UndoList {
  #entries: UndoEntry[] = [];

  get size(): number {
    return this.#entries.length;
  }

  /**
   * The server accepted `cmd`: a move or a recruit is remembered; a cancel given by hand (with a
   * selection) takes its entry out, and so does a mode change, after which a cancel of the group
   * would take back the mode, not the order.
   */
  onAccepted(cmd: Command): void {
    switch (cmd.type) {
      case 'move':
        this.#push({ kind: 'order', group: cmd.group });
        break;
      case 'recruit':
        this.#push({ kind: 'recruit', node: cmd.node });
        break;
      case 'cancel_order':
        this.#dropNewest((e) => e.kind === 'order' && e.group === cmd.group);
        break;
      case 'cancel_recruit':
        this.#dropNewest((e) => e.kind === 'recruit' && e.node === cmd.node);
        break;
      case 'set_mode':
        this.#entries = this.#entries.filter((e) => e.kind !== 'order' || e.group !== cmd.group);
        break;
      default:
        break;
    }
  }

  /** Takes out the newest entry `held` does not hold back; a held one stays for a later press. */
  take(held: (entry: UndoEntry) => boolean): UndoEntry | null {
    for (let i = this.#entries.length - 1; i >= 0; i--) {
      const entry = this.#entries[i];
      if (entry !== undefined && !held(entry)) {
        this.#entries.splice(i, 1);
        return entry;
      }
    }
    return null;
  }

  clear(): void {
    this.#entries = [];
  }

  #push(entry: UndoEntry): void {
    this.#entries = [...this.#entries, entry].slice(-UNDO_MAX);
  }

  #dropNewest(match: (entry: UndoEntry) => boolean): void {
    const index = this.#entries.findLastIndex(match);
    if (index >= 0) this.#entries.splice(index, 1);
  }
}
